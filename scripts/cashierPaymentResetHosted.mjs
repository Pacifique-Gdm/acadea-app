import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect as baseExpect } from '@playwright/test';
import { services } from './socialFinanceStagingFixture.mjs';
import { fixtureLeftovers, purgeStagingFixture } from './stagingFixturePurge.mjs';
import { guardedRoute, redactRecipeError } from './hostedRecipeSafety.mjs';

// Uses the normal hosted sign-in, UI and financial API. No response is mocked.
const expect = baseExpect.configure({ timeout: 60000 });
const origin = 'https://acadea-staging.vercel.app', sha = process.env.ACADEA_EXPECTED_SHA;
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'acadea-staging');
assert.equal(process.env.GOOGLE_CLOUD_QUOTA_PROJECT, 'acadea-staging');
assert.match(sha ?? '', /^[a-f0-9]{40}$/);
assert.ok(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
const version = await fetch(origin + '/version.json');
assert.equal(version.status, 200); assert.equal((await version.json()).version, sha);
const root = 'diagnostics/cashier-reset-hosted', path = root + '/manifest.json';
mkdirSync(root, { recursive: true });
if (existsSync(path)) assert.equal(JSON.parse(readFileSync(path, 'utf8')).retired, true, 'Clôture précédente requise');
const tag = 'e2e-reset-' + randomUUID().replaceAll('-', '');
const school = tag + '-school', year = tag + '-year', fee = tag + '-fee', uid = tag + '-cashier';
const email = uid + '@example.invalid', password = 'Fictif-' + randomUUID() + randomUUID();
const output = `${root}/${sha}-${Date.now()}`; mkdirSync(output, { recursive: true });
const manifest = { projectId: 'acadea-staging', tag, sha, school, year, uid, email, paths: [], retired: false };
const save = () => writeFileSync(path, JSON.stringify(manifest, null, 2), { mode: 0o600 });
save();
const s = services(), results = [], transportErrors = [];
const record = name => { results.push({ name, result: 'PASS' }); console.log('PASS: ' + name); };
let browser, page;
async function put(collection, id, data) {
  assert.ok(id.startsWith(tag));
  const ref = s.db.doc(`${collection}/${id}`);
  assert.equal((await ref.get()).exists, false);
  manifest.paths.push(ref.path); save();
  await ref.create({ ...data, id, fixtureId: tag });
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.ACADEA_HOSTED_BROWSER_CHANNEL === 'chrome' ? { channel: 'chrome' } : {}) });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByPlaceholder('email@ecole.com')).toBeVisible();
  await put('schools', school, { name: 'Caissier fictif réinitialisation', status: 'active', active: true, currency: 'USD',
    activeSchoolYearId: year, schoolType: 'Primaire uniquement', educationLevels: ['Primaire'], schoolOptions: [], subscriptionStatus: 'active', subscriptionPlan: 'premium' });
  await put('schoolYears', year, { schoolId: school, name: '2026-2027', status: 'active', currency: 'USD', startsAt: '2026-09-01', endsAt: '2027-07-31' });
  await put('classes', tag + '-class', { schoolId: school, schoolYearId: year, name: '1ère Primaire', section: 'Primaire', active: true });
  await put('feeTypes', fee, { schoolId: school, schoolYearId: year, name: 'Frais fictif reset', amount: 100, currency: 'USD', className: '1ère Primaire' });
  for (const name of ['ALPHA', 'BETA']) await put('students', tag + '-' + name, { schoolId: school, schoolYearId: year, nom: name, postnom: 'FICTIF', prenom: 'RESET', matricule: name, className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE' });
  await put('users', uid, { role: 'cashier', schoolId: school, activeSchoolYearId: year, name: 'Caissier fictif reset', email, active: true, status: 'active' });
  await s.auth.createUser({ uid, email, password });
  await s.auth.setCustomUserClaims(uid, { role: 'cashier', schoolId: school });
  await page.getByPlaceholder('email@ecole.com').fill(email);
  await page.getByPlaceholder('Votre mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('button', { name: 'Contrôle', exact: true }).last().click();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Enregistrer', exact: true });
  const search = form.getByPlaceholder('Rechercher par nom, postnom, prénom ou matricule');
  const amount = form.getByPlaceholder('Montant', { exact: true });
  const note = form.getByRole('textbox', { name: 'Description', exact: true });
  const submit = form.getByRole('button', { name: 'Enregistrer', exact: true });
  const payments = async () => (await s.db.collection('payments').where('schoolId', '==', school).get()).docs.map(d => d.data());
  await search.fill('ALPHA'); await form.getByRole('button', { name: /ALPHA FICTIF RESET/ }).click();
  await form.getByLabel('Type de frais', { exact: true }).selectOption(fee);
  await amount.fill('10'); await note.fill('PREMIER'); await submit.click();
  await expect.poll(async () => (await payments()).length).toBe(1);
  await expect(search).toHaveValue(''); await expect(amount).toHaveValue(''); await expect(note).toHaveValue('');
  await expect(form.getByRole('group', { name: 'Élève sélectionné' })).toHaveCount(0);
  record('Premier paiement confirmé par Firestore : élève, recherche, montant et description réinitialisés');
  await search.fill('BETA'); await form.getByRole('button', { name: /BETA FICTIF RESET/ }).click();
  await expect(form.getByText(/ALPHA/)).toHaveCount(0); await expect(amount).toHaveValue(''); await expect(note).toHaveValue('');
  await form.getByLabel('Type de frais', { exact: true }).selectOption(fee);
  await amount.fill('12'); await note.fill('SECOND');
  let lost = false, serverPaymentId;
  await page.route('**/api/manage-financial-transaction', guardedRoute(async route => {
    if (!lost && route.request().postDataJSON()?.action === 'create-payment') {
      lost = true;
      const response = await route.fetch(); assert.equal(response.status(), 200);
      serverPaymentId = (await response.json()).payment?.id; assert.ok(serverPaymentId);
      return route.abort('connectionreset');
    }
    return route.continue();
  }, transportErrors));
  await submit.click(); await expect.poll(() => Boolean(serverPaymentId)).toBe(true);
  await expect(submit).toBeEnabled(); await expect(amount).toHaveValue('12'); await expect(note).toHaveValue('SECOND');
  await expect(form.getByRole('group', { name: 'Élève sélectionné' }).filter({ hasText: /^BETA/ })).toBeVisible();
  await expect.poll(async () => (await payments()).length).toBe(2);
  record('Réponse serveur perdue après écriture : formulaire conservé et aucun faux succès');
  await submit.click(); await expect(search).toHaveValue(''); await expect(amount).toHaveValue(''); await expect(note).toHaveValue('');
  const rows = await payments(); assert.equal(rows.length, 2);
  assert.equal(rows.find(p => p.studentId === tag + '-BETA')?.id, serverPaymentId);
  assert.equal(rows.find(p => p.studentId === tag + '-BETA')?.amount, 12);
  assert.deepEqual(transportErrors, []);
  await page.screenshot({ path: `${output}/cashier-after-retry.png`, fullPage: true });
  record('Deuxième élève indépendant, réessai idempotent et formulaire neuf : exactement deux paiements');
} catch (error) {
  results.push({ name: 'Parcours Caissier', result: 'FAIL', detail: redactRecipeError(error, [password]) }); process.exitCode = 1;
  if (page) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  console.error('FAIL: parcours Caissier, preuve expurgée conservée.');
} finally {
  await browser?.close().catch(() => {});
  try {
    let account;
    try { account = await s.auth.getUser(uid); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    if (account) assert.equal(account.email, email);
    for (const docPath of [`schools/${school}`, `users/${uid}`]) {
      const snap = await s.db.doc(docPath).get();
      if (!snap.exists) continue;
      assert.equal(snap.data().fixtureId, tag);
    }
    // Clôture : effacement complet de l'école d'essai, de ses écritures et du compte fictif.
    await purgeStagingFixture({ db: s.db, auth: s.auth, bucket: s.bucket, projectId: 'acadea-staging', tag, extraUids: [uid] });
    assert.deepEqual(await fixtureLeftovers(s.db, tag, [school]), []);
    manifest.retained = {}; manifest.deleted = true;
    manifest.retired = true; manifest.closedAt = new Date().toISOString(); save();
    record('Clôture : école d\'essai, écritures et compte fictif effacés, aucun reste');
  } catch { results.push({ name: 'Clôture', result: 'FAIL' }); process.exitCode = 1; }
  writeFileSync(`${output}/results.json`, JSON.stringify({ sha, projectId: 'acadea-staging', results }, null, 2));
  await s.close();
}
