import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { guard, services, prepare, retire, projectId, verifyEnrollmentLifecycle, inventoryPr46Pr47Residues } from './socialFinanceStagingFixture.mjs';
import { runPr46ParentEnrollment } from './pr46StagingFlow.mjs';
import { runStudentFilters } from './studentFiltersStagingFlow.mjs';
import { runPr47StagingFlow } from './pr47StagingFlow.mjs';

const origin = 'https://acadea-staging.vercel.app';
const output = 'diagnostics/pr46-pr47-staging';
const results = [];
let activePage;
const record = async (name, operation) => {
  try { const detail = await operation(); results.push({ name, result: 'PASS', ...(detail ?? {}) }); }
  catch (error) {
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true }).catch(() => {});
    results.push({ name, result: 'FAIL', error: String(error?.message ?? error).slice(0, 800) });
    process.exitCode = 1;
  }
};

guard();
assert.equal(projectId, 'acadea-staging');
assert.match(process.env.ACADEA_EXPECTED_SHA ?? '', /^[a-f0-9]{40}$/);
assert.ok(process.env.STAGING_FIREBASE_API_KEY);
const versionResponse = await fetch(`${origin}/version.json`, { signal: AbortSignal.timeout(15000) });
assert.equal(versionResponse.status, 200, 'SHA Staging indisponible : aucune fixture créée.');
assert.equal((await versionResponse.json()).version, process.env.ACADEA_EXPECTED_SHA, 'SHA Staging incorrect : aucune fixture créée.');
const htmlResponse = await fetch(origin, { signal: AbortSignal.timeout(15000) });
assert.equal(htmlResponse.status, 200, 'Frontend Staging indisponible : aucune fixture créée.');
const asset = (await htmlResponse.text()).match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(asset, 'Bundle Staging introuvable : aucune fixture créée.');
const bundleResponse = await fetch(origin + asset, { signal: AbortSignal.timeout(15000) });
assert.equal(bundleResponse.status, 200);
const bundle = await bundleResponse.text();
assert.ok(/projectId:["']acadea-staging["']/.test(bundle)
  && /authDomain:["']acadea-staging\.firebaseapp\.com["']/.test(bundle)
  && bundle.includes(process.env.STAGING_FIREBASE_API_KEY)
  && !bundle.includes('acadea-production.firebaseapp.com'), 'Configuration Firebase Staging non concordante : aucune fixture créée.');

mkdirSync(output, { recursive: true });
results.push({ name: 'SHA et Firebase Staging vérifiés avant fixture', result: 'PASS' });
const servicesHandle = services();
let browser, fixture, password;

async function signIn(page, account) {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('email@ecole.com').fill(account.email);
  await page.getByPlaceholder('Votre mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Menu', exact: true }).last()).toBeVisible({ timeout: 60000 });
}

async function verifyRetirement(s, m) {
  for (const schoolId of m.schools) {
    const school = await s.db.doc(`schools/${schoolId}`).get();
    assert.equal(school.data()?.fixtureId, m.tag);
    assert.equal(school.data()?.active, false);
    assert.equal(school.data()?.status, 'inactive');
  }
  for (const user of m.users) {
    const authUser = await s.auth.getUser(user.uid);
    assert.equal(authUser.email, user.email);
    assert.equal(authUser.disabled, true);
    assert.deepEqual(authUser.customClaims ?? {}, {});
    const profile = await s.db.doc(`users/${user.uid}`).get();
    assert.equal(profile.data()?.fixtureId, m.tag);
    assert.equal(profile.data()?.active, false);
  }
  const retained = [];
  for (const row of m.documents) {
    const current = await s.db.doc(row.path).get();
    assert.ok(current.exists, `Document manifesté absent : ${row.path}`);
    assert.equal(current.data()?.fixtureId, m.tag);
    assert.equal(current.data()?.id, current.id);
    if (/^(students|parents|classes|feeTypes|schoolYears|correspondences|payments)\//.test(row.path)) {
      assert.equal(current.data()?.active, false);
      assert.equal(current.data()?.fixtureLifecycle, 'retired');
      assert.equal(current.data()?.status, row.path.startsWith('students/') ? 'ARCHIVED' : 'inactive');
    }
    retained.push(row.path);
  }
  for (const collection of ['students', 'parents', 'payments']) {
    for (const schoolId of m.schools) {
      const found = await s.db.collection(collection).where('schoolId', '==', schoolId).get();
      const expected = new Set(m.documents.filter(row => row.path.startsWith(`${collection}/`) && row.data.schoolId === schoolId).map(row => row.path));
      if (collection === 'students') for (const entry of m.uiEnrollments ?? []) if (entry.schoolId === schoolId && entry.path) expected.add(entry.path);
      assert.deepEqual(new Set(found.docs.map(doc => doc.ref.path)), expected, `Documents imprévus : ${collection}/${schoolId}`);
    }
  }
  return { accountsDisabled: m.users.length, schoolsInactive: m.schools.length, retainedDocuments: retained.length, retainedNotDeleted: true, storageWritesPerformed: false };
}

