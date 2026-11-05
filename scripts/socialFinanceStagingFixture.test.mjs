import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, guard, services } from './socialFinanceStagingFixture.mjs';
const tag = 'e2e-social-' + 'a'.repeat(32);
const valid = () => ({ projectId: 'acadea-staging', tag, schools: [tag + '-a', tag + '-b'], users: ['school_admin', 'cashier', 'secretary', 'teacher'].map(role => ({ role, uid: tag + '-' + role, email: `${tag}-${role}@example.invalid`, schoolId: tag + '-a' })) });
test('le manifeste fictif exact est accepté', () => assert.doesNotThrow(() => validateManifest(valid())));
test('la recette combinée exige uniquement ses rôles fictifs connus', () => {
  const m = valid();
  m.recipe = 'pr46pr47';
  m.users.push(...['study_director', 'discipline_director', 'coordination_admin', 'sub_coordination_admin'].map(role => ({ role, uid: tag + '-' + role, email: `${tag}-${role}@example.invalid`, schoolId: tag + '-a' })));
  assert.doesNotThrow(() => validateManifest(m));
  m.users.push({ role: 'super_admin', uid: tag + '-super_admin', email: 'unwanted@example.invalid', schoolId: tag + '-a' });
  assert.throws(() => validateManifest(m));
});
test('inscription UI manifestée : une école, une année, un nom unique et un rôle exact', () => {
  const m = valid();
  m.recipe = 'pr46pr47'; m.year = tag + '-year';
  m.users.push(...['study_director', 'discipline_director', 'coordination_admin', 'sub_coordination_admin'].map(role => ({ role, uid: tag + '-' + role, email: `${tag}-${role}@example.invalid`, schoolId: tag + '-a' })));
  const entry = { role: 'school_admin', nom: tag.toUpperCase(), postnom: 'PR46', prenom: 'Admin',
    schoolId: m.schools[0], schoolYearId: m.year, className: '2ème Primaire', path: 'students/student-' + 'a'.repeat(32) };
  m.uiEnrollments = [entry];
  assert.doesNotThrow(() => validateManifest(m));
  for (const [field, bad] of [['nom', 'RÉEL'], ['schoolId', 'existing-school'], ['schoolYearId', 'existing-year'],
    ['role', 'super_admin'], ['path', 'students/existing-student']]) {
    const altered = structuredClone(m); altered.uiEnrollments[0][field] = bad;
    assert.throws(() => validateManifest(altered), field);
  }
});
for (const [name, mutate] of [
  ['Production', m => m.projectId = 'acadea-production'],
  ['école étrangère', m => m.schools[0] = 'existing-school'],
  ['identité étrangère', m => m.users[0].uid = 'existing-user'],
  ['courriel ambigu', m => m.users[0].email = 'other@example.invalid'],
  ['compte supplémentaire', m => m.users.push(m.users[0])],
  ['rôle modifié', m => m.users[0].role = 'super_admin'],
]) test(`clôture refusée : ${name}`, () => { const m = valid(); mutate(m); assert.throws(() => validateManifest(m)); });
test('absence de consentement Staging : refus sans appel distant', () => { const previous = process.env.ACADEA_SOCIAL_STAGING; delete process.env.ACADEA_SOCIAL_STAGING; try { assert.throws(guard); } finally { if(previous !== undefined) process.env.ACADEA_SOCIAL_STAGING = previous; } });
test('initialisation OAuth éphémère sans appel distant ni certificat', async () => {
  const keys = ['ACADEA_SOCIAL_STAGING', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_QUOTA_PROJECT', 'ACADEA_STAGING_ACCESS_TOKEN', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.ACADEA_SOCIAL_STAGING = 'YES'; process.env.GOOGLE_CLOUD_PROJECT = 'acadea-staging';
    process.env.ACADEA_STAGING_ACCESS_TOKEN = 'non-functional-unit-test-token';
    delete process.env.FIRESTORE_EMULATOR_HOST; delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const s = services();
    assert.equal(s.db.projectId, 'acadea-staging');
    assert.equal(process.env.GOOGLE_CLOUD_QUOTA_PROJECT, 'acadea-staging');
    await s.close();
  } finally {
    for (const key of keys) { if(previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
