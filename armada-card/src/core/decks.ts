import { CARDS } from './cards';

export const DECK_MIN = 40;
export const MAX_COPIES = 3;
/** Le générateur de base est illimité, comme un terrain de base. */
export const UNLIMITED = new Set(['N01']);

function rep(id: string, n: number): string[] {
  return Array<string>(n).fill(id);
}

/** Deck de démarrage Fédération « Rempart » (40 cartes). */
export const DECK_REMPART: string[] = [
  ...rep('N01', 16),
  ...rep('F01', 3), ...rep('F03', 3), ...rep('F04', 2), ...rep('F05', 2),
  ...rep('F06', 2), ...rep('F07', 2), ...rep('F08', 2), ...rep('F10', 2),
  'F13', 'F16', 'F18', 'F22',
  ...rep('N06', 2),
];

/** Deck de démarrage Ceinture « Razzia » (40 cartes). */
export const DECK_RAZZIA: string[] = [
  ...rep('N01', 16),
  ...rep('C01', 3), ...rep('C02', 3), ...rep('C16', 2), ...rep('C07', 2),
  ...rep('C08', 2), ...rep('C09', 2), ...rep('C10', 2), ...rep('C11', 2),
  'C15', 'C17', 'C18', 'C23',
  ...rep('N06', 2),
];

/** Retourne la liste des problèmes du deck (vide = valide). */
export function validateDeck(deck: string[]): string[] {
  const errors: string[] = [];
  if (deck.length < DECK_MIN)
    errors.push(`Le deck contient ${deck.length} cartes (minimum ${DECK_MIN}).`);
  const counts = new Map<string, number>();
  for (const id of deck) {
    const def = CARDS[id];
    if (!def) { errors.push(`Carte inconnue : ${id}.`); continue; }
    if (def.token) { errors.push(`${def.name} est un jeton, interdit en deck.`); continue; }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, n] of counts) {
    if (!UNLIMITED.has(id) && n > MAX_COPIES)
      errors.push(`${CARDS[id].name} : ${n} exemplaires (maximum ${MAX_COPIES}).`);
  }
  return errors;
}
