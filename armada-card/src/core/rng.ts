/** RNG déterministe (LCG) : une même graine rejoue exactement la même partie. */
export interface Rng {
  seed: number;
}

export function nextInt(rng: Rng, maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error('nextInt : borne invalide');
  rng.seed = (Math.imul(rng.seed, 1664525) + 1013904223) >>> 0;
  return rng.seed % maxExclusive;
}

export function shuffle<T>(rng: Rng, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
