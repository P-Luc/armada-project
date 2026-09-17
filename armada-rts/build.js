// Compilation minifiée vers dist/ — c'est dist/ qui part sur Cloudflare.
// Usage : bun build.js
//
// Le moteur est émis en IIFE, pas en module ES : le jeu reste chargé par un
// <script src> classique et le code garde exactement la même sémantique de
// portée. (En module ES, les variables top-level cessent d'être des globals,
// ce qui casserait les vérifications Playwright qui pilotent update()/mother.)
//
// index.html et gallery.html sont recopiés tels quels, jamais passés au
// bundler HTML : les SVG sont chargés par une URL construite à l'exécution
// (`assets/svg/${id}.svg`), donc invisibles du bundler, qui les laisserait
// derrière lui. assets/ est copié à l'identique pour la même raison.

import { rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises';

const racine = import.meta.dir;
const dist = `${racine}/dist`;

const version = (await readFile(`${racine}/game.js`, 'utf8'))
  .match(/GAME_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? 'dev';

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const compiler = async (entree, nom) => {
  const r = await Bun.build({
    entrypoints: [`${racine}/${entree}`],
    target: 'browser',
    format: 'iife',
    minify: true,
    naming: nom,
    outdir: dist,
  });
  if (!r.success) {
    for (const m of r.logs) console.error(m);
    throw new Error(`échec de compilation : ${entree}`);
  }
};

await compiler('game.js', '[dir]/game.js');
await compiler('style.css', '[dir]/style.css');

// Les références sont horodatées par la version : plus de vieux game.js servi
// par le cache du navigateur pendant que le HUD annonce une autre version.
const html = (await readFile(`${racine}/index.html`, 'utf8'))
  .replace(/(href="style\.css)"/, `$1?v=${version}"`)
  .replace(/(src="game\.js)"/, `$1?v=${version}"`);
await writeFile(`${dist}/index.html`, html);

await cp(`${racine}/gallery.html`, `${dist}/gallery.html`);
await cp(`${racine}/favicon.svg`, `${dist}/favicon.svg`);
await cp(`${racine}/assets`, `${dist}/assets`, { recursive: true });

const taille = async (f) => (await Bun.file(f).arrayBuffer()).byteLength;
const ko = (n) => `${(n / 1024).toFixed(1)} ko`;
for (const f of ['game.js', 'style.css']) {
  const avant = await taille(`${racine}/${f}`);
  const apres = await taille(`${dist}/${f}`);
  const gain = (100 * (1 - apres / avant)).toFixed(0);
  console.log(`${f.padEnd(11)} ${ko(avant)} → ${ko(apres)}  (−${gain} %)`);
}
console.log(`dist/ prêt — ${version}`);
