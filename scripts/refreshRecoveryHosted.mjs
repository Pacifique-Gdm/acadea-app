import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect as baseExpect } from '@playwright/test';
import { services } from './socialFinanceStagingFixture.mjs';
import { redactRecipeError } from './hostedRecipeSafety.mjs';

// Hosted browser, real Firebase sign-in and real server responses. Faults only
// delay an outbound read or disconnect this isolated browser; no mocked data.
const expect = baseExpect.configure({ timeout: 60000 });
const origin = 'https://acadea-staging.vercel.app';
const sha = process.env.ACADEA_EXPECTED_SHA;
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'acadea-staging');
assert.equal(process.env.GOOGLE_CLOUD_QUOTA_PROJECT, 'acadea-staging');
assert.match(sha ?? '', /^[a-f0-9]{40}$/);
assert.ok(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
assert.equal((await (await fetch(origin + '/version.json')).json()).version, sha);
const root = 'diagnostics/refresh-recovery-hosted';
const manifestPath = root + '/manifest.json';
mkdirSync(root, { recursive: true });
if (existsSync(manifestPath)) assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).retired, true, 'Clôture précédente obligatoire');
const tag = 'e2e-refresh-' + randomUUID().replaceAll('-', '');
const school = tag + '-school', year = tag + '-year', uid = tag + '-admin', classId = tag + '-class';
const email = uid + '@example.invalid', password = 'Ephemeral-' + randomUUID() + randomUUID();
const output = `${root}/${sha}-${Date.now()}`;
mkdirSync(output, { recursive: true });
const manifest = { projectId: 'acadea-staging', tag, sha, school, year, uid, email, paths: [], retired: false };
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
save();
const s = services(), results = [], errors = [];
const pass = name => { results.push({ name, result: 'PASS' }); console.log('PASS: ' + name); };
let browser, page, context;
async function put(collection, id, data) {
  assert.ok(id.startsWith(tag));
  const ref = s.db.doc(`${collection}/${id}`);
  assert.equal((await ref.get()).exists, false);
  manifest.paths.push(ref.path); save();
  await ref.create({ ...data, id, fixtureId: tag });
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.ACADEA_HOSTED_BROWSER_CHANNEL === 'chrome' ? { channel: 'chrome' } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  await page.addInitScript(() => window.addEventListener('acadea:offline-context-ready', () => { window.acadeaRefreshOfflineReady = true; }));
  page.on('console', message => {
    if (message.text().startsWith('[Acadéa refresh]')) errors.push({ time: new Date().toISOString(), text: message.text() });
  });
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByPlaceholder('email@ecole.com')).toBeVisible();
  await put('schools', school, { name: 'Recette fictive récupération actualisation', status: 'active', active: true, currency: 'USD',
    activeSchoolYearId: year, schoolType: 'Primaire uniquement', educationLevels: ['Primaire'], schoolOptions: [], subscriptionStatus: 'active', subscriptionPlan: 'premium' });
  await put('schoolYears', year, { schoolId: school, name: '2026-2027', status: 'active', currency: 'USD', startsAt: '2026-09-01', endsAt: '2027-07-31' });
  await put('classes', classId, { schoolId: school, schoolYearId: year, name: '1ère Primaire', section: 'Primaire', active: true });
  await put('feeTypes', tag + '-fee', { schoolId: school, schoolYearId: year, name: 'Frais fictif actualisation', amount: 100, currency: 'USD', className: '1ère Primaire' });
  await put('students', tag + '-student', { schoolId: school, schoolYearId: year, nom: 'ACTUALISATION', postnom: 'FICTIF', prenom: 'INITIAL', matricule: 'E2E', className: '1ère Primaire', classId, section: 'Primaire', status: 'ACTIVE', birthDate: '2017-01-01' });
  await put('users', uid, { role: 'school_admin', schoolId: school, activeSchoolYearId: year, name: 'Administrateur fictif actualisation', email, active: true, status: 'active' });
  await s.auth.createUser({ uid, email, password });
  await s.auth.setCustomUserClaims(uid, { role: 'school_admin', schoolId: school });
  await page.getByPlaceholder('email@ecole.com').fill(email);
  await page.getByPlaceholder('Votre mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  const tab = name => page.getByRole('button', { name, exact: true }).last();
  const refresh = () => page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  const pdf = page.getByRole('button', { name: 'Exporter PDF', exact: true });
  await expect(pdf).toBeEnabled();
  await refresh(); await expect(pdf).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Actualiser', exact: true })).toBeEnabled();
  pass('Authentification hébergée, chargement initial et actualisation normale ; PDF financier autorisé');

  let delayed = 0;
  const delaySecondary = async route => {
    const data = route.request().postData() ?? '';
    const decoded = [...new URLSearchParams(data).values()].join(' ');
    if (!delayed && /"collectionId"\s*:\s*"messages"/.test(decoded)) {
      delayed++;
      await new Promise(resolve => setTimeout(resolve, 22000));
    }
    await route.continue().catch(() => {});
  };
  await page.route('**/google.firestore.v1.Firestore/Listen/channel**', delaySecondary);
  await refresh();
  await expect.poll(() => delayed).toBe(1);
  await expect.poll(() => errors.some(error => error.text.includes('client-timeout') && error.text.includes('messages'))).toBe(true);
  await expect(pdf).toBeEnabled();
  await tab('Message').click();
  await expect(page.getByText(/^Messages non actualisés\./)).toBeVisible();
  await tab('Dashboard').click();
  await expect(page.getByText(/^Messages non actualisés\./)).toHaveCount(0);
  await expect(pdf).toBeEnabled();
  await tab('Message').click();
  await expect(page.getByText(/^Messages non actualisés\./)).toHaveCount(0, { timeout: 60000 });
  await page.unroute('**/google.firestore.v1.Firestore/Listen/channel**', delaySecondary);
  pass('Lecture secondaire retardée au-delà de 15 s : finances confirmées, avertissement localisé et récupération automatique sans rechargement');

  await tab('Dashboard').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.acadeaRefreshOfflineReady)), { timeout: 90000 }).toBe(true);
  const before = (await s.db.collection('students').where('schoolId', '==', school).get()).size;
  await context.setOffline(true);
  await refresh();
  await expect(pdf).toBeDisabled();
  await expect(page.getByText(/Données scolaires et financières non confirmées/).first()).toBeVisible();
  await page.screenshot({ path: `${output}/financial-unconfirmed.png`, fullPage: true });
  await tab('Menu').click();
  await expect(page.getByText(/Données scolaires et financières non confirmées/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Voir les opérations', exact: true }).click();
  const queue = page.getByRole('region', { name: 'État des opérations hors connexion', exact: true });
  await queue.getByLabel('Classe préchargée', { exact: true }).selectOption(classId);
  await queue.getByLabel('Nom', { exact: true }).fill('REPRISE HORS LIGNE');
  await queue.getByLabel('Post-nom', { exact: true }).fill('FICTIF');
  await queue.getByLabel('Prénom', { exact: true }).fill('UNIQUE');
  await queue.getByLabel('Date de naissance', { exact: true }).fill('2017-05-06');
  await queue.getByRole('button', { name: 'Enregistrer le brouillon local', exact: true }).click();
  await expect(queue.getByText('Brouillon local enregistré.', { exact: false })).toBeVisible();
  pass('Coupure réseau : cache non validé, PDF bloqué, avertissement borné aux données touchées, saisie locale conservée');
  await context.setOffline(false);
  await expect(queue.getByText('Confirmée par le serveur', { exact: true })).toBeVisible({ timeout: 120000 });
  const students = (await s.db.collection('students').where('schoolId', '==', school).get()).docs;
  assert.equal(students.length, before + 1);
  const created = students.filter(doc => doc.data().nom === 'REPRISE HORS LIGNE');
  assert.equal(created.length, 1); manifest.paths.push(created[0].ref.path); save();
  await queue.getByRole('button', { name: 'Fermer', exact: true }).click();
  await tab('Dashboard').click(); await expect(pdf).toBeEnabled();
  await expect(page.getByText(/Données scolaires et financières non confirmées/)).toHaveCount(0);
  await refresh(); await expect(pdf).toBeEnabled();
  assert.equal((await s.db.collection('students').where('schoolId', '==', school).get()).size, before + 1);
  const popupPromise = context.waitForEvent('page'); await pdf.click();
  const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
  await expect.poll(() => popup.url()).not.toBe('about:blank');
  await page.screenshot({ path: `${output}/recovered.png`, fullPage: true });
  pass('Retour en ligne : confirmation serveur automatique, exactement une inscription synchronisée et export PDF réautorisé');
  assert.equal((await (await fetch(origin + '/version.json')).json()).version, sha);
} catch (error) {
  results.push({ name: 'Recette hébergée', result: 'FAIL', detail: redactRecipeError(error, [password]) }); process.exitCode = 1;
  if (page) {
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
    writeFileSync(`${output}/visible-state.txt`, await page.locator('body').innerText().catch(() => 'indisponible'));
  }
  console.error('FAIL: preuve expurgée conservée dans diagnostics/refresh-recovery-hosted.');
} finally {
  await browser?.close().catch(() => {});
  try {
    let account;
    try { account = await s.auth.getUser(uid); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    if (account) {
      assert.equal(account.email, email);
      await s.auth.updateUser(uid, { disabled: true }); await s.auth.setCustomUserClaims(uid, {}); await s.auth.revokeRefreshTokens(uid);
      const check = await s.auth.getUser(uid); assert.equal(check.disabled, true); assert.deepEqual(check.customClaims, {});
    }
    for (const path of [`schools/${school}`, `users/${uid}`]) {
      const ref = s.db.doc(path), snap = await ref.get(); if (!snap.exists) continue;
      assert.equal(snap.data().fixtureId, tag);
      await ref.update({ active: false, status: 'inactive', fixtureLifecycle: 'retired' }, { lastUpdateTime: snap.updateTime });
      assert.equal((await ref.get()).data().active, false);
    }
    manifest.retained = {};
    for (const collection of ['students', 'payments', 'auditLogs', 'offlineOperations', 'financialIdempotency']) {
      manifest.retained[collection] = (await s.db.collection(collection).where('schoolId', '==', school).get()).docs.map(doc => doc.id);
    }
    manifest.retired = true; manifest.closedAt = new Date().toISOString(); save();
    pass('Clôture vérifiée : compte désactivé, sessions révoquées, école neutralisée et documents fictifs inventoriés');
  } catch { results.push({ name: 'Clôture', result: 'FAIL' }); process.exitCode = 1; }
  writeFileSync(`${output}/results.json`, JSON.stringify({ sha, results, errors }, null, 2));
  await s.close();
}
