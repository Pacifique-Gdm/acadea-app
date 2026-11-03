import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, guard, services } from './socialFinanceStagingFixture.mjs';
const tag = 'e2e-social-' + 'a'.repeat(32);
const valid = () => ({ projectId: 'acadea-staging', tag, schools: [tag + '-a', tag + '-b'], users: ['school_admin', 'cashier', 'secretary', 'teacher'].map(role => ({ role, uid: tag + '-' + role, email: `${tag}-${role}@example.invalid`, schoolId: tag + '-a' })) });
test('le manifeste fictif exact est accepté', () => assert.doesNotThrow(() => validateManifest(valid())));
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
  const keys = ['ACADEA_SOCIAL_STAGING', 'GOOGLE_CLOUD_PROJECT', 'ACADEA_STAGING_ACCESS_TOKEN', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.ACADEA_SOCIAL_STAGING = 'YES'; process.env.GOOGLE_CLOUD_PROJECT = 'acadea-staging';
    process.env.ACADEA_STAGING_ACCESS_TOKEN = 'non-functional-unit-test-token';
    delete process.env.FIRESTORE_EMULATOR_HOST; delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const s = services();
    assert.equal(s.db.projectId, 'acadea-staging');
    await s.close();
  } finally {
    for (const key of keys) { if(previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
