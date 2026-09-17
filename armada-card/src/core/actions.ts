import type { GameState, PlayerId, TargetRef } from './types';
import {
  attack,
  decide,
  endTurn,
  guardShip,
  playCard,
  playGenerator,
} from './game';

/**
 * Actions sérialisables : le client en ligne envoie des intentions, le serveur
 * autoritaire les applique via le moteur. Le mode local passe par le même chemin.
 */
export type GameAction =
  | { type: 'generator'; handIndex: number }
  | { type: 'play'; handIndex: number; targets?: TargetRef[]; mode?: number }
  | { type: 'attack'; uid: number; target: TargetRef }
  | { type: 'guard'; uid: number }
  | { type: 'endTurn' }
  | { type: 'decide'; bottom?: boolean; uid?: number };

export function applyAction(state: GameState, a: GameAction): void {
  switch (a.type) {
    case 'generator':
      playGenerator(state, a.handIndex);
      break;
    case 'play':
      playCard(state, a.handIndex, { targets: a.targets, mode: a.mode });
      break;
    case 'attack':
      attack(state, a.uid, a.target);
      break;
    case 'guard':
      guardShip(state, a.uid);
      break;
    case 'endTurn':
      endTurn(state);
      break;
    case 'decide':
      decide(state, { bottom: a.bottom, uid: a.uid });
      break;
    default:
      throw new Error('Action inconnue.');
  }
}

/** Vérifie que le siège `seat` a bien le droit de jouer cette action. */
export function assertActor(state: GameState, seat: PlayerId, a: GameAction): void {
  if (a.type === 'decide') {
    if (!state.pendingDecision || state.pendingDecision.player !== seat)
      throw new Error("Ce n'est pas à vous de décider.");
    return;
  }
  if (state.active !== seat) throw new Error("Ce n'est pas votre tour.");
}

/** Une action est-elle légale ? (rejouée sur un clone, fidélité parfaite aux règles) */
export function legalAction(state: GameState, a: GameAction): boolean {
  const c = structuredClone(state);
  try {
    applyAction(c, a);
    return true;
  } catch {
    return false;
  }
}

/**
 * Vue expurgée pour un joueur : main et deck adverses remplacés par des cartes
 * cachées (`XX`), propre deck masqué (l'ordre ne doit pas fuiter), graine RNG
 * retirée, décision en attente cachée à l'adversaire. Les longueurs sont
 * préservées pour que l'interface affiche les bons compteurs.
 */
export function redactView(state: GameState, seat: PlayerId): GameState {
  const v = structuredClone(state);
  v.rng = { seed: 0 };
  for (const pid of [0, 1] as PlayerId[]) {
    const p = v.players[pid];
    p.deck = p.deck.map(() => 'XX');
    if (pid !== seat) p.hand = p.hand.map(() => 'XX');
  }
  if (v.pendingDecision && v.pendingDecision.player !== seat)
    delete v.pendingDecision.cardId;
  return v;
}
