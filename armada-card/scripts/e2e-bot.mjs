// Bot E2E : joue plusieurs tours complets via l'interface (hot-seat des deux côtés).
// Stratégie naïve : poser un générateur, jouer ce qui est jouable, attaquer ce qui peut attaquer.
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto('http://localhost:5173/?seed=42');
await page.locator('.lobby-side').nth(1).getByText('Humain').click(); // vrai hot-seat
await page.getByText('Lancer la bataille').click();

async function clearModals() {
  if (await page.locator('.modal .btn-option').count()) {
    await page.locator('.modal .btn-option').first().click();
    await page.waitForTimeout(80);
  }
  if (await page.locator('.highlighted').count()) {
    await page.locator('.highlighted').first().click();
    await page.waitForTimeout(80);
  } else {
    await page.keyboard.press('Escape');
  }
}

const TURNS = 20;
for (let turn = 0; turn < TURNS; turn++) {
  // Partie terminée ?
  if (await page.locator('.overlay.opaque h2').count()) {
    const txt = await page.locator('.overlay.opaque h2').innerText();
    if (/Victoire|Égalité/.test(txt)) break;
  }
  // Écran de passation hot-seat
  if (await page.locator('.overlay .btn-primary').count()) {
    await page.locator('.overlay .btn-primary').first().click();
    await page.waitForTimeout(120);
  }
  // 1. Générateur
  if (await page.locator('.hand .card .cost-gen').count()) {
    await page.locator('.hand .card:has(.cost-gen)').first().click();
    await page.waitForTimeout(80);
  }
  // 2. Cartes jouables (max 5 tentatives)
  for (let i = 0; i < 5; i++) {
    const cards = page.locator('.hand .card.playable');
    if (!(await cards.count())) break;
    await cards.first().click();
    await page.waitForTimeout(80);
    await clearModals();
  }
  // 3. Attaques (priorité à la station ennemie)
  for (let i = 0; i < 8; i++) {
    const ready = page.locator('.my-side .ship.can-act:not(.selected)');
    if (!(await ready.count())) break;
    await ready.first().click();
    await page.waitForTimeout(60);
    const station = page.locator('.enemy-side .station.highlighted');
    const any = page.locator('.highlighted');
    if (await station.count()) await station.click();
    else if (await any.count()) await any.first().click();
    else {
      await page.keyboard.press('Escape');
      break;
    }
    await page.waitForTimeout(80);
  }
  // Fin de tour : manuelle, ou automatique si plus aucune action n'était possible.
  try {
    await page.getByText('Fin de tour').click({ timeout: 1500 });
  } catch {
    /* la fin de tour automatique a été plus rapide */
  }
  // Attendre l'écran suivant (passation ou victoire) avant de boucler.
  await page
    .locator('.overlay .btn-primary')
    .first()
    .waitFor({ timeout: 6000 })
    .catch(() => {});
}

await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/armada-5-bot.png' });
const log = await page.locator('.log').innerText();
const attacks = (log.match(/attaque/g) ?? []).length;
const plays = (log.match(/joue /g) ?? []).length;
console.log(`Tours joués : jusqu'à ${TURNS} · cartes jouées : ${plays} · attaques : ${attacks}`);
console.log(`Erreurs navigateur : ${errors.length}`);
for (const e of errors) console.log('  ' + e);
const ok = attacks > 0 && plays > 0 && errors.length === 0;
console.log(ok ? 'E2E OK' : 'E2E ÉCHEC');
await browser.close();
process.exit(ok ? 0 : 1);
