// Parcours en ligne : deux navigateurs → comptes → partie rapide → coups
// croisés → abandon. Nécessite `npm run dev` actif ; le serveur de jeu est
// lancé par le script lui-même sur une base jetable.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT) || 8787;
const dbDir = mkdtempSync(join(tmpdir(), 'armada-e2e-'));
const suffix = String(Date.now()).slice(-6); // comptes neufs à chaque passe
const errors = [];

// Le client vise ws://<hôte>:8787 : le port doit être libre, sinon la passe
// dialoguerait avec un serveur inconnu (base et comptes différents).
await new Promise((res, rej) => {
  const probe = createConnection({ host: '127.0.0.1', port: PORT });
  probe.on('connect', () => {
    probe.destroy();
    rej(new Error(`port ${PORT} déjà occupé : arrêtez le serveur de jeu (kill $(lsof -ti:${PORT}))`));
  });
  probe.on('error', () => res());
});

const srv = spawn('npx', ['tsx', 'src/server/main.ts'], {
  env: { ...process.env, PORT: String(PORT), ARMADA_DB: join(dbDir, 'e2e.db') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stderr.on('data', (d) => errors.push(`serveur: ${d.toString().trim()}`));
srv.on('exit', (code) => code && errors.push(`serveur: sorti avec le code ${code}`));
// Même en cas d'échec d'une assertion : ni serveur orphelin sur le port, ni base résiduelle.
process.on('exit', () => {
  srv.kill();
  rmSync(dbDir, { recursive: true, force: true });
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('serveur de jeu : démarrage trop long')), 20000);
  srv.stdout.on('data', (d) => {
    if (d.toString().includes('en écoute')) {
      clearTimeout(t);
      res();
    }
  });
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });

/** Un joueur = un contexte isolé (localStorage séparé, donc jeton séparé). */
async function joueur(pseudo) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${pseudo} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${pseudo} console: ${m.text()}`);
  });
  await page.goto('http://localhost:5173');
  const panel = page.locator('.online-panel');
  await panel.getByPlaceholder('Votre pseudo').waitFor({ timeout: 15000 });
  const nom = `${pseudo}${suffix}`;
  await panel.getByPlaceholder('Votre pseudo').fill(nom);
  await panel.getByPlaceholder('Mot de passe', { exact: false }).fill('motdepasse');
  return { page, panel, nom };
}

const alice = await joueur('Alice');
const bob = await joueur('Bob');

// 1. Authentification : le profil remplace les champs de saisie.
await alice.panel.getByText('Partie rapide').click();
await alice.panel.locator('.net-note', { hasText: 'victoire' }).waitFor({ timeout: 10000 });
await alice.page.screenshot({ path: '/tmp/armada-6-lobby-en-ligne.png' });
const profilTxt = await alice.panel.locator('.net-note').first().innerText();
console.log(`Profil Alice : ${profilTxt.replace(/\s+/g, ' ')}`);
if (!/cartes/.test(profilTxt)) errors.push('profil : collection absente du bandeau');
if (!/booster/.test(profilTxt)) errors.push('profil : boosters d’accueil absents');

// 2. Appariement : Bob rejoint la file, les deux plateaux s'ouvrent.
await bob.panel.getByText('Partie rapide').click();
for (const p of [alice.page, bob.page])
  await p.locator('.hand .card').first().waitFor({ timeout: 15000 });
const entete = await alice.page.locator('.turn-info').innerText();
console.log(`Bandeau : ${entete.replace(/\s+/g, ' ')}`);
if (!/⏱/.test(entete)) errors.push('bandeau : chrono de tour absent');

// 3. Vues expurgées : Alice voit sa main, jamais celle de Bob.
const mainAlice = await alice.page.locator('.my-side .hand .card').count();
const dosBob = await alice.page.locator('.enemy-side .hand-backs i').count();
console.log(`Main d'Alice : ${mainAlice} cartes · main de Bob : ${dosBob} dos`);
if (mainAlice === 0 || dosBob === 0) errors.push('vue : mains mal masquées');

// 4. Qui joue : le joueur actif agit, l'autre attend.
// (innerText applique le text-transform du bandeau : comparer en majuscules.)
const actif = (await alice.page.locator('.turn-info').innerText()).toUpperCase();
const [premier, second] = actif.includes(alice.nom.toUpperCase())
  ? [alice, bob]
  : [bob, alice];
console.log(`Joueur actif : ${premier.nom}`);
if (await second.page.locator('.counters .btn-primary:not([disabled])').count())
  errors.push('tour : le joueur inactif peut finir le tour');

// 5. Un générateur posé se propage à l'autre client.
await premier.page.locator('.hand .card:has(.cost-gen)').first().click();
await second.page
  .locator('.enemy-side .counters')
  .filter({ hasText: 'Générateurs ×1' })
  .waitFor({ timeout: 8000 })
  .catch(async () => {
    errors.push(
      `réplication : compteurs adverses « ${(await second.page.locator('.enemy-side .counters').innerText()).replace(/\s+/g, ' ')} »`,
    );
  });
console.log(`Générateur répliqué chez l’adversaire : ${errors.length === 0 ? 'oui' : 'non'}`);

// 6. Fin de tour : la main passe à l'autre joueur.
await premier.page.getByText('Fin de tour').click({ timeout: 3000 }).catch(() => {});
await second.page.locator('.counters .btn-primary:not([disabled])').waitFor({ timeout: 8000 });
console.log('Passation de tour : oui');
await premier.page.screenshot({ path: '/tmp/armada-7-online-plateau.png' });

// 7. Reconnexion : rechargement de la page, le jeton du localStorage ramène
//    dans la partie en cours (« Partie rapide » suffit, comme documenté).
await premier.page.reload();
await premier.panel.getByText('Partie rapide').click();
await premier.page.locator('.hand .card').first().waitFor({ timeout: 12000 });
const repriseTour = await premier.page.locator('.turn-info').innerText();
console.log(`Reprise après rechargement : ${repriseTour.replace(/\s+/g, ' ')}`);
if (
  !(await premier.page
    .locator('.my-side .counters')
    .filter({ hasText: 'Générateurs ×1' })
    .count())
)
  errors.push('reprise : le générateur posé avant la coupure a disparu');
// Aucun message d'erreur ne doit remonter à celui qui n'a pas bougé.
await second.page
  .locator('.toast')
  .waitFor({ timeout: 2000 })
  .then(async () =>
    errors.push(`reprise : erreur inutile chez l’adversaire « ${await second.page.locator('.toast').innerText()} »`),
  )
  .catch(() => {});

// 8. Abandon : l'adversaire reçoit la victoire, puis revient au lobby.
await second.page.getByText('Abandonner', { exact: false }).click();
await premier.page.locator('.overlay.opaque h2', { hasText: 'Victoire' }).waitFor({ timeout: 8000 });
console.log('Abandon → victoire annoncée : oui');
await premier.page.getByText('Retour au menu').click();
await premier.panel.getByText('Partie rapide').waitFor({ timeout: 8000 });

// 9. Booster : les 5 cartes tirées rejoignent la collection.
const avant = Number((await premier.panel.locator('.net-note').first().innerText()).match(/(\d+) cartes/)[1]);
await premier.panel.getByText('Ouvrir un booster', { exact: false }).click();
await premier.page.locator('.booster-list li').first().waitFor({ timeout: 8000 });
await premier.page.waitForTimeout(350); // laisser le fondu de la fenêtre se terminer
await premier.page.screenshot({ path: '/tmp/armada-8-booster.png' });
const tirage = await premier.page.locator('.booster-list li b').allInnerTexts();
console.log(`Booster : ${tirage.join(', ')}`);
if (tirage.length !== 5) errors.push(`booster : ${tirage.length} cartes au lieu de 5`);
await premier.page.getByText('Ajouter à la collection').click();
const apres = Number((await premier.panel.locator('.net-note').first().innerText()).match(/(\d+) cartes/)[1]);
if (apres !== avant + 5) errors.push(`collection : ${avant} → ${apres} cartes (attendu +5)`);

console.log(`Erreurs navigateur : ${errors.length}`);
for (const e of errors) console.log('  ' + e);
const ok = errors.length === 0;
console.log(ok ? 'E2E EN LIGNE OK' : 'E2E EN LIGNE ÉCHEC');
await browser.close();
srv.kill();
rmSync(dbDir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
