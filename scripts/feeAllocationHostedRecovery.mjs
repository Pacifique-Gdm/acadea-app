import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { services } from './socialFinanceStagingFixture.mjs';

// Recovery after a runner interruption. No deletes, no account reactivation,
// and no discovery outside the identity-only manifest of this exact recipe.
const path = 'diagnostics/fee-allocation-hosted/manifest.json';
const manifest = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'acadea-staging');
assert.equal(manifest.projectId, 'acadea-staging');
assert.match(manifest.tag, /^e2e-allocation-[a-f0-9]{32}$/);
assert.ok(manifest.schools.every(id => ['-a', '-b', '-inactive', '-volume'].some(suffix => id === manifest.tag + suffix)));
assert.ok(manifest.users.every(u => u.uid.startsWith(manifest.tag + '-') && u.email === `${u.uid}@example.invalid`));
const s = services();
try {
  let accounts = 0, scopes = 0;
  for (const u of manifest.users) {
    let account;
    try { account = await s.auth.getUser(u.uid); }
    catch (error) { if (error.code === 'auth/user-not-found') continue; throw error; }
    assert.equal(account.email, u.email);
    await s.auth.updateUser(u.uid, { disabled: true });
    await s.auth.setCustomUserClaims(u.uid, {});
    await s.auth.revokeRefreshTokens(u.uid);
    const check = await s.auth.getUser(u.uid);
    assert.equal(check.disabled, true); assert.equal(Object.keys(check.customClaims ?? {}).length, 0);
    accounts++;
  }
  for (const docPath of manifest.paths.filter(p => /^(schools|users|coordinations|subCoordinations|coordinationSchools|subCoordinationSchools|feeAllocationTestScopes)\//.test(p))) {
    const ref = s.db.doc(docPath), snap = await ref.get();
    if (!snap.exists) continue;
    assert.equal(snap.data().fixtureId, manifest.tag);
    assert.equal(snap.data().id, snap.id);
    assert.ok(snap.id.startsWith(manifest.tag));
    await ref.update({ active: false, status: 'inactive', fixtureLifecycle: 'retired' }, { lastUpdateTime: snap.updateTime });
    assert.equal((await ref.get()).data().active, false); scopes++;
  }
  // Retain an exact inventory, including server-created records and evidence.
  const retained = {};
  for (const collection of ['payments', 'expenses', 'personnelPayments', 'feeAllocationStates', 'feeAllocationConfigs', 'feeAllocationVersions', 'feeAllocationOpeningAudits', 'feeAllocationBalances', 'feeAllocationMovements', 'feeAllocationRequests', 'feeAllocationAnchors', 'financialIdempotency', 'financialCounters', 'financialCashLocks', 'auditLogs', 'feeAllocationReconciliationRuns', 'feeAllocationHistoricalProofs', 'feeAllocationHistoricalDecisions', 'feeAllocationEvidenceClaims', 'feeAllocationEvidenceRevisions']) {
    retained[collection] = [];
    for (const schoolId of manifest.schools) {
      const docs = await s.db.collection(collection).where('schoolId', '==', schoolId).get();
      retained[collection].push(...docs.docs.map(doc => ({ schoolId, id: doc.id })));
    }
  }
  retained.reconciliationDocuments = [];
  for (const run of retained.feeAllocationReconciliationRuns) for (const collection of ['pages', 'versions']) {
    for (const doc of (await s.db.collection(`feeAllocationReconciliationRuns/${run.id}/${collection}`).get()).docs) {
      assert.ok(manifest.schools.includes(doc.data().schoolId));
      retained.reconciliationDocuments.push({ schoolId: doc.data().schoolId, path: doc.ref.path });
    }
  }
  manifest.retained = retained; manifest.retired = true; manifest.deleted = false;
  manifest.closedAt = new Date().toISOString(); manifest.recovery = { accounts, scopes };
  writeFileSync(path, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ projectId: manifest.projectId, retired: true, deleted: false, accounts, scopes }));
} finally { await s.close(); }
