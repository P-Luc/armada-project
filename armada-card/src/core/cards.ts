import type { CardDef, EffectCtx, PlayerId, TargetSpec } from './types';
import {
  HAND_LIMIT,
  addLog,
  damageShip,
  damageStation,
  destroyModuleInst,
  drawCard,
  findShip,
  healShip,
  healStation,
  otherPlayer,
  shipTargetableBy,
  spawnShip,
} from './game';
import { nextInt } from './rng';

export function getDef(id: string): CardDef {
  const def = CARDS[id];
  if (!def) throw new Error(`Carte inconnue : ${id}`);
  return def;
}

// --- Spécifications de cible réutilisables ---------------------------------

const anyShip: TargetSpec = {
  required: true,
  hint: 'un vaisseau',
  validate: (s, o, t) => shipTargetableBy(s, o, t),
};

const enemyShip: TargetSpec = {
  required: true,
  hint: 'un vaisseau ennemi',
  validate: (s, o, t) => t.player !== o && shipTargetableBy(s, o, t),
};

const allyShipOrOwnStation: TargetSpec = {
  required: true,
  hint: 'un vaisseau allié ou votre station',
  validate: (s, o, t) =>
    t.player === o && (t.kind === 'station' || shipTargetableBy(s, o, t)),
};

const anyModule: TargetSpec = {
  required: true,
  hint: 'un module de station',
  validate: (s, _o, t) =>
    t.kind === 'module' &&
    t.uid !== undefined &&
    s.players[t.player].modules.some((m) => m.uid === t.uid),
};

function targetShip(ctx: EffectCtx) {
  const t = ctx.targets![0];
  return findShip(ctx.state, t.player, t.uid!);
}

// --- Définitions ------------------------------------------------------------

