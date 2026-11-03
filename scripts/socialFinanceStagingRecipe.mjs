import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { guard, services, prepare, retire } from './socialFinanceStagingFixture.mjs';

const origin = 'https://acadea-staging.vercel.app';
const output = 'diagnostics/social-finance-staging';
const results = [];
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); results.push({ name, result: 'PASS' }); };
guard();
assert.match(process.env.ACADEA_EXPECTED_SHA || '', /^[a-f0-9]{40}$/);
assert.ok(process.env.STAGING_FIREBASE_API_KEY);
const version = await (await fetch(origin + '/version.json')).json();
check('SHA hébergé', version.version, process.env.ACADEA_EXPECTED_SHA);
const home = await (await fetch(origin)).text();
const asset = home.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(asset, 'Bundle absent');
const bundle = await (await fetch(origin + asset)).text();
assert.ok(bundle.includes('acadea-staging') && !bundle.includes('acadea-production.firebaseapp.com'), 'Configuration Firebase incorrecte');
const s = services();
let browser;
mkdirSync(output, { recursive: true });
try {
  const { m, password } = await prepare(s);
  const tokens = {};
  for (const u of m.users) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.STAGING_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password, returnSecureToken: true }),
    });
    check(`Auth ${u.role}`, response.status, 200);
    tokens[u.role] = (await response.json()).idToken;
  }
  const api = async (role, body) => {
    const response = await fetch(origin + '/api/manage-financial-transaction', { method: 'POST', headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const decisionInput = { action: 'save-social-support', studentId: m.student, schoolYearId: m.year, reason: 'social', nature: 'fixed', observation: 'Justification fictive', lines: [{ feeTypeId: m.fee, value: 100 }], clientRequestId: m.tag + '-support' };
  check('Enseignant refusé', (await api('teacher', decisionInput)).status, 403);
  const first = await api('school_admin', decisionInput);
  check('Réduction enregistrée', first.status, 200);
  check('Réduction de 100 USD', first.data.decision.lines[m.fee].reductionMinor, 10000);
  check('Réessai idempotent', (await api('school_admin', decisionInput)).data.decision.id, first.data.decision.id);
  check('Réduction sans encaissement', (await s.db.collection('payments').where('schoolId', '==', m.schools[0]).get()).size, 0);
  const otherStudent = m.tag + '-unpaid';
  const full = await api('secretary', { ...decisionInput, studentId: otherStudent, nature: 'full', clientRequestId: m.tag + '-full' });
  check('Exonération Secrétaire', full.status, 200);
  check('Exonération totale', full.data.decision.lines[m.fee].reductionMinor, 30000);
  const payment = { action: 'create-payment', schoolYearId: m.year, studentId: m.student, feeTypeId: m.fee, amount: 50, note: 'Versement fictif recette', clientRequestId: m.tag + '-payment' };
  const paid = await api('cashier', payment);
  check('Encaissement réel fictif', paid.status, 200);
  check('Paiement sans doublon', (await api('cashier', payment)).status, 200);
  check('Un seul paiement', (await s.db.collection('payments').where('schoolId', '==', m.schools[0]).get()).size, 1);
  check('Trop-perçu refusé', (await api('cashier', { ...payment, amount: 201, clientRequestId: m.tag + '-excess' })).status, 409);
  check('Autre établissement refusé', (await api('school_admin', { ...decisionInput, schoolYearId: m.tag + '-other-year', studentId: otherStudent, clientRequestId: m.tag + '-foreign' })).status, 400);
  check('Verrou social API', (await api('school_admin', { action: 'save-fee-types', schoolYearId: m.year, requestId: m.tag + '-edit-fee', editingFeeId: m.fee, fees: [{ id: m.fee, name: 'Minerval', amount: 200, className: '1ère Primaire' }] })).status, 409);
  for (const role of ['school_admin', 'cashier', 'secretary']) {
    check(`Lecture sociale ${role}`, (await api(role, { action: 'list-social-support' })).status, 200);
  }
  const direct = await fetch(`https://firestore.googleapis.com/v1/projects/acadea-staging/databases/(default)/documents/students/${m.student}?updateMask.fieldPaths=financialSupport`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokens.school_admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { financialSupport: { mapValue: { fields: {} } } } }),
  });
  check('Projection directe refusée par règles', direct.status, 403);
  browser = await chromium.launch({ headless: true });
  for (const role of ['school_admin', 'cashier', 'secretary']) {
    const u = m.users.find(u => u.role === role);
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(origin + '/login');
    await page.getByPlaceholder('email@ecole.com').fill(u.email);
    await page.getByPlaceholder('Votre mot de passe').fill(password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 60000 });
    await page.screenshot({ path: `${output}/${role}-dashboard.png`, fullPage: true });
    await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
    await page.getByRole('button', { name: /Cas sociaux et prises en charge/ }).click();
    await page.getByRole('tab', { name: 'Bénéficiaires', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Détails', exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Exporter PDF', exact: true }).click();
    const download = page.locator('[data-pdf-download][aria-disabled="false"]');
    await download.waitFor({ timeout: 60000 });
    const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('[data-pdf-download]').href)).arrayBuffer())));
    assert.ok(Buffer.from(bytes).subarray(0, 5).toString() === '%PDF-');
    writeFileSync(`${output}/${role}-beneficiaries.pdf`, Buffer.from(bytes));
    results.push({ name: `Interface et PDF authentifiés ${role}`, result: 'PASS' });
    await context.close();
  }
} catch (e) {
  results.push({ name: 'Recette interrompue', result: 'FAIL', error: String(e.message).slice(0, 800) });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  try { await retire(s); results.push({ name: 'Clôture sans suppression', result: 'PASS' }); }
  catch(e) { results.push({ name: 'Clôture', result: 'FAIL', error: String(e.message).slice(0, 500) }); process.exitCode = 1; }
  await s.close();
  writeFileSync(`${output}/results.json`, JSON.stringify({ sha: process.env.ACADEA_EXPECTED_SHA, results }, null, 2));
  for (const r of results) console.log(`${r.result}: ${r.name}${r.error ? ' — ' + r.error : ''}`);
}
