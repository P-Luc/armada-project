import { CARDS } from './cards';
import type { Rarity } from './types';

/**
 * Boosters : 5 cartes — 3 communes, 1 rare, 1 carte spéciale
 * (60 % rare, 30 % épique, 10 % légendaire).
 * Le générateur de base (N01) est illimité et n'apparaît pas en booster ;
 * les jetons et la carte cachée technique non plus.
 */
export const BOOSTER_SIZE = 5;

export const BOOSTER_POOL: Record<Rarity, string[]> = (() => {
  const pool: Record<Rarity, string[]> = {
    commune: [],
    rare: [],
    epique: [],
    legendaire: [],
  };
  for (const def of Object.values(CARDS)) {
    if (def.token || def.id === 'XX' || def.id === 'N01') continue;
    pool[def.rarity].push(def.id);
  }
  return pool;
})();

/** Tire un booster. `rand(n)` doit retourner un entier de 0 à n-1. */
export function drawBooster(rand: (maxExclusive: number) => number): string[] {
  const pick = (r: Rarity) => BOOSTER_POOL[r][rand(BOOSTER_POOL[r].length)];
  const cards = [pick('commune'), pick('commune'), pick('commune'), pick('rare')];
  const roll = rand(100);
  cards.push(pick(roll < 10 ? 'legendaire' : roll < 40 ? 'epique' : 'rare'));
  return cards;
}
