import type {
  GameState,
  PlayerId,
  PlayerState,
  ShipInstance,
  TargetRef,
} from './types';
import { getDef } from './cards';
import { shuffle } from './rng';

export const HAND_LIMIT = 8;
export const FLEET_LIMIT = 7;
export const SHIELD_BASE = 4;

// ---------------------------------------------------------------------------
// Création de partie
// ---------------------------------------------------------------------------

function emptyPlayer(deck: string[]): PlayerState {
  return {
    stationHp: 20,
    stationMaxHp: 20,
    shield: SHIELD_BASE,
    shieldMax: SHIELD_BASE,
    deck: [...deck],
    hand: [],
    discard: [],
    generators: [],
    fleet: [],
    modules: [],
    energy: 0,
    playedGenerator: false,
    stationImmuneUntil: 0,
    fatigue: 0,
  };
}

export function newGame(deck0: string[], deck1: string[], seed = 1): GameState {
  const state: GameState = {
    players: [emptyPlayer(deck0), emptyPlayer(deck1)],
    active: 0,
    turnCounter: 1,
    shipsDestroyedThisTurn: 0,
    nextUid: 1,
    rng: { seed: (seed >>> 0) || 1 },
    over: false,
    log: [],
  };
  shuffle(state.rng, state.players[0].deck);
  shuffle(state.rng, state.players[1].deck);
  for (let i = 0; i < 5; i++) drawCard(state, 0);
  for (let i = 0; i < 6; i++) drawCard(state, 1);
  addLog(state, 'La partie commence.');
  beginTurn(state, true);
  return state;
}

// ---------------------------------------------------------------------------
// Utilitaires d'état
// ---------------------------------------------------------------------------

export function addLog(state: GameState, msg: string): void {
  state.log.push(msg);
}

export function otherPlayer(pid: PlayerId): PlayerId {
  return (1 - pid) as PlayerId;
}

export function findShip(
  state: GameState,
  pid: PlayerId,
  uid: number,
): ShipInstance | undefined {
  return state.players[pid].fleet.find((s) => s.uid === uid);
}

export function isStealthed(ship: ShipInstance): boolean {
  return !!getDef(ship.defId).furtif && !ship.stealthBroken;
}

export function isJammed(state: GameState, ship: ShipInstance): boolean {
  return state.turnCounter < ship.jammedUntil;
}

export function isSick(state: GameState, ship: ShipInstance): boolean {
  return ship.enteredTurn === state.turnCounter && !getDef(ship.defId).frappeRapide;
}