try {
  ({ m: fixture, password } = await prepare(servicesHandle, 'pr46pr47'));
  browser = await chromium.launch({ headless: true });
  // All four Dashboard baselines precede the two deliberately created UI pupils.
  for (const role of ['cashier', 'coordination_admin', 'sub_coordination_admin', 'school_admin', 'secretary', 'study_director']) {
    const account = fixture.users.find(user => user.role === role);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    activePage = page;
    try {
      await record(`Authentification ${role}`, () => signIn(page, account));
      if (['school_admin', 'cashier', 'coordination_admin', 'sub_coordination_admin'].includes(role)) {
        const coordinated = role === 'coordination_admin' || role === 'sub_coordination_admin';
        const expectedSummary = { counts: { "Nombre total d'élèves": coordinated ? 5 : 4 },
          financial: { USD: { official: 600, reduction: 0, expected: 600, paid: 120, remaining: 480 },
            ...(coordinated ? { CDF: { official: 1500000, reduction: 0, expected: 1500000, paid: 500000, remaining: 1000000 } } : {}) },
          ...(coordinated ? { filters: { school: { value: fixture.schools[1], currencies: ['CDF'],
            counts: { "Nombre total d'élèves": 1 },
            financial: { CDF: { official: 1500000, reduction: 0, expected: 1500000, paid: 500000, remaining: 1000000 } } } } } : {}) };
        await record(`Dashboard visuel, PDF et rafraîchissement ${role}`, () => runPr47StagingFlow({
          page, context, role, outputDir: output,
          expectedCurrencies: coordinated ? ['USD', 'CDF'] : ['USD'], expectedSummary,
        }));
      }
      if (['school_admin', 'secretary', 'study_director'].includes(role))
        await record(`Filtres Élèves ${role}`, () => runStudentFilters({ page, role, fixture, evidenceDir: output }));
      if (['school_admin', 'secretary'].includes(role))
        await record(`Sélection, inscription et liaison Parent ${role}`, () => runPr46ParentEnrollment({ page, role, fixture, services: servicesHandle, evidenceDir: output }));
      if (role === 'school_admin') await record('Refus interétablissement Firestore', async () => {
        const signInResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.STAGING_FIREBASE_API_KEY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password, returnSecureToken: true }),
        });
        assert.equal(signInResponse.status, 200);
        const { idToken } = await signInResponse.json();
        const target = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/students/${fixture.tag}-student-foreign`;
        const response = await fetch(target, { headers: { Authorization: `Bearer ${idToken}` } });
        assert.equal(response.status, 403);
      });
    } finally { activePage = undefined; await context.close(); }
  }
} catch (error) {
  results.push({ name: 'Recette interrompue', result: 'FAIL', error: String(error?.message ?? error).slice(0, 800) });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await record('Clôture des comptes et écoles fictifs', () => retire(servicesHandle));
  if (fixture) await record('Inventaire vérifié des résidus fictifs conservés', () => verifyRetirement(servicesHandle, fixture));
  if (fixture) await record('Inscriptions UI fictives archivées', () => verifyEnrollmentLifecycle(servicesHandle, fixture));
  if (fixture) await record('Inventaire des résidus fictifs conservés', async () => {
    const inventory = await inventoryPr46Pr47Residues(servicesHandle, fixture);
    writeFileSync(`${output}/retained-fixture-inventory.json`, JSON.stringify(inventory, null, 2));
    return { counts: Object.fromEntries(Object.entries(inventory).map(([collection, rows]) => [collection, rows.length])) };
  });
  await servicesHandle.close();
  writeFileSync(`${output}/results.json`, JSON.stringify({ sha: process.env.ACADEA_EXPECTED_SHA, results }, null, 2));
  for (const result of results) console.log(JSON.stringify(result));
}
