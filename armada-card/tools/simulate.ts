/**
 * Simulateur d'équilibrage : fait s'affronter deux IA sur N parties
 * (positions alternées) et rapporte les taux de victoire.
 *
 *   npm run sim          → 100 parties
 *   npm run sim -- 500   → 500 parties
 */
import { newGame } from '../src/core/game';
import { aiStep } from '../src/core/ai';
import { DECK_RAZZIA, DECK_REMPART } from '../src/core/decks';

const N = Number(process.argv[2]) || 100;
const wins = { rempart: 0, razzia: 0, nulle: 0 };
const winsBySeat = { j1: 0, j2: 0 };
const turns: number[] = [];

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const swap = i % 2 === 1;
  const names: ['rempart' | 'razzia', 'rempart' | 'razzia'] = swap
    ? ['razzia', 'rempart']
    : ['rempart', 'razzia'];
  const g = newGame(
    swap ? DECK_RAZZIA : DECK_REMPART,
    swap ? DECK_REMPART : DECK_RAZZIA,
    1000 + i,
  );
  let steps = 6000;
  while (!g.over && steps-- > 0 && g.turnCounter < 120) aiStep(g);
  if (!g.over || g.winner === undefined) {
    wins.nulle++;
  } else {
    wins[names[g.winner]]++;
    winsBySeat[g.winner === 0 ? 'j1' : 'j2']++;
    turns.push(g.turnCounter);
  }
}
const dt = ((Date.now() - t0) / 1000).toFixed(1);

const pct = (n: number) => `${((100 * n) / N).toFixed(1)} %`;
const avg = turns.length
  ? (turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(1)
  : '—';

console.log(`\nARMADA — simulation IA contre IA (${N} parties, ${dt} s)`);
console.log('─'.repeat(48));
console.log(`Rempart (Fédération) : ${wins.rempart}  (${pct(wins.rempart)})`);
console.log(`Razzia (Ceinture)    : ${wins.razzia}  (${pct(wins.razzia)})`);
console.log(`Nulles / non finies  : ${wins.nulle}  (${pct(wins.nulle)})`);
console.log('─'.repeat(48));
console.log(`Joueur 1 : ${winsBySeat.j1}  (${pct(winsBySeat.j1)})   Joueur 2 : ${winsBySeat.j2}  (${pct(winsBySeat.j2)})`);
console.log(`Durée moyenne d'une partie : ${avg} tours de joueur\n`);
