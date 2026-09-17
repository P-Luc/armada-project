// Parcours de fumée : lobby → lancement → plateau → poser un générateur → fin de tour.
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto('http://localhost:5173');

// 1. Lobby — passer J2 en Humain pour tester le hot-seat
await page.getByText('Lancer la bataille').waitFor({ timeout: 15000 });
await page.locator('.lobby-side').nth(1).getByText('Humain').click();
await page.screenshot({ path: '/tmp/armada-1-lobby.png' });
await page.getByText('Lancer la bataille').click();

// 2. Écran de passation (hot-seat)
await page.getByText('Commencer le tour').waitFor();
await page.screenshot({ path: '/tmp/armada-2-handoff.png' });
await page.getByText('Commencer le tour').click();

// 3. Plateau : bouton fin de tour + main visible
await page.getByText('Fin de tour').waitFor();
const handCards = await page.locator('.hand .card').count();
console.log(`Cartes en main : ${handCards}`);

// 4. Jouer un générateur (badge vert ⌬)
await page.locator('.hand .card .cost-gen').first().click();
await page.getByText('déploie', { exact: false }).first().waitFor();
await page.screenshot({ path: '/tmp/armada-3-board.png' });

// 5. Fin de tour (manuelle, ou automatique si plus d'action possible)
//    → passation au joueur 2 (laisser finir le fondu avant la capture)
try {
  await page.getByText('Fin de tour').click({ timeout: 1200 });
} catch {
  /* la fin de tour automatique a été plus rapide */
}
// « Joueur 2 » apparaît aussi sur la station : viser l'écran de passation.
await page.locator('.handoff h2', { hasText: 'Joueur 2' }).waitFor({ timeout: 8000 });
await page.waitForTimeout(450);
await page.screenshot({ path: '/tmp/armada-4-j2.png' });

console.log(`Erreurs navigateur : ${errors.length}`);
for (const e of errors) console.log('  ' + e);
await browser.close();
process.exit(errors.length ? 1 : 0);
