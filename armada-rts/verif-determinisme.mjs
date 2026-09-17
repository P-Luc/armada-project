/* Vérification du déterminisme de la simulation (préalable au multijoueur).
   Deux pages, même graine, fenêtres et densités d'écran différentes : après
   N ticks, les sommes de contrôle doivent être identiques. Si elles divergent,
   c'est qu'un tirage cosmétique (étoiles, particules, son) ou une donnée locale
   (fenêtre, brouillard, caméra) s'est glissé dans la simulation.

   Usage : node verif-determinisme.mjs
   (playwright-core est cherché dans le dossier courant, global, ou armada-card) */

const CHEMINS_PW = [
  'playwright-core',
  'playwright',
  '/Users/pl/ClaudeCodeProjects/armada/armada-card/node_modules/playwright-core/index.js',
];
async function chargerChromium() {
  for (const p of CHEMINS_PW) {
    try {
      const m = await import(p);
      // playwright-core est en CommonJS : chargé par `import`, tout est sous `default`.
      const chromium = m.chromium ?? m.default?.chromium;
      if (chromium) return chromium;
    } catch {
      /* essai suivant */
    }
  }
  throw new Error('playwright-core introuvable — installez-le ou lancez depuis un dossier qui en dispose.');
}

const URL_JEU = 'file://' + import.meta.dirname + '/index.html';
const GRAINE = 424242;
const JALONS = [600, 1800, 3600]; // ticks cumulés (30 Hz) → 20 s, 60 s, 120 s de jeu
const chromium = await chargerChromium();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const erreurs = [];

/** Déroule une partie tick par tick et relève la somme de contrôle aux jalons. */
async function derouler(faction, graine, vue) {
  const page = await browser.newPage({ viewport: vue.viewport, deviceScaleFactor: vue.dsf });
  const pannes = [];
  page.on('pageerror', (e) => pannes.push(e.message));
  await page.goto(URL_JEU);
  await page.waitForFunction(() => typeof startGame === 'function');
  const relevés = await page.evaluate(
    ({ faction, graine, jalons }) => {
      startGame(faction, graine);
      paused = true; // on avance à la main : la boucle rAF ne doit pas simuler en plus
      const out = [];
      let fait = 0;
      for (const j of jalons) {
        while (fait < j) {
          update(TICK);
          tick++;
          fait++;
        }
        out.push({ tick: j, somme: sommeControle(), unites: ships.filter((s) => !s.dead).length });
      }
      return out;
    },
    { faction, graine, jalons: JALONS },
  );
  await page.close();
  if (pannes.length) erreurs.push(`${faction} ${vue.nom} : erreur de page — ${pannes[0]}`);
  return relevés;
}

const VUE_A = { nom: '1280×800 ×1', viewport: { width: 1280, height: 800 }, dsf: 1 };
const VUE_B = { nom: '900×1400 ×2', viewport: { width: 900, height: 1400 }, dsf: 2 };

for (const faction of ['arche', 'collective']) {
  const a = await derouler(faction, GRAINE, VUE_A);
  const b = await derouler(faction, GRAINE, VUE_B);
  for (let i = 0; i < JALONS.length; i++) {
    const ok = a[i].somme === b[i].somme;
    console.log(
      `${faction.padEnd(10)} tick ${String(a[i].tick).padStart(4)} · ${a[i].unites} unités · ` +
        `${a[i].somme.toString(16).padStart(8, '0')} vs ${b[i].somme.toString(16).padStart(8, '0')} — ${ok ? 'identique' : 'DIVERGENCE'}`,
    );
    if (!ok) erreurs.push(`${faction} : divergence au tick ${a[i].tick}`);
  }
  // Contrôle en sens inverse : une autre graine doit changer le monde.
  const c = await derouler(faction, GRAINE + 1, VUE_A);
  if (c[0].somme === a[0].somme) erreurs.push(`${faction} : la graine n'a aucun effet (somme figée)`);
}

console.log(`\nErreurs : ${erreurs.length}`);
for (const e of erreurs) console.log('  ' + e);
console.log(erreurs.length === 0 ? 'DÉTERMINISME OK' : 'DÉTERMINISME ÉCHEC');
await browser.close();
process.exit(erreurs.length ? 1 : 0);
