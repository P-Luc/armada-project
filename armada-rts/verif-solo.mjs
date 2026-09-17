/* Contrôle de non-régression du jeu solo : la partie démarre, tourne, et l'écran
   reste sain après deux minutes de simulation (aucune erreur de page). */
const CHEMINS_PW = [
  'playwright-core',
  'playwright',
  '/Users/pl/ClaudeCodeProjects/armada/armada-card/node_modules/playwright-core/index.js',
];
async function chargerChromium() {
  for (const p of CHEMINS_PW) {
    try {
      const m = await import(p);
      const chromium = m.chromium ?? m.default?.chromium;
      if (chromium) return chromium;
    } catch {
      /* essai suivant */
    }
  }
  throw new Error('playwright-core introuvable.');
}

const URL_JEU = 'file://' + import.meta.dirname + '/index.html';
const chromium = await chargerChromium();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const erreurs = [];

for (const faction of ['arche', 'collective']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => erreurs.push(`${faction} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(`${faction} console: ${m.text()}`));
  await page.goto(URL_JEU);
  await page.waitForFunction(() => typeof startGame === 'function');
  const bilan = await page.evaluate((f) => {
    startGame(f, 424242);
    paused = true;
    for (let i = 0; i < 3600; i++) { update(TICK); tick++; }
    paused = false;
    return {
      version: GAME_VERSION,
      etat: state,
      unites: ships.filter((s) => !s.dead).length,
      structures: structs.filter((s) => !s.dead).length,
      metal: Math.round(metal),
      energie: Math.round(energy),
      tick,
    };
  }, faction);
  await page.waitForTimeout(500); // laisser la boucle rAF rendre quelques images
  await page.screenshot({ path: `/tmp/eveil-solo-${faction}.png` });
  console.log(
    `${faction.padEnd(10)} ${bilan.version} · état ${bilan.etat} · tick ${bilan.tick} · ` +
      `${bilan.unites} unités · ${bilan.structures} structures · ${bilan.metal}◆ ${bilan.energie}⚡`,
  );
  if (bilan.unites === 0) erreurs.push(`${faction} : plus aucune unité après 2 minutes`);
  await page.close();
}

console.log(`\nErreurs : ${erreurs.length}`);
for (const e of erreurs) console.log('  ' + e);
console.log(erreurs.length === 0 ? 'SOLO OK' : 'SOLO ÉCHEC');
await browser.close();
process.exit(erreurs.length ? 1 : 0);