export const CARDS: Record<string, CardDef> = {
  // ====================== NEUTRES ======================
  N01: {
    id: 'N01', name: "Générateur d'énergie orbitale", faction: 'neutre',
    type: 'generateur', rarity: 'commune', cost: 0, energyOutput: 1,
    text: 'Produit 1 énergie par tour.',
  },
  N02: {
    id: 'N02', name: 'Générateur à fusion instable', faction: 'neutre',
    type: 'generateur', rarity: 'rare', cost: 0, energyOutput: 2,
    text: "Produit 2 énergies par tour. À l'arrivée : inflige 1 dégât à votre station.",
    onEnter: (ctx) => { damageStation(ctx.state, ctx.owner, 1, true); },
  },
  N03: {
    id: 'N03', name: "Drone d'observation", faction: 'neutre',
    type: 'vaisseau', shipClass: 'chasseur', rarity: 'commune', cost: 1, atk: 1, hp: 1,
    text: "À l'arrivée : regardez la première carte de votre deck ; vous pouvez la mettre en dessous.",
    onEnter: ({ state, owner }) => {
      if (state.players[owner].deck.length > 0)
        state.pendingDecision = { kind: 'scry1', player: owner, cardId: state.players[owner].deck[0] };
    },
  },
  N04: {
    id: 'N04', name: 'Navette de ravitaillement', faction: 'neutre',
    type: 'vaisseau', shipClass: 'corvette', rarity: 'commune', cost: 2, atk: 1, hp: 3,
    text: "À l'arrivée : gagnez 1 énergie utilisable ce tour.",
    onEnter: ({ state, owner }) => { state.players[owner].energy += 1; },
  },
  N05: {
    id: 'N05', name: 'Satellite de défense', faction: 'neutre',
    type: 'vaisseau', shipClass: 'soutien', rarity: 'commune', cost: 2, atk: 0, hp: 4,
    escorte: true, text: 'Escorte.',
  },
  N06: {
    id: 'N06', name: 'Torpille à photons', faction: 'neutre',
    type: 'tactique', rarity: 'commune', cost: 2,
    text: 'Infligez 3 dégâts à un vaisseau.',
    targetSpec: anyShip,
    play: (ctx) => { const t = targetShip(ctx); if (t) damageShip(ctx.state, t, 3); },
  },
  N07: {
    id: 'N07', name: "Champ d'astéroïdes", faction: 'neutre',
    type: 'tactique', rarity: 'rare', cost: 3,
    text: 'Infligez 1 dégât à tous les vaisseaux (les vôtres aussi).',
    play: ({ state }) => {
      for (const pid of [0, 1] as PlayerId[])
        for (const s of [...state.players[pid].fleet]) damageShip(state, s, 1);
    },
  },
  N08: {
    id: 'N08', name: 'Baie de réparation', faction: 'neutre',
    type: 'module', rarity: 'commune', cost: 2,
    text: 'Au début de votre tour, votre station récupère 1 PV.',
    startOfTurn: ({ state, owner }) => { healStation(state, owner, 1); },
  },
  N09: {
    id: 'N09', name: 'Mercenaire indépendant', faction: 'neutre',
    type: 'vaisseau', shipClass: 'croiseur', rarity: 'rare', cost: 5, atk: 5, hp: 4,
    text: '',
  },
  N10: {
    id: 'N10', name: 'Vaisseau-monde ancien', faction: 'neutre',
    type: 'vaisseau', shipClass: 'capital', rarity: 'legendaire', cost: 8, atk: 8, hp: 8,
    armor: 1,
    text: "Blindage 1. À l'arrivée : votre station récupère 5 PV.",
    onEnter: ({ state, owner }) => { healStation(state, owner, 5); },
  },

  // ====================== FÉDÉRATION SOLAIRE ======================
  F01: {
    id: 'F01', name: 'Cadet en patrouille', faction: 'federation',
    type: 'vaisseau', shipClass: 'chasseur', rarity: 'commune', cost: 1, atk: 2, hp: 1,
    text: '',
  },
  F02: {
    id: 'F02', name: 'Sentinelle orbitale', faction: 'federation',
    type: 'vaisseau', shipClass: 'intercepteur', rarity: 'commune', cost: 1, atk: 1, hp: 2,
    text: '',
  },
  F03: {
    id: 'F03', name: 'Intercepteur de ligne', faction: 'federation',
    type: 'vaisseau', shipClass: 'intercepteur', rarity: 'commune', cost: 2, atk: 2, hp: 3,
    text: '',
  },
  F04: {
    id: 'F04', name: 'Technicien de coque', faction: 'federation',
    type: 'vaisseau', shipClass: 'soutien', rarity: 'commune', cost: 2, atk: 0, hp: 2,
    text: "À l'arrivée : un vaisseau allié ou votre station récupère 2 PV.",
    targetSpec: allyShipOrOwnStation,
    onEnter: (ctx) => {
      const t = ctx.targets![0];
      if (t.kind === 'station') healStation(ctx.state, ctx.owner, 2);
      else { const s = targetShip(ctx); if (s) healShip(s, 2); }
    },
  },
  F05: {
    id: 'F05', name: 'Bouclier déflecteur', faction: 'federation',
    type: 'module', rarity: 'commune', cost: 2, stationArmor: 1,
    text: 'Votre station a Blindage 1.',
  },
  F06: {
    id: 'F06', name: 'Tir de barrage', faction: 'federation',
    type: 'tactique', rarity: 'commune', cost: 1,
    text: 'Infligez 2 dégâts à un vaisseau ennemi.',
    targetSpec: enemyShip,
    play: (ctx) => { const t = targetShip(ctx); if (t) damageShip(ctx.state, t, 2); },
  },
  F07: {
    id: 'F07', name: "Frégate d'escorte", faction: 'federation',
    type: 'vaisseau', shipClass: 'corvette', rarity: 'commune', cost: 3, atk: 2, hp: 4,
    escorte: true, text: 'Escorte.',
  },
  F08: {
    id: 'F08', name: 'Vaisseau-hôpital', faction: 'federation',
    type: 'vaisseau', shipClass: 'soutien', rarity: 'commune', cost: 3, atk: 0, hp: 5,
    text: 'Au début de votre tour, chaque vaisseau allié récupère 1 PV.',
    startOfTurn: ({ state, owner }) => {
      for (const s of state.players[owner].fleet) healShip(s, 1);
    },
  },
  F09: {
    id: 'F09', name: 'Mobilisation générale', faction: 'federation',
    type: 'tactique', rarity: 'commune', cost: 4,
    text: 'Déployez deux jetons Chasseur 1/1.',
    play: ({ state, owner }) => { spawnShip(state, owner, 'TK1'); spawnShip(state, owner, 'TK1'); },
  },
  F10: {
    id: 'F10', name: 'Croiseur de la 7e Flotte', faction: 'federation',
    type: 'vaisseau', shipClass: 'croiseur', rarity: 'commune', cost: 5, atk: 4, hp: 6,
    text: '',
  },
  F11: {
    id: 'F11', name: 'Rappel stratégique', faction: 'federation',
    type: 'tactique', rarity: 'rare', cost: 2,
    text: 'Renvoyez un vaisseau dans la main de son propriétaire.',
    targetSpec: anyShip,
    play: (ctx) => {
      const ref = ctx.targets![0];
      const p = ctx.state.players[ref.player];
      const i = p.fleet.findIndex((s) => s.uid === ref.uid);
      if (i < 0) return;
      const [s] = p.fleet.splice(i, 1);
      const def = getDef(s.defId);
      if (!def.token) {
        if (p.hand.length >= HAND_LIMIT) p.discard.push(s.defId);
        else p.hand.push(s.defId);
      }
      addLog(ctx.state, `${def.name} est renvoyé.`);
    },
  },
  F12: {
    id: 'F12', name: "Escadron d'élite", faction: 'federation',
    type: 'vaisseau', shipClass: 'chasseur', rarity: 'rare', cost: 3, atk: 3, hp: 2,
    frappeRapide: true, text: 'Frappe rapide.',
  },
  F13: {
    id: 'F13', name: 'Tourelle automatisée', faction: 'federation',
    type: 'module', rarity: 'rare', cost: 3,
    text: 'Quand un vaisseau ennemi attaque votre station, infligez-lui 1 dégât.',
    onEnemyAttacksStation: (ctx) => {
      const s = findShip(ctx.state, otherPlayer(ctx.owner), ctx.attackerUid!);
      if (s) damageShip(ctx.state, s, 1);
    },
  },
  F14: {
    id: 'F14', name: 'Mur de déflexion', faction: 'federation',
    type: 'tactique', rarity: 'rare', cost: 3,
    text: "Votre station ne subit aucun dégât jusqu'à votre prochain tour.",
    play: ({ state, owner }) => {
      state.players[owner].stationImmuneUntil = state.turnCounter + 2;
    },
  },
  F15: {
    id: 'F15', name: 'Plateforme de réarmement', faction: 'federation',
    type: 'module', rarity: 'rare', cost: 3,
    text: 'Au début de votre tour, gagnez 1 énergie supplémentaire utilisable ce tour.',
    startOfTurn: ({ state, owner }) => { state.players[owner].energy += 1; },
  },
  F16: {
    id: 'F16', name: 'Chantier orbital', faction: 'federation',
    type: 'module', rarity: 'rare', cost: 4, shipCostDelta: -1,
    text: 'Vos vaisseaux coûtent 1 énergie de moins (minimum 1).',
  },
  F17: {
    id: 'F17', name: 'Commandant Aris Vega', faction: 'federation',
    type: 'vaisseau', shipClass: 'croiseur', rarity: 'rare', cost: 5, atk: 3, hp: 5,
    text: 'Vos autres vaisseaux ont +0/+1.',
    auraHp: () => 1,
  },
  F18: {
    id: 'F18', name: 'Cuirassé Aegis', faction: 'federation',
    type: 'vaisseau', shipClass: 'croiseur', rarity: 'rare', cost: 6, atk: 5, hp: 7,
    armor: 1, text: 'Blindage 1.',
  },
  F19: {
    id: 'F19', name: 'Ingénieure en chef Tally', faction: 'federation',
    type: 'vaisseau', shipClass: 'soutien', rarity: 'epique', cost: 4, atk: 1, hp: 4,
    moduleCostDelta: -1,
    text: 'Vos modules de station coûtent 1 de moins (minimum 1).',
  },
  F20: {
    id: 'F20', name: 'Protocole de défense totale', faction: 'federation',
    type: 'tactique', rarity: 'epique', cost: 5,
    text: 'Votre station récupère 5 PV et vous piochez une carte.',
    play: ({ state, owner }) => { healStation(state, owner, 5); drawCard(state, owner); },
  },
  F21: {
    id: 'F21', name: 'Frappe orbitale coordonnée', faction: 'federation',
    type: 'tactique', rarity: 'epique', cost: 6,
    text: 'Infligez 2 dégâts à chaque vaisseau ennemi.',
    play: ({ state, owner }) => {
      for (const s of [...state.players[otherPlayer(owner)].fleet]) damageShip(state, s, 2);
    },
  },
  F22: {
    id: 'F22', name: 'Dreadnought Souverain', faction: 'federation',
    type: 'vaisseau', shipClass: 'capital', rarity: 'epique', cost: 7, atk: 6, hp: 8,
    escorte: true, text: 'Escorte.',
  },
  F23: {
    id: 'F23', name: 'Citadelle volante', faction: 'federation',
    type: 'vaisseau', shipClass: 'capital', rarity: 'epique', cost: 8, atk: 4, hp: 10,
    escorte: true, armor: 1, text: 'Escorte, Blindage 1.',
  },
  F24: {
    id: 'F24', name: 'Cœur de la Fédération', faction: 'federation',
    type: 'module', rarity: 'legendaire', cost: 6,
    text: "À l'arrivée : votre station gagne 10 PV (peut dépasser 20).",
    onEnter: ({ state, owner }) => {
      state.players[owner].stationMaxHp += 10;
      state.players[owner].stationHp += 10;
    },
  },
  F25: {
    id: 'F25', name: 'ISS Indomptable', faction: 'federation',
    type: 'vaisseau', shipClass: 'capital', rarity: 'legendaire', cost: 9, atk: 7, hp: 9,
    armor: 2,
    text: "Blindage 2. À l'arrivée : votre station récupère 5 PV.",
    onEnter: ({ state, owner }) => { healStation(state, owner, 5); },
  },

  // ====================== CLANS DE LA CEINTURE ======================
  C01: {
    id: 'C01', name: 'Pillard de la Ceinture', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'chasseur', rarity: 'commune', cost: 1, atk: 2, hp: 1,
    frappeRapide: true, text: 'Frappe rapide.',
  },
  C02: {
    id: 'C02', name: 'Skiff de contrebande', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'chasseur', rarity: 'commune', cost: 1, atk: 1, hp: 1,
    furtif: true, text: 'Furtif.',
  },
  C03: {
    id: 'C03', name: 'Mine spatiale', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'soutien', rarity: 'commune', cost: 1, atk: 0, hp: 1,
    escorte: true,
    text: "Escorte. À la destruction : infligez 2 dégâts au vaisseau qui l'a détruite.",
    onDestroyed: (ctx) => {
      if (!ctx.destroyer) return;
      const s = findShip(ctx.state, ctx.destroyer.player, ctx.destroyer.uid);
      if (s) damageShip(ctx.state, s, 2, { player: ctx.owner, uid: ctx.selfUid! });
    },
  },
  C04: {
    id: 'C04', name: 'Sabotage', faction: 'ceinture',
    type: 'tactique', rarity: 'commune', cost: 2,
    text: 'Détruisez un module de station.',
    targetSpec: anyModule,
    play: (ctx) => {
      const t = ctx.targets![0];
      destroyModuleInst(ctx.state, t.player, t.uid!);
    },
  },
  C05: {
    id: 'C05', name: 'Intercepteur pirate', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'intercepteur', rarity: 'commune', cost: 2, atk: 3, hp: 1,
    text: '',
  },
  C06: {
    id: 'C06', name: "Récupérateur d'épaves", faction: 'ceinture',
    type: 'vaisseau', shipClass: 'soutien', rarity: 'commune', cost: 2, atk: 1, hp: 2,
    text: "À l'arrivée : si un vaisseau a été détruit ce tour, piochez une carte.",
    onEnter: ({ state, owner }) => {
      if (state.shipsDestroyedThisTurn > 0) drawCard(state, owner);
    },
  },
  C07: {
    id: 'C07', name: 'Abordeur', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'corvette', rarity: 'commune', cost: 3, atk: 3, hp: 2,
    text: "À l'arrivée : infligez 1 dégât à la station ennemie.",
    onEnter: ({ state, owner }) => { damageStation(state, otherPlayer(owner), 1); },
  },
  C08: {
    id: 'C08', name: 'Frégate du chaos', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'corvette', rarity: 'commune', cost: 3, atk: 2, hp: 3,
    frappeRapide: true, text: 'Frappe rapide.',
  },
  C09: {
    id: 'C09', name: 'Raid éclair', faction: 'ceinture',
    type: 'tactique', rarity: 'commune', cost: 3,
    text: "Vos vaisseaux gagnent +1/+0 jusqu'à la fin du tour.",
    play: ({ state, owner }) => {
      for (const s of state.players[owner].fleet) s.tempAtk += 1;
    },
  },
  C10: {
    id: 'C10', name: 'Canonnière rouillée', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'croiseur', rarity: 'commune', cost: 4, atk: 4, hp: 3,
    text: '',
  },
  C11: {
    id: 'C11', name: 'Extorsion', faction: 'ceinture',
    type: 'tactique', rarity: 'rare', cost: 2,
    text: 'Infligez 2 dégâts Perce-bouclier à la station ennemie et piochez une carte.',
    play: ({ state, owner }) => {
      damageStation(state, otherPlayer(owner), 2, false, true);
      drawCard(state, owner);
    },
  },
  C12: {
    id: 'C12', name: 'Brouilleur de visée', faction: 'ceinture',
    type: 'tactique', rarity: 'rare', cost: 2,
    text: "Un vaisseau ennemi ne peut pas attaquer jusqu'à votre prochain tour.",
    targetSpec: enemyShip,
    play: (ctx) => {
      const t = targetShip(ctx);
      if (t) t.jammedUntil = ctx.state.turnCounter + 2;
    },
  },
  C13: {
    id: 'C13', name: 'Nuée de drones', faction: 'ceinture',
    type: 'tactique', rarity: 'rare', cost: 3,
    text: 'Déployez trois jetons Drone 1/1.',
    play: ({ state, owner }) => {
      for (let i = 0; i < 3; i++) spawnShip(state, owner, 'TK2');
    },
  },
  C14: {
    id: 'C14', name: 'Baie de lancement pirate', faction: 'ceinture',
    type: 'module', rarity: 'rare', cost: 3,
    text: 'Au début de votre tour, déployez un jeton Drone 1/1.',
    startOfTurn: ({ state, owner }) => { spawnShip(state, owner, 'TK2'); },
  },
  C15: {
    id: 'C15', name: 'Capitaine Mordok', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'croiseur', rarity: 'rare', cost: 4, atk: 3, hp: 3,
    text: 'Vos autres Chasseurs ont +1/+0.',
    auraAtk: (_state, _self, other) =>
      getDef(other.defId).shipClass === 'chasseur' ? 1 : 0,
  },
  C16: {
    id: 'C16', name: 'Écumeur furtif', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'corvette', rarity: 'rare', cost: 4, atk: 3, hp: 3,
    furtif: true, text: 'Furtif.',
  },
  C17: {
    id: 'C17', name: 'Torpilles incendiaires', faction: 'ceinture',
    type: 'tactique', rarity: 'rare', cost: 4,
    text: 'Au choix : infligez 4 dégâts à un vaisseau, ou 2 dégâts Perce-bouclier à la station ennemie.',
    modes: [
      { hint: '4 dégâts à un vaisseau', targetSpec: anyShip },
      { hint: '2 dégâts Perce-bouclier à la station ennemie' },
    ],
    play: (ctx) => {
      if (ctx.mode === 0) {
        const t = targetShip(ctx);
        if (t) damageShip(ctx.state, t, 4);
      } else {
        damageStation(ctx.state, otherPlayer(ctx.owner), 2, false, true);
      }
    },
  },
  C18: {
    id: 'C18', name: 'Vaisseau-bélier', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'croiseur', rarity: 'rare', cost: 5, atk: 6, hp: 3,
    frappeRapide: true, mustAttack: true,
    text: "Frappe rapide. Doit attaquer chaque tour s'il le peut.",
  },
  C19: {
    id: 'C19', name: 'Saboteuse Nyx', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'chasseur', rarity: 'epique', cost: 3, atk: 2, hp: 2,
    furtif: true,
    text: 'Furtif. Quand Nyx inflige des dégâts à la station ennemie, détruisez un module de cette station.',
    onDealStationDamage: ({ state, owner }) => {
      const enemy = otherPlayer(owner);
      if (state.players[enemy].modules.length > 0)
        state.pendingDecision = { kind: 'destroyModule', player: owner, targetPlayer: enemy };
    },
  },
  C20: {
    id: 'C20', name: 'Marché noir orbital', faction: 'ceinture',
    type: 'module', rarity: 'epique', cost: 4, tacticCostDelta: -1,
    text: 'Vos Tactiques coûtent 1 de moins (minimum 1).',
  },
  C21: {
    id: 'C21', name: 'Flotte fantôme', faction: 'ceinture',
    type: 'tactique', rarity: 'epique', cost: 6,
    text: "Jusqu'à la fin du tour, vos vaisseaux ont Furtif (ils ignorent Escorte).",
    play: ({ state, owner }) => {
      for (const s of state.players[owner].fleet) s.tempFurtif = true;
    },
  },
  C22: {
    id: 'C22', name: 'Bombardement de la Ceinture', faction: 'ceinture',
    type: 'tactique', rarity: 'epique', cost: 6,
    text: 'Infligez 5 dégâts Perce-bouclier à la station ennemie.',
    play: ({ state, owner }) => { damageStation(state, otherPlayer(owner), 5, false, true); },
  },
  C23: {
    id: 'C23', name: 'Galion du Roi-Pirate', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'capital', rarity: 'epique', cost: 7, atk: 7, hp: 5,
    frappeRapide: true, text: 'Frappe rapide.',
  },
  C24: {
    id: 'C24', name: 'Reine corsaire Vessa', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'capital', rarity: 'legendaire', cost: 8, atk: 6, hp: 6,
    furtif: true,
    text: "Furtif. Quand Vessa inflige des dégâts à la station ennemie, l'adversaire défausse une carte au hasard.",
    onDealStationDamage: ({ state, owner }) => {
      const enemy = otherPlayer(owner);
      const hand = state.players[enemy].hand;
      if (hand.length === 0) return;
      const i = nextInt(state.rng, hand.length);
      const [c] = hand.splice(i, 1);
      state.players[enemy].discard.push(c);
      addLog(state, `Joueur ${enemy + 1} défausse ${getDef(c).name}.`);
    },
  },
  C25: {
    id: 'C25', name: 'Le Léviathan rouillé', faction: 'ceinture',
    type: 'vaisseau', shipClass: 'capital', rarity: 'legendaire', cost: 8, atk: 8, hp: 6,
    text: "À l'arrivée : infligez 2 dégâts à tous les autres vaisseaux.",
    onEnter: ({ state, selfUid }) => {
      for (const pid of [0, 1] as PlayerId[])
        for (const s of [...state.players[pid].fleet])
          if (s.uid !== selfUid) damageShip(state, s, 2);
    },
  },

  // ====================== TECHNIQUE ======================
  /** Carte cachée des vues réseau expurgées (main/deck adverses). Injouable. */
  XX: {
    id: 'XX', name: 'Carte cachée', faction: 'neutre',
    type: 'tactique', rarity: 'commune', cost: 99,
    text: '',
  },

  // ====================== JETONS ======================
  TK1: {
    id: 'TK1', name: 'Chasseur', faction: 'neutre',
    type: 'vaisseau', shipClass: 'chasseur', rarity: 'commune', cost: 0, atk: 1, hp: 1,
    token: true, text: 'Jeton.',
  },
  TK2: {
    id: 'TK2', name: 'Drone', faction: 'neutre',
    type: 'vaisseau', shipClass: 'chasseur', rarity: 'commune', cost: 0, atk: 1, hp: 1,
    token: true, text: 'Jeton.',
  },
};
