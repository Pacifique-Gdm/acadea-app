import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { services } from './socialFinanceStagingFixture.mjs';

// Read-only recovery inventory, bounded to the exact fixture label and prefix.
// Never edits, disables or deletes an account/document discovered by a query.
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'acadea-staging');
const s = services(), inventory = [];
try {
  const profiles = await s.db.collection('users').where('name', '==', 'Administrateur fictif actualisation').get();
  for (const profile of profiles.docs) {
    const user = profile.data(), tag = user.fixtureId;
    if (!/^e2e-refresh-[a-f0-9]{32}$/.test(tag ?? '')) continue;
    assert.equal(profile.id, tag + '-admin');
    assert.equal(user.schoolId, tag + '-school');
    assert.equal(user.active, false); assert.equal(user.fixtureLifecycle, 'retired');
    const auth = await s.auth.getUser(profile.id);
    assert.equal(auth.disabled, true); assert.deepEqual(auth.customClaims, {});
    const school = await s.db.doc('schools/' + user.schoolId).get();
    assert.equal(school.data().fixtureId, tag); assert.equal(school.data().active, false);
    const documents = [profile.ref.path, school.ref.path];
    for (const collection of ['schoolYears', 'classes', 'students', 'feeTypes', 'payments', 'auditLogs', 'offlineOperations', 'financialIdempotency']) {
      const rows = await s.db.collection(collection).where('schoolId', '==', user.schoolId).get();
      documents.push(...rows.docs.map(row => row.ref.path));
    }
    inventory.push({ fixtureId: tag, accountDisabled: true, claimsEmpty: true, schoolInactive: true, documents });
  }
  assert.ok(inventory.length > 0);
  const root = 'diagnostics/refresh-recovery-hosted'; mkdirSync(root, { recursive: true });
  writeFileSync(`${root}/closure-inventory.json`, JSON.stringify({ projectId: 'acadea-staging', verifiedAt: new Date().toISOString(), inventory }, null, 2), { mode: 0o600 });
  console.log(`PASS: ${inventory.length} comptes fictifs désactivés, écoles neutralisées, inventaire conservé ; aucune suppression.`);
} finally { await s.close(); }
