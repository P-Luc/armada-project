import { newGame, spawnShip } from '../src/core/game';
import type { GameState, PlayerId, ShipInstance } from '../src/core/types';

export function rep(id: string, n: number): string[] {
  return Array<string>(n).fill(id);
}

/** Partie neutre : decks remplis de générateurs de base, aucun hasard gênant. */
export function bare(seed = 1): GameState {
  return newGame(rep('N01', 40), rep('N01', 40), seed);
}

/** Ajoute une carte en main et retourne son index. */
export function give(state: GameState, pid: PlayerId, defId: string): number {
  state.players[pid].hand.push(defId);
  return state.players[pid].hand.length - 1;
}

/** Rend un vaisseau prêt à attaquer (annule le mal de saut). */
export function ready(ship: ShipInstance): ShipInstance {
  ship.enteredTurn = 0;
  return ship;
}

/** Déploie directement un vaisseau prêt à attaquer. */
export function put(state: GameState, pid: PlayerId, defId: string): ShipInstance {
  return ready(spawnShip(state, pid, defId)!);
}

/** Retire les boucliers des deux stations (tests ciblant la coque). */
export function stripShields(state: GameState): GameState {
  for (const p of state.players) {
    p.shield = 0;
    p.shieldMax = 0;
  }
  return state;
}

/** Pose directement un module et retourne son uid. */
export function addModule(state: GameState, pid: PlayerId, defId: string): number {
  const uid = state.nextUid++;
  state.players[pid].modules.push({ uid, defId, owner: pid });
  return uid;
}
