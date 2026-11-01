import { plan } from './sectionStagingPlan.mjs';

// No delete permission, Storage operation or project-wide query is used here.
// Fictitious records are retained, not reported as erased.
export async function retire(s, m) {
  const expected = plan(m.tag);
  if (m.projectId !== 'acadea-staging' || JSON.stringify(m.users) !== JSON.stringify(expected.users)
    || JSON.stringify(m.schools) !== JSON.stringify(expected.schools)) throw new Error('Manifeste incohérent.');
  const paths = [...m.schools.map(id => `schools/${id}`), ...Object.values(m.users).map(u => `users/${u.uid}`)];
  const snapshots = [];
  // Validate ALL existing targets before the first mutation; interrupted provisioning is allowed.
  for (const path of paths) {
    const doc = await s.db.doc(path).get();
    if (doc.exists && (doc.data().fixtureId !== m.tag || doc.data().id !== path.split('/')[1])) throw new Error('Document ambigu.');
    if (doc.exists) snapshots.push([path, doc]);
  }
  const accounts = [];
  for (const user of Object.values(m.users)) {
    try {
      const existing = await s.auth.getUser(user.uid);
      if (existing.email !== user.email) throw new Error('Compte ambigu.');
      accounts.push(user.uid);
    } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  }
  // Disable application profiles first, including the fictitious Super Administrator.
  // Update preconditions refuse replacement/concurrent changes; rerunning is safe.
  for (const [path, doc] of snapshots) {
    await s.db.doc(path).update({ active: false, status: 'inactive', fixtureLifecycle: 'retired' }, { lastUpdateTime: doc.updateTime });
  }
  for (const uid of accounts) {
    await s.auth.updateUser(uid, { disabled: true });
    await s.auth.setCustomUserClaims(uid, {});
    await s.auth.revokeRefreshTokens(uid);
  }
  for (const uid of accounts) {
    const user = await s.auth.getUser(uid);
    if (!user.disabled || Object.keys(user.customClaims || {}).length) throw new Error('Compte encore autorisé.');
  }
  for (const [path] of snapshots) {
    const doc = await s.db.doc(path).get();
    if (!doc.exists || doc.data().fixtureId !== m.tag || doc.data().active !== false || doc.data().status !== 'inactive') throw new Error('Clôture non confirmée.');
  }
  return { retired: true, cleaned: false, retained: true, disabledAccounts: accounts.length,
    storageDeletionPerformed: false, hostedAccessRevocationVerified: false };
}
