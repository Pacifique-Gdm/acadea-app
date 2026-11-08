import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { guard, services, prepare, retire, saveManifest, projectId } from './sevenAmendmentsStagingFixture.mjs';

const origin = 'https://acadea-staging.vercel.app';
const output = 'diagnostics/arrears-years-staging';
const expectedSha = process.env.ACADEA_EXPECTED_SHA;
const results = [];
const record = (name, result, detail = '') => {
  results.push({ name, result, ...(detail ? { detail } : {}) });
  console.log(`${result}: ${name}${detail ? ` — ${detail}` : ''}`);
};

guard();
assert.ok(process.env.STAGING_FIREBASE_API_KEY, 'Clé publique Firebase Staging absente.');
const version = await fetch(`${origin}/version.json`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
assert.equal(version.status, 200, 'Staging inaccessible ; aucune fixture créée.');
assert.equal((await version.json()).version, expectedSha, 'SHA Staging incorrect ; aucune fixture créée.');
const home = await (await fetch(origin, { signal: AbortSignal.timeout(15000) })).text();
const asset = home.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(asset, 'Bundle Staging absent ; aucune fixture créée.');
const bundle = await (await fetch(origin + asset, { signal: AbortSignal.timeout(15000) })).text();
assert.ok(bundle.includes(projectId) && !bundle.includes('acadea-production.firebaseapp.com'),
  'Configuration Firebase du bundle incompatible avec Staging ; aucune fixture créée.');
record('SHA frontend/API et configuration Firebase Staging', 'PASS');

mkdirSync(output, { recursive: true });
const service = services();
let manifest, password, browser;
try {
  ({ m: manifest, password } = await prepare(service));
  // Le lecteur paginé interroge sortName. Ces écritures ne concernent que les
  // documents fictifs dont la provenance est déjà enregistrée au manifeste.
  for (const row of manifest.documents.filter(item => item.path.startsWith('students/'))) {
    row.data.sortName = `${row.data.nom} ${row.data.postnom} ${row.data.prenom}`.toLocaleLowerCase('fr');
    row.data.searchArchived = row.data.status === 'ARCHIVED';
  }
  const cdfPayment = {
    path: `payments/${manifest.tag}-cdf-old-payment`,
    data: { id: `${manifest.tag}-cdf-old-payment`, fixtureId: manifest.tag,
      schoolId: manifest.schools[1], schoolYearId: `${manifest.tag}-b-old-year`,
      collectionSchoolYearId: manifest.years.b, studentId: `${manifest.tag}-b-old-student`,
      currentStudentId: manifest.students.b, feeTypeId: `${manifest.tag}-b-old-fee`, feeName: 'Minerval',
      debtSchoolYearName: manifest.documents.find(row => row.path === `schoolYears/${manifest.tag}-b-old-year`).data.name,
      amount: 1000, currency: 'CDF', paidAt: manifest.today, createdAt: `${manifest.today}T10:00:00Z`,
      cashierId: `${manifest.tag}-cashier`, cashierName: 'Caissier fictif', receiptNumber: `${manifest.tag}-cdf-receipt` },
  };
  assert.equal((await service.db.doc(cdfPayment.path).get()).exists, false, 'Collision de fixture CDF.');
  manifest.documents.push(cdfPayment);
  saveManifest(manifest);
  for (const row of manifest.documents.filter(item => item.path.startsWith('students/'))) {
    await service.db.doc(row.path).update({ sortName: row.data.sortName, searchArchived: row.data.searchArchived });
  }
  await service.db.doc(cdfPayment.path).create(cdfPayment.data);
  record('Fixtures isolées USD/CDF et trois écoles de même période', 'PASS');

  browser = await chromium.launch({ headless: true });
  const currentYearName = manifest.documents.find(row => row.path === `schoolYears/${manifest.years.a}`).data.name;
  const currentYearValue = `period:${currentYearName}`;
  const previousDay = new Date(Date.parse(`${manifest.today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  for (const key of ['admin', 'cashier', 'coordination', 'sub_coordination']) {
    const account = manifest.users.find(user => user.key === key);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);
    try {
      await page.goto(`${origin}/login`);
      await page.getByPlaceholder('email@ecole.com').fill(account.email);
      await page.getByPlaceholder('Votre mot de passe').fill(password);
      await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Dashboard', exact: true }).last()).toBeVisible({ timeout: 60000 });
      const band = page.getByTestId('collected-arrears-band');
      await page.getByLabel('Date de début', { exact: true }).fill(manifest.today);
      await page.getByLabel('Date de fin', { exact: true }).fill(manifest.today);
      await expect(band).toBeVisible({ timeout: 60000 });
      await expect(band).toContainText('20');
      if (key.includes('coordination')) await expect(band).toContainText('1 000');
      await page.screenshot({ path: `${output}/${key}-with-collections.png`, fullPage: true });
      await page.getByLabel('Date de début', { exact: true }).fill(previousDay);
      await page.getByLabel('Date de fin', { exact: true }).fill(previousDay);
      await expect(band).toHaveCount(0);
      await page.screenshot({ path: `${output}/${key}-without-collections.png`, fullPage: true });
      await page.getByLabel('Date de début', { exact: true }).fill(manifest.today);
      await page.getByLabel('Date de fin', { exact: true }).fill(manifest.today);
      await expect(band).toBeVisible();
      await page.screenshot({ path: `${output}/${key}-collections-restored.png`, fullPage: true });
      record(`Bande conditionnelle Dashboard ${key}`, 'PASS');

      if (key.includes('coordination')) {
        const schoolFilter = page.getByLabel('Filtrer par école').first();
        expect((await schoolFilter.locator('option').allTextContents()).join(' ')).not.toContain('École fictive PR48 D');
        for (const tab of ['Élèves', 'Contrôle']) {
          await page.getByRole('button', { name: tab, exact: true }).last().click();
          const year = page.getByLabel('Année scolaire', { exact: true });
          await expect(year).toBeVisible({ timeout: 60000 });
          await expect.poll(async () => (await year.locator('option').allTextContents()).filter(label => label === currentYearName).length,
            { timeout: 60000 }).toBe(1);
          await year.selectOption(currentYearValue);
          await expect(year).toHaveValue(currentYearValue);
          await page.screenshot({ path: `${output}/${key}-${tab}-unique-years.png`, fullPage: true });
          await page.reload();
          await page.getByRole('button', { name: tab, exact: true }).last().click();
          await expect.poll(async () => (await page.getByLabel('Année scolaire', { exact: true })
            .locator('option').allTextContents()).filter(label => label === currentYearName).length).toBe(1);
          record(`Année scolaire unique ${key} / ${tab}`, 'PASS');
        }
      }
    } catch (error) {
      await page.screenshot({ path: `${output}/${key}-failure.png`, fullPage: true }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
} catch (error) {
  record('Recette authentifiée', 'FAIL', String(error.message).slice(0, 500));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  try {
    await retire(service);
    if (manifest) {
      for (const account of manifest.users) {
        const user = await service.auth.getUser(account.uid);
        assert.equal(user.disabled, true, 'Compte fictif encore actif.');
        assert.deepEqual(user.customClaims ?? {}, {}, 'Claims fictifs encore actifs.');
      }
      for (const schoolId of manifest.schools) {
        const school = await service.db.doc(`schools/${schoolId}`).get();
        assert.equal(school.data().active, false, 'École fictive encore active.');
      }
      record('Clôture et vérification des fixtures Auth/Firestore', 'PASS');
    }
  } catch (error) {
    record('Clôture et vérification des fixtures Auth/Firestore', 'FAIL', String(error.message).slice(0, 500));
    process.exitCode = 1;
  }
  await service.close();
  writeFileSync(`${output}/results.json`, JSON.stringify({ sha: expectedSha, projectId, results }, null, 2));
}
