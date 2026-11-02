import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guard, plan, assertOwned, roles } from './sectionStagingPlan.mjs';
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Pacifique-Gdm/acadea-app', GITHUB_REF: 'refs/heads/codex/section-admin-profiles-final-20261031', GOOGLE_CLOUD_PROJECT: 'acadea-staging', ACADEA_SECTION_RECIPE_AUTHORIZED: 'YES', ACADEA_EXPECTED_SHA: 'a'.repeat(40), ACADEA_SECTION_PREVIEW_URL: 'https://acadea-staging-abcdef-pacifique-gdms-projects.vercel.app/', STAGING_FIREBASE_STORAGE_BUCKET: 'acadea-staging.firebasestorage.app' };
test('garde Staging accepte uniquement le périmètre explicite', () => assert.doesNotThrow(() => guard(env)));
test('alias officiel Staging accepté, domaine ressemblant refusé', () => {
  assert.doesNotThrow(() => guard({ ...env, ACADEA_SECTION_PREVIEW_URL: 'https://acadea-staging.vercel.app/' }));
  assert.throws(() => guard({ ...env, ACADEA_SECTION_PREVIEW_URL: 'https://acadea-staging.vercel.app.attacker.example/' }));
});
for (const [key, value] of Object.entries({ GOOGLE_CLOUD_PROJECT: 'acadea-production', ACADEA_SECTION_PREVIEW_URL: 'https://acadea-app.vercel.app/', STAGING_FIREBASE_STORAGE_BUCKET: 'acadea-production.appspot.com', GITHUB_REF: 'refs/heads/main', ACADEA_SECTION_RECIPE_AUTHORIZED: '', FIRESTORE_EMULATOR_HOST: 'localhost:8080', FIREBASE_SERVICE_ACCOUNT_JSON: '{}' })) {
  test(`refus cible/configuration ${key}`, () => assert.throws(() => guard({ ...env, [key]: value })));
}
test('deux écoles, quatre sections chacune, parent mixte et comptes désactivés', () => {
  const m = plan();
  assert.equal(m.schools.length, 2); assert.equal(new Set(m.documents.map(d => d.path)).size, m.documents.length);
  for (const school of m.schools) {
    const pupils = m.documents.filter(d => d.path.startsWith('students/') && d.data.schoolId === school);
    assert.equal(pupils.length, 4); assert.equal(new Set(pupils.map(d => d.data.section)).size, 4);
    assert.equal(m.documents.find(d => d.path === `parents/${school}-parent`).data.studentIds.length, 4);
  }
  for (const d of m.documents.filter(d => roles[d.data.role])) assert.equal(d.data.active, false);
  assert.ok(!JSON.stringify(m).includes('password'));
});
test('nettoyage refuse les données étrangères et les écoles ambiguës', () => {
  const m = plan();
  assert.throws(() => assertOwned(m, 'students/real', { schoolId: 'real' }));
  assert.throws(() => assertOwned(m, 'schools/real', { fixtureId: m.tag }));
  for (const d of m.documents) assert.doesNotThrow(() => assertOwned(m, d.path, d.data));
});
test('identifiants non prévisibles et labels de fixture obligatoires', () => {
  assert.notEqual(plan().tag, plan().tag); assert.throws(() => plan('real-school'));
});
