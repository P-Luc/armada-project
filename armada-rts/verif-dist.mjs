// Non-régression du build minifié : dist/ est servi en HTTP, le jeu tourne
// pour de vrai (rAF, pas de pilotage par update()) et on refuse la moindre
// erreur de page, requête en échec ou image non décodée.
//
// Test en boîte noire : le bundle est une IIFE, donc update()/mother/ships ne
// sont plus des globals — c'est verif-solo.mjs qui couvre la simulation, sur
// les sources. Ici on vérifie que ce qui part en production démarre, rend et
// charge ses 26 SVG.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';

const dist = `${import.meta.dirname}/dist`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const CHEMINS_PW = [
  'playwright-core',
  'playwright',
  '/Users/pl/ClaudeCodeProjects/armada/armada-card/node_modules/playwright-core/index.js',
];
let chromium;
for (const p of CHEMINS_PW) {
  try {
    const m = await import(p);
    chromium = m.chromium ?? m.default?.chromium;
    if (chromium) break;
  } catch { /* essai suivant */ }
}
if (!chromium) throw new Error('playwright-core introuvable.');

const manquants = new Set();
const serveur = createServer(async (req, res) => {
  const chemin = normalize(decodeURI(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = `${dist}${chemin === '/' ? '/index.html' : chemin}`;
  try {
    const buf = await readFile(f);
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    // Journalisé côté serveur : une requête du navigateur lui-même (favicon)
    // n'apparaît pas toujours dans les événements de la page.
    manquants.add(chemin);
    res.writeHead(404).end('non trouvé');
  }
});
await new Promise((ok) => serveur.listen(0, ok));
const base = `http://127.0.0.1:${serveur.address().port}`;

const erreurs = [];
const navigateur = await chromium.launch({ channel: 'chrome', headless: true });

for (const dpr of [1, 2]) {
  const ctx = await navigateur.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const marque = (m) => erreurs.push(`dpr${dpr} — ${m}`);

  page.on('pageerror', (e) => marque(`erreur de page : ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && marque(`console : ${m.text()}`));
  page.on('requestfailed', (r) => marque(`requête échouée : ${r.url()}`));
  page.on('response', (r) => r.status() >= 400 && marque(`HTTP ${r.status()} : ${r.url()}`));

  await page.goto(`${base}/index.html?graine=42`, { waitUntil: 'load' });
  await page.click('#btn-start');
  await page.waitForTimeout(20000); // 20 s de jeu réel : IA, tirs, brouillard, mort d'unités

  // Les images doivent être décodées, pas seulement instanciées (cf. svgPret).
  const svg = await page.evaluate(() => {
    const imgs = [...document.images, ...performance.getEntriesByType('resource')
      .filter((r) => r.name.endsWith('.svg')).map((r) => r.name)];
    return {
      demandes: performance.getEntriesByType('resource').filter((r) => r.name.includes('/assets/svg/')).length,
      vides: performance.getEntriesByType('resource')
        .filter((r) => r.name.includes('/assets/svg/') && r.transferSize === 0 && r.decodedBodySize === 0).length,
      imgs: imgs.length,
    };
  });
  if (svg.demandes === 0) marque('aucun SVG demandé — les assets ne sont pas chargés');
  if (svg.vides > 0) marque(`${svg.vides} SVG servis vides`);

  const version = await page.textContent('#hud-version').catch(() => null);
  await page.screenshot({ path: `/tmp/dist-dpr${dpr}.png` });
  console.log(`dpr${dpr} : ${svg.demandes} SVG chargés, version affichée « ${version?.trim()} »`);

  await ctx.close();
}

await navigateur.close();
serveur.close();

for (const m of manquants) erreurs.push(`404 sur ${m}`);

if (erreurs.length) {
  console.error(`\n✘ ${erreurs.length} problème(s) :`);
  for (const e of [...new Set(erreurs)]) console.error(`  ${e}`);
  process.exit(1);
}
console.log('\n✔ build minifié : aucune erreur');
