import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { guard, services, prepare, retire, projectId } from './sevenAmendmentsStagingFixture.mjs';

const origin = 'https://acadea-staging.vercel.app';
const output = 'diagnostics/five-amendments-staging';
const results = [];
const checked = async (name, run) => {
  try { await run(); results.push({ name, result: 'PASS' }); console.log(`PASS: ${name}`); }
  catch (error) { results.push({ name, result: 'FAIL', detail: String(error.message).slice(0, 400) }); process.exitCode = 1; console.error(`FAIL: ${name}`); }
};
const yesterday = day => new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
const expectedSha = process.env.ACADEA_EXPECTED_SHA;

guard();
assert.equal(process.env.ACADEA_FIVE_STAGING, 'YES');
assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/);
assert.ok(process.env.STAGING_FIREBASE_API_KEY, 'Configuration Auth Staging absente.');
// No Auth token, fixture or write exists before these deployment checks.
const version = await fetch(origin + '/version.json', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
assert.equal(version.status, 200, 'Staging inaccessible ; aucune fixture créée.');
assert.equal((await version.json()).version, expectedSha, 'SHA Staging incorrect ; aucune fixture créée.');
const home = await (await fetch(origin, { signal: AbortSignal.timeout(15000) })).text();
const asset = home.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(asset, 'Bundle Staging absent ; aucune fixture créée.');
const bundle = await (await fetch(origin + asset, { signal: AbortSignal.timeout(15000) })).text();
assert.ok(/projectId\s*:\s*["']acadea-staging["']/.test(bundle)
  && !/projectId\s*:\s*["']acadea-production["']/.test(bundle)
  && !bundle.includes('acadea-production.firebaseapp.com'), 'Firebase hébergé incorrect ; aucune fixture créée.');
mkdirSync(output, { recursive: true });
results.push({ name: 'SHA et Firebase du frontend/API candidat avant fixtures', result: 'PASS' });

const s = services();
let m, password, browser;
const tokens = new Map();
const school = () => m.schools[0];
async function withRole(key, run, { serviceWorkers = 'block' } = {}) {
  const account = m.users.find(user => user.key === key);
  assert.ok(account, 'Compte fictif absent.');
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers });
  const page = await context.newPage();
  await page.addInitScript(() => window.addEventListener('acadea:offline-context-ready', () => {
    window.acadeaOfflineContextReady = true;
  }));
  page.setDefaultTimeout(30000);
  try {
    await page.goto(origin + '/login');
    await page.getByPlaceholder('email@ecole.com').fill(account.email);
    await page.getByPlaceholder('Votre mot de passe').fill(password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true }).last()).toBeVisible({ timeout: 60000 });
    await run(page, context);
  } finally { await context.close(); }
}
async function pdfFromPreview(page, label) {
  const anchor = page.locator('[data-pdf-download]');
  await expect(anchor).toHaveAttribute('href', /^blob:/, { timeout: 90000 });
  const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(
    document.querySelector('[data-pdf-download]').href)).arrayBuffer()))));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  writeFileSync(`${output}/${label}.pdf`, bytes);
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  assert.ok(pdf.numPages > 0 && pdf.numPages < 30);
  const extracted = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const pagePdf = await pdf.getPage(index);
    const viewport = pagePdf.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await pagePdf.render({ canvasContext: context, canvas, viewport }).promise;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let offset = 0; offset < pixels.length; offset += 16) if (pixels[offset] < 230 || pixels[offset + 1] < 230 || pixels[offset + 2] < 230) ink++;
    assert.ok(ink > 300, `Page blanche : ${label}, page ${index}.`);
    writeFileSync(`${output}/${label}-page-${index}.png`, canvas.toBuffer('image/png'));
    extracted.push((await pagePdf.getTextContent()).items.map(item => item.str ?? '').join(' '));
  }
  await task.destroy();
  if (await page.locator('[data-pdf-close]').count()) await page.locator('[data-pdf-close]').click();
  return extracted.join('\n');
}
try {
  ({ m, password } = await prepare(s));
  for (const account of m.users) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.STAGING_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password, returnSecureToken: true }), signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200, `Connexion Firebase refusée pour ${account.key}.`);
    tokens.set(account.key, (await response.json()).idToken);
  }
  browser = await chromium.launch({ headless: true });

  for (const key of ['admin', 'cashier', 'coordination', 'sub_coordination']) {
    await checked(`Dashboard ${key} : typographie, dates, devises et PDF`, async () => withRole(key, async page => {
      const officialCard = page.getByText('Montant officiel', { exact: true }).first().locator('..');
      const arrearsCard = page.getByText('Arriérés', { exact: true }).first().locator('..');
      await expect(arrearsCard.locator('span[title]')).toBeVisible({ timeout: 60000 });
      const title = key.includes('coordination') ? 'Arriérés encaissés, hors recouvrement de l\'année courante'
        : 'Arriérés encaissés pendant la période, hors recouvrement des frais de l\'année';
      const collected = page.getByText(title, { exact: true }).locator('..');
      await expect(collected).toContainText('$20,00', { timeout: 60000 });
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 950 });
        const amounts = arrearsCard.locator('span[title] > span');
        const expectedCount = key.includes('coordination') ? 2 : 1;
        await expect(amounts).toHaveCount(expectedCount, { timeout: 60000 });
        await expect(amounts.first()).toContainText('$80,00');
        if (expectedCount === 2) await expect(amounts.last()).toContainText('10 000,00 FC');
        const live = await Promise.all([officialCard.locator('p').last().evaluate(node => {
          const s = getComputedStyle(node); return [s.fontSize, s.fontWeight, s.color, s.lineHeight];
        }), arrearsCard.locator('span[title] > span').evaluateAll(nodes => nodes.map(node => {
          const s = getComputedStyle(node); return [s.fontSize, s.fontWeight, s.color, s.lineHeight];
        }))]);
        assert.equal(live[1].length, expectedCount);
        for (const amount of live[1]) assert.deepEqual(amount, live[0]);
        assert.equal(await arrearsCard.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
        await arrearsCard.screenshot({ path: `${output}/${key}-arrears-${width}.png` });
      }
      await page.getByLabel('Date de début', { exact: true }).fill(yesterday(m.today));
      await page.getByLabel('Date de fin', { exact: true }).fill(yesterday(m.today));
      await expect(collected).toContainText('$0,00', { timeout: 60000 });
      await expect(collected).not.toContainText('$20,00');
      await page.getByRole('button', { name: 'Exporter PDF', exact: true }).first().click();
      await pdfFromPreview(page, `${key}-dashboard`);
      await page.getByLabel('Date de fin', { exact: true }).fill(m.today);
      await expect(collected).toContainText('$20,00', { timeout: 60000 });
    }));
  }

  await checked('Décision sociale : classe réelle et bénéficiaire verrouillé', async () => {
    const response = await fetch(origin + '/api/manage-financial-transaction', {
      method: 'POST', headers: { Authorization: `Bearer ${tokens.get('admin')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-social-support', studentId: m.students.a, schoolYearId: m.years.a,
        reason: 'social', nature: 'fixed', observation: 'Décision fictive PR49', lines: [{ feeTypeId: m.fees.a, value: 100 }],
        clientRequestId: m.tag + '-social-pr49' }), signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200);
    await withRole('admin', async page => {
      await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
      await page.getByRole('button', { name: /Cas sociaux et prises en charge/ }).click();
      await page.getByRole('tab', { name: 'Bénéficiaires', exact: true }).click();
      await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
      const editor = page.getByRole('dialog', { name: 'Modifier la décision sociale' });
      const beneficiary = editor.getByTestId('social-support-beneficiary');
      await expect(beneficiary).toContainText('FICTIF-A');
      await expect(beneficiary).toContainText('1ère Primaire');
      await expect(editor.getByRole('combobox', { name: 'Rechercher un élève' })).toHaveCount(0);
      await beneficiary.screenshot({ path: `${output}/social-beneficiary.png` });
    });
  });

  await checked('Paiement provisoire hors connexion : reprise serveur et idempotence', async () => {
    await withRole('cashier', async (page, context) => {
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 60000 }).toBe(true);
      await expect.poll(() => page.evaluate(() => Boolean(window.acadeaOfflineContextReady)), { timeout: 60000 }).toBe(true);
      await expect.poll(() => page.evaluate(async () => {
        const cache = await caches.open('acadea-pwa-v6-assets');
        return Boolean(await cache.match(document.querySelector('script[type="module"]')?.src ?? ''));
      }), { timeout: 60000 }).toBe(true);
      const before = (await s.db.collection('payments').where('schoolId', '==', school()).get()).size;
      let requestBody;
      page.on('request', request => {
        if (!request.url().includes('/api/manage-financial-transaction')) return;
        const body = request.postDataJSON();
        if (body?.action === 'create-payment' && body.clientRequestId) requestBody = body;
      });
      await context.setOffline(true);
      await page.getByRole('button', { name: 'Voir les opérations' }).click();
      await page.getByLabel('Élève', { exact: true }).selectOption(m.students.a);
      await page.getByLabel('Type de frais').selectOption(m.fees.a);
      await page.getByLabel('Montant provisoire').fill('11');
      await page.getByRole('button', { name: 'Enregistrer le brouillon local' }).click();
      await expect(page.getByText('Brouillon local enregistré.', { exact: false })).toBeVisible();
      assert.equal((await s.db.collection('payments').where('schoolId', '==', school()).get()).size, before);
      await context.setOffline(false);
      await expect(page.getByText('Confirmée par le serveur', { exact: true })).toBeVisible({ timeout: 90000 });
      await expect.poll(async () => (await s.db.collection('payments').where('schoolId', '==', school()).get()).size,
        { timeout: 60000 }).toBe(before + 1);
      assert.ok(requestBody?.clientRequestId, 'Identifiant stable d’opération hors connexion absent.');
      const repeat = await fetch(origin + '/api/manage-financial-transaction', {
        method: 'POST', headers: { Authorization: `Bearer ${tokens.get('cashier')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody), signal: AbortSignal.timeout(30000),
      });
      assert.equal(repeat.status, 200);
      assert.equal((await s.db.collection('payments').where('schoolId', '==', school()).get()).size, before + 1);
      await page.screenshot({ path: `${output}/offline-cashier-confirmed.png`, fullPage: true });
    }, { serviceWorkers: 'allow' });
  });
} catch (error) {
  results.push({ name: 'Initialisation ou fixture hébergée', result: 'FAIL', detail: String(error.message).slice(0, 400) });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  try { await retire(s); results.push({ name: 'Clôture Auth et écoles fictives', result: 'PASS' }); }
  catch (error) { results.push({ name: 'Clôture Auth et écoles fictives', result: 'FAIL', detail: String(error.message).slice(0, 400) }); process.exitCode = 1; }
  if (m) try {
    const retained = [];
    for (const collection of ['payments', 'cashInflows', 'feeTypes', 'socialSupportDecisions', 'auditLogs',
      'financialIdempotency', 'socialSupportAudit', 'socialSupportRequests', 'socialSupportFeeLocks']) {
      for (const schoolId of m.schools) {
        const rows = await s.db.collection(collection).where('schoolId', '==', schoolId).get();
        retained.push(...rows.docs.map(row => `${collection}/${row.id}`));
      }
    }
    writeFileSync(`${output}/retained-fixtures.json`, JSON.stringify({ fixtureTag: m.tag, retained: [...new Set(retained)] }, null, 2));
    results.push({ name: 'Inventaire des documents fictifs neutralisés, sans suppression', result: 'PASS' });
  } catch (error) {
    results.push({ name: 'Inventaire des documents fictifs neutralisés, sans suppression', result: 'FAIL', detail: String(error.message).slice(0, 400) });
    process.exitCode = 1;
  }
  await s.close();
  writeFileSync(`${output}/results.json`, JSON.stringify({ sha: expectedSha, fixtureTag: m?.tag, results }, null, 2));
}
