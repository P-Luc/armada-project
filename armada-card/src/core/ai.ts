import type { GameState, PlayerId, TargetRef } from './types';
import { getDef } from './cards';
import {
  attack,
  decide,
  effAtk,
  effHp,
  endTurn,
  getCost,
  guardShip,
  isJammed,
  playCard,
  playGenerator,
} from './game';

/**
 * IA gloutonne à un coup d'avance : chaque action légale est simulée sur un
 * clone de l'état, puis notée par `evaluate` ; la meilleure est jouée.
 */

function totalOutput(g: GameState, pid: PlayerId): number {
  return g.players[pid].generators.reduce(
    (n, id) => n + (getDef(id).energyOutput ?? 0),
    0,
  );
}

function fleetValue(g: GameState, pid: PlayerId): number {
  let v = 0;
  for (const s of g.players[pid].fleet) {
    const d = getDef(s.defId);
    v += Math.max(0, effHp(g, s) - s.damage);
    if (!isJammed(g, s)) v += 1.6 * effAtk(g, s);
    if (d.escorte) v += 1;
    if (d.furtif && !s.stealthBroken) v += 1;
    if (s.guarding) v += 1.2;
    v += 1.5 * (d.armor ?? 0);
  }
  return v;
}

export function evaluate(g: GameState, me: PlayerId): number {
  const en = (1 - me) as PlayerId;
  if (g.over) return g.winner === me ? 1e6 : g.winner === undefined ? 0 : -1e6;
  const P = g.players[me];
  const E = g.players[en];
  let s = 0;
  s += 4 * P.stationHp - 4.2 * E.stationHp;
  s += 1.5 * P.shield - 1.5 * E.shield;
  s += fleetValue(g, me) - fleetValue(g, en);
  for (const m of P.modules) s += 1.4 * getDef(m.defId).cost;
  for (const m of E.modules) s -= 1.4 * getDef(m.defId).cost;
  s += 1.2 * P.hand.length - 1.2 * E.hand.length;
  s += 2 * totalOutput(g, me) - 2 * totalOutput(g, en);
  if (P.stationImmuneUntil > g.turnCounter) s += 3;
  s += 0.05 * P.energy;
  return s;
}

function allTargets(g: GameState): TargetRef[] {
  const out: TargetRef[] = [];
  for (const pid of [0, 1] as PlayerId[]) {
    out.push({ kind: 'station', player: pid });
    for (const s of g.players[pid].fleet)
      out.push({ kind: 'ship', player: pid, uid: s.uid });
    for (const m of g.players[pid].modules)
      out.push({ kind: 'module', player: pid, uid: m.uid });
  }
  return out;
}

type Cand = (c: GameState) => void;

function* candidates(g: GameState): Generator<Cand> {
  const me = g.active;
  const P = g.players[me];
  const targets = allTargets(g);
  const seen = new Set<string>();
  for (let i = 0; i < P.hand.length; i++) {
    const id = P.hand[i];
    if (seen.has(id)) continue;
    seen.add(id);
    const d = getDef(id);
    if (d.type === 'generateur') continue; // géré à part, une fois par tour
    if (getCost(g, me, id) > P.energy) continue;
    const modes = d.modes ? d.modes.map((_, m) => m) : [undefined];
    for (const m of modes) {
      const spec = m === undefined ? d.targetSpec : d.modes![m].targetSpec;
      if (spec?.required) {
        for (const t of targets) {
          if (!spec.validate(g, me, t)) continue;
          yield (c) => playCard(c, i, { targets: [t], mode: m });
        }
      } else {
        yield (c) => playCard(c, i, { mode: m });
      }
    }
  }
  const en = (1 - me) as PlayerId;
  for (const s of P.fleet) {
    if (s.attacksUsed > 0) continue;
    yield (c) => guardShip(c, s.uid);
    yield (c) => attack(c, s.uid, { kind: 'station', player: en });
    for (const t of g.players[en].fleet)
      yield (c) => attack(c, s.uid, { kind: 'ship', player: en, uid: t.uid });
  }
}

function bestGeneratorIndex(g: GameState): number {
  const hand = g.players[g.active].hand;
  let fallback = -1;
  for (let i = 0; i < hand.length; i++) {
    const d = getDef(hand[i]);
    if (d.type !== 'generateur') continue;
    if (d.id === 'N01') return i; // le générateur sans inconvénient d'abord
    if (fallback < 0) fallback = i;
  }
  return fallback;
}

function resolvePending(g: GameState): void {
  const d = g.pendingDecision!;
  if (d.kind === 'scry1') {
    const def = getDef(d.cardId!);
    const bottom = def.type === 'generateur' && totalOutput(g, d.player) >= 5;
    decide(g, { bottom });
  } else {
    const mods = g.players[d.targetPlayer!].modules;
    const pick = mods.reduce((a, b) =>
      getDef(b.defId).cost > getDef(a.defId).cost ? b : a,
    );
    decide(g, { uid: pick.uid });
  }
}

/** Attaque imposée (Vaisseau-bélier) quand la fin de tour est refusée. */
export function forcedAttack(g: GameState): boolean {
  const me = g.active;
  const en = (1 - me) as PlayerId;
  for (const s of g.players[me].fleet) {
    if (!getDef(s.defId).mustAttack || s.attacksUsed > 0) continue;
    const targets: TargetRef[] = [
      { kind: 'station', player: en },
      ...g.players[en].fleet.map(
        (t): TargetRef => ({ kind: 'ship', player: en, uid: t.uid }),
      ),
    ];
    for (const t of targets) {
      const c = structuredClone(g);
      try {
        attack(c, s.uid, t);
      } catch {
        continue;
      }
      attack(g, s.uid, t);
      return true;
    }
  }
  return false;
}

/**
 * Joue UNE étape du tour de l'IA (décision, générateur, meilleure action,
 * ou fin de tour). Retourne `false` quand le tour est terminé ou la partie finie.
 */
export function aiStep(g: GameState): boolean {
  if (g.over) return false;
  if (g.pendingDecision) {
    resolvePending(g);
    return true;
  }
  const me = g.active;
  if (!g.players[me].playedGenerator) {
    const gi = bestGeneratorIndex(g);
    if (gi >= 0) {
      playGenerator(g, gi);
      return true;
    }
  }
  const before = evaluate(g, me);
  let best: { score: number; run: Cand } | null = null;
  for (const cand of candidates(g)) {
    const c = structuredClone(g);
    try {
      cand(c);
    } catch {
      continue;
    }
    const score = evaluate(c, me);
    if (!best || score > best.score) best = { score, run: cand };
  }
  if (best && best.score > before + 0.01) {
    try {
      best.run(g);
      return true;
    } catch {
      /* l'état réel a divergé : on termine le tour */
    }
  }
  try {
    endTurn(g);
  } catch {
    if (forcedAttack(g)) return true;
    return false;
  }
  return false;
}

/** Joue le tour complet de l'IA (utilisé par le simulateur). */
export function aiTakeTurn(g: GameState): void {
  const me = g.active;
  let guard = 200;
  while (!g.over && g.active === me && guard-- > 0) {
    if (!aiStep(g)) break;
  }
}