/** Un vaisseau furtif adverse non révélé ne peut pas être ciblé. */
export function shipTargetableBy(
  state: GameState,
  byPlayer: PlayerId,
  t: TargetRef,
): boolean {
  if (t.kind !== 'ship' || t.uid === undefined) return false;
  const ship = findShip(state, t.player, t.uid);
  if (!ship) return false;
  if (ship.owner !== byPlayer && isStealthed(ship)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Statistiques effectives (auras comprises)
// ---------------------------------------------------------------------------

export function effAtk(state: GameState, ship: ShipInstance): number {
  let atk = (getDef(ship.defId).atk ?? 0) + ship.tempAtk;
  for (const ally of state.players[ship.owner].fleet) {
    if (ally.uid === ship.uid) continue;
    atk += getDef(ally.defId).auraAtk?.(state, ally, ship) ?? 0;
  }
  return Math.max(0, atk);
}

export function effHp(state: GameState, ship: ShipInstance): number {
  let hp = getDef(ship.defId).hp ?? 0;
  for (const ally of state.players[ship.owner].fleet) {
    if (ally.uid === ship.uid) continue;
    hp += getDef(ally.defId).auraHp?.(state, ally, ship) ?? 0;
  }
  return hp;
}

export function stationArmor(state: GameState, pid: PlayerId): number {
  return state.players[pid].modules.reduce(
    (n, m) => n + (getDef(m.defId).stationArmor ?? 0),
    0,
  );
}

export function getCost(state: GameState, pid: PlayerId, defId: string): number {
  const def = getDef(defId);
  if (def.type === 'generateur') return 0;
  let delta = 0;
  const p = state.players[pid];
  for (const inst of [...p.modules, ...p.fleet]) {
    const d = getDef(inst.defId);
    if (def.type === 'vaisseau') delta += d.shipCostDelta ?? 0;
    else if (def.type === 'module') delta += d.moduleCostDelta ?? 0;
    else if (def.type === 'tactique') delta += d.tacticCostDelta ?? 0;
  }
  return Math.max(def.cost > 0 ? 1 : 0, def.cost + delta);
}

// ---------------------------------------------------------------------------
// Dégâts, soins, pige
// ---------------------------------------------------------------------------

/**
 * Inflige des dégâts à une station : Blindage, puis bouclier, puis coque.
 * `internal` (usure, propres cartes) ignore Blindage et bouclier.
 * `pierceShield` (Perce-bouclier) ignore le bouclier mais pas le Blindage.
 * Retourne les dégâts réellement infligés à la coque.
 */
export function damageStation(
  state: GameState,
  pid: PlayerId,
  amount: number,
  internal = false,
  pierceShield = false,
): number {
  const p = state.players[pid];
  if (state.turnCounter < p.stationImmuneUntil) {
    addLog(state, `La station du joueur ${pid + 1} est protégée : dégâts annulés.`);
    return 0;
  }
  let dmg = amount;
  if (!internal) {
    dmg = Math.max(0, dmg - stationArmor(state, pid));
    if (dmg > 0 && p.shield > 0 && !pierceShield) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
      addLog(state, `Le bouclier du joueur ${pid + 1} absorbe ${absorbed} dégâts (${p.shield} PB).`);
    }
  }
  if (dmg > 0) {
    p.stationHp -= dmg;
    addLog(state, `La station du joueur ${pid + 1} subit ${dmg} dégâts (${Math.max(0, p.stationHp)} PV).`);
  }
  return dmg;
}

/** Retourne les dégâts réellement infligés au vaisseau (après Blindage). */
export function damageShip(
  state: GameState,
  ship: ShipInstance,
  amount: number,
  by?: { player: PlayerId; uid: number },
): number {
  const dmg = Math.max(0, amount - (getDef(ship.defId).armor ?? 0));
  if (dmg > 0) {
    ship.damage += dmg;
    if (by) ship.lastDamagedBy = by;
    addLog(state, `${getDef(ship.defId).name} subit ${dmg} dégâts.`);
  }
  return dmg;
}

export function healShip(ship: ShipInstance, amount: number): void {
  ship.damage = Math.max(0, ship.damage - amount);
}

export function healStation(state: GameState, pid: PlayerId, amount: number): void {
  const p = state.players[pid];
  p.stationHp = Math.min(p.stationMaxHp, p.stationHp + amount);
}

export function drawCard(state: GameState, pid: PlayerId): void {
  const p = state.players[pid];
  if (p.deck.length === 0) {
    p.fatigue++;
    addLog(state, `Joueur ${pid + 1} pige d'un deck vide : ${p.fatigue} dégâts d'usure.`);
    damageStation(state, pid, p.fatigue, true);
    checkStateBased(state);
    return;
  }
  const card = p.deck.shift()!;
  if (p.hand.length >= HAND_LIMIT) {
    p.discard.push(card);
    addLog(state, `Main pleine : ${getDef(card).name} est défaussée.`);
  } else {
    p.hand.push(card);
  }
}

export function spawnShip(
  state: GameState,
  pid: PlayerId,
  defId: string,
): ShipInstance | undefined {
  const p = state.players[pid];
  if (p.fleet.length >= FLEET_LIMIT) {
    addLog(state, `Flotte pleine : ${getDef(defId).name} n'est pas déployé.`);
    return undefined;
  }
  const ship: ShipInstance = {
    uid: state.nextUid++,
    defId,
    owner: pid,
    damage: 0,
    enteredTurn: state.turnCounter,
    attacksUsed: 0,
    stealthBroken: false,
    jammedUntil: 0,
    guarding: false,
    tempAtk: 0,
    tempFurtif: false,
  };
  p.fleet.push(ship);
  return ship;
}

export function destroyModuleInst(state: GameState, pid: PlayerId, uid: number): boolean {
  const p = state.players[pid];
  const i = p.modules.findIndex((m) => m.uid === uid);
  if (i < 0) return false;
  const [m] = p.modules.splice(i, 1);
  p.discard.push(m.defId);
  addLog(state, `${getDef(m.defId).name} est détruit.`);
  return true;
}

// ---------------------------------------------------------------------------
// Vérifications d'état (destructions, victoire)
// ---------------------------------------------------------------------------

function destroyShip(state: GameState, ship: ShipInstance): void {
  const p = state.players[ship.owner];
  const i = p.fleet.indexOf(ship);
  if (i < 0) return;
  p.fleet.splice(i, 1);
  state.shipsDestroyedThisTurn++;
  const def = getDef(ship.defId);
  if (!def.token) p.discard.push(ship.defId);
  addLog(state, `${def.name} est détruit.`);
  def.onDestroyed?.({
    state,
    owner: ship.owner,
    selfUid: ship.uid,
    destroyer: ship.lastDamagedBy,
  });
}

export function checkStateBased(state: GameState): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const pid of [0, 1] as PlayerId[]) {
      for (const ship of [...state.players[pid].fleet]) {
        if (!state.players[pid].fleet.includes(ship)) continue;
        if (ship.damage >= effHp(state, ship)) {
          destroyShip(state, ship);
          changed = true;
        }
      }
    }
  }
  if (!state.over) {
    const dead0 = state.players[0].stationHp <= 0;
    const dead1 = state.players[1].stationHp <= 0;
    if (dead0 || dead1) {
      state.over = true;
      if (dead0 && dead1) {
        addLog(state, 'Les deux stations sont détruites : égalité !');
      } else {
        state.winner = dead0 ? 1 : 0;
        addLog(state, `La station du joueur ${dead0 ? 1 : 2} est détruite. Joueur ${state.winner + 1} gagne !`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Actions des joueurs
// ---------------------------------------------------------------------------

function guard(state: GameState): void {
  if (state.over) throw new Error('La partie est terminée.');
  if (state.pendingDecision) throw new Error('Une décision est en attente.');
}

export function playGenerator(state: GameState, handIndex: number): void {
  guard(state);
  const pid = state.active;
  const p = state.players[pid];
  const defId = p.hand[handIndex];
  if (defId === undefined) throw new Error('Index de main invalide.');
  const def = getDef(defId);
  if (def.type !== 'generateur') throw new Error(`${def.name} n'est pas un générateur.`);
  if (p.playedGenerator) throw new Error('Un seul générateur par tour.');
  p.hand.splice(handIndex, 1);
  p.generators.push(defId);
  p.playedGenerator = true;
  p.energy += def.energyOutput ?? 0;
  addLog(state, `Joueur ${pid + 1} déploie ${def.name}.`);
  def.onEnter?.({ state, owner: pid });
  checkStateBased(state);
}

export function playCard(
  state: GameState,
  handIndex: number,
  opts: { targets?: TargetRef[]; mode?: number } = {},
): void {
  guard(state);
  const pid = state.active;
  const p = state.players[pid];
  const defId = p.hand[handIndex];
  if (defId === undefined) throw new Error('Index de main invalide.');
  const def = getDef(defId);
  if (def.type === 'generateur')
    throw new Error('Les générateurs se posent avec l\'action dédiée.');
  const cost = getCost(state, pid, defId);
  if (p.energy < cost) throw new Error(`Énergie insuffisante (${cost} requis).`);
  if (def.type === 'vaisseau' && p.fleet.length >= FLEET_LIMIT)
    throw new Error('Flotte pleine (7 vaisseaux maximum).');
  let spec = def.targetSpec;
  if (def.modes) {
    if (opts.mode === undefined || !def.modes[opts.mode])
      throw new Error('Choisissez un mode pour cette carte.');
    spec = def.modes[opts.mode].targetSpec;
  }
  if (spec?.required) {
    const t = opts.targets?.[0];
    if (!t || !spec.validate(state, pid, t))
      throw new Error(`Cible invalide : ${spec.hint}.`);
  }
  p.energy -= cost;
  p.hand.splice(handIndex, 1);
  addLog(state, `Joueur ${pid + 1} joue ${def.name}.`);
  const base = { state, owner: pid, targets: opts.targets, mode: opts.mode };
  if (def.type === 'vaisseau') {
    const ship = spawnShip(state, pid, defId)!;
    def.onEnter?.({ ...base, selfUid: ship.uid });
  } else if (def.type === 'module') {
    const m = { uid: state.nextUid++, defId, owner: pid };
    p.modules.push(m);
    def.onEnter?.({ ...base, selfUid: m.uid });
  } else {
    def.play?.(base);
    p.discard.push(defId);
  }
  checkStateBased(state);
}

/** Met un vaisseau en garde : c'est son action du tour, il interceptera la prochaine attaque. */
export function guardShip(state: GameState, uid: number): void {
  guard(state);
  const pid = state.active;
  const ship = findShip(state, pid, uid);
  if (!ship) throw new Error('Vaisseau introuvable.');
  const def = getDef(ship.defId);
  if (def.mustAttack) throw new Error(`${def.name} doit attaquer : il refuse la garde.`);
  if (ship.attacksUsed > 0) throw new Error(`${def.name} a déjà agi ce tour.`);
  if (isJammed(state, ship)) throw new Error(`${def.name} est brouillé.`);
  ship.guarding = true;
  ship.attacksUsed++;
  addLog(state, `${def.name} se met en garde.`);
}

export function attack(state: GameState, attackerUid: number, target: TargetRef): void {
  guard(state);
  const pid = state.active;
  const defenderId = otherPlayer(pid);
  const ship = findShip(state, pid, attackerUid);
  if (!ship) throw new Error('Vaisseau attaquant introuvable.');
  const def = getDef(ship.defId);
  if (effAtk(state, ship) <= 0) throw new Error(`${def.name} n'a pas d'attaque.`);
  if (ship.attacksUsed > 0) throw new Error(`${def.name} a déjà agi ce tour.`);
  if (isSick(state, ship)) throw new Error(`${def.name} vient d'arriver (mal de saut).`);
  if (isJammed(state, ship)) throw new Error(`${def.name} est brouillé.`);
  if (target.player !== defenderId) throw new Error('La cible doit être ennemie.');

  const ignoresEscorte = !!def.furtif || ship.tempFurtif;
  const escorts = state.players[defenderId].fleet.filter((s) => getDef(s.defId).escorte);
  let targetShip: ShipInstance | undefined;
  if (target.kind === 'ship') {
    targetShip = findShip(state, defenderId, target.uid ?? -1);
    if (!targetShip) throw new Error('Vaisseau cible introuvable.');
    if (isStealthed(targetShip)) throw new Error('Cette cible est furtive.');
    if (escorts.length > 0 && !ignoresEscorte && !getDef(targetShip.defId).escorte)
      throw new Error('Vous devez attaquer un vaisseau Escorte.');
  } else if (target.kind === 'station') {
    if (escorts.length > 0 && !ignoresEscorte)
      throw new Error('Les vaisseaux Escorte protègent la station.');
  } else {
    throw new Error('Cible d\'attaque invalide.');
  }

  ship.attacksUsed++;
  if (def.furtif) ship.stealthBroken = true;
  const power = effAtk(state, ship);

  // Interception : le premier vaisseau en garde s'interpose (sauf attaquant furtif,
  // ou attaque visant déjà un gardien).
  if (!ignoresEscorte && (!targetShip || !targetShip.guarding)) {
    const interceptor = state.players[defenderId].fleet.find((s) => s.guarding);
    if (interceptor) {
      interceptor.guarding = false;
      addLog(
        state,
        `${getDef(interceptor.defId).name} intercepte l'attaque de ${def.name}.`,
      );
      const riposte = effAtk(state, interceptor);
      damageShip(state, interceptor, power, { player: pid, uid: ship.uid });
      damageShip(state, ship, riposte, { player: defenderId, uid: interceptor.uid });
      checkStateBased(state);
      return;
    }
  }

  if (target.kind === 'station') {
    addLog(state, `${def.name} attaque la station ennemie.`);
    const dealt = damageStation(state, defenderId, power);
    for (const m of [...state.players[defenderId].modules]) {
      getDef(m.defId).onEnemyAttacksStation?.({
        state,
        owner: defenderId,
        selfUid: m.uid,
        attackerUid: ship.uid,
      });
    }
    if (dealt > 0)
      def.onDealStationDamage?.({ state, owner: pid, selfUid: ship.uid });
  } else {
    const t = targetShip!;
    addLog(state, `${def.name} attaque ${getDef(t.defId).name}.`);
    const riposte = effAtk(state, t);
    damageShip(state, t, power, { player: pid, uid: ship.uid });
    damageShip(state, ship, riposte, { player: defenderId, uid: t.uid });
  }
  checkStateBased(state);
}

export function endTurn(state: GameState): void {
  guard(state);
  const p = state.players[state.active];
  for (const s of p.fleet) {
    const d = getDef(s.defId);
    if (d.mustAttack && s.attacksUsed === 0 && !isSick(state, s) && !isJammed(state, s))
      throw new Error(`${d.name} doit attaquer ce tour.`);
  }
  for (const pl of state.players)
    for (const s of pl.fleet) {
      s.tempAtk = 0;
      s.tempFurtif = false;
    }
  beginTurn(state);
}

export function decide(state: GameState, payload: { bottom?: boolean; uid?: number }): void {
  if (state.over) throw new Error('La partie est terminée.');
  const d = state.pendingDecision;
  if (!d) throw new Error('Aucune décision en attente.');
  if (d.kind === 'scry1') {
    const p = state.players[d.player];
    if (payload.bottom && p.deck.length > 0) p.deck.push(p.deck.shift()!);
    addLog(state, payload.bottom ? 'Carte placée sous le deck.' : 'Carte conservée au-dessus du deck.');
  } else {
    if (payload.uid === undefined) throw new Error('Choisissez un module à détruire.');
    if (!destroyModuleInst(state, d.targetPlayer!, payload.uid))
      throw new Error('Module introuvable.');
  }
  state.pendingDecision = undefined;
  checkStateBased(state);
}

// ---------------------------------------------------------------------------
// Début de tour
// ---------------------------------------------------------------------------

function beginTurn(state: GameState, first = false): void {
  if (state.over) return;
  if (!first) {
    state.turnCounter++;
    state.active = otherPlayer(state.active);
  }
  const pid = state.active;
  const p = state.players[pid];
  state.shipsDestroyedThisTurn = 0;
  p.playedGenerator = false;
  for (const s of p.fleet) {
    s.attacksUsed = 0;
    s.guarding = false; // la garde expire au début du tour de son propriétaire
  }
  p.energy = p.generators.reduce((n, g) => n + (getDef(g).energyOutput ?? 0), 0);
  addLog(state, `— Tour ${state.turnCounter} : joueur ${pid + 1} —`);
  drawCard(state, pid);
  for (const m of [...p.modules])
    getDef(m.defId).startOfTurn?.({ state, owner: pid, selfUid: m.uid });
  for (const s of [...p.fleet]) {
    if (!p.fleet.includes(s)) continue;
    getDef(s.defId).startOfTurn?.({ state, owner: pid, selfUid: s.uid });
  }
  checkStateBased(state);
}
