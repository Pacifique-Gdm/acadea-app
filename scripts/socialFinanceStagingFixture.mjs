import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const projectId = 'acadea-staging';
export const manifestPath = 'diagnostics/social-finance-staging/manifest.json';
export function validateManifest(m) {
  const roles = ['school_admin', 'cashier', 'secretary', 'teacher'];
  if (m.projectId !== projectId || !/^e2e-social-[a-f0-9]{32}$/.test(m.tag)
    || JSON.stringify(m.schools) !== JSON.stringify([m.tag + '-a', m.tag + '-b'])
    || !Array.isArray(m.users) || m.users.length !== roles.length
    || m.users.some((u, i) => u.role !== roles[i] || u.uid !== `${m.tag}-${roles[i]}`
      || u.email !== `${m.tag}-${roles[i]}@example.invalid` || u.schoolId !== m.schools[0])) throw Error('Manifeste ambigu.');
}
export function guard() {
  if (process.env.ACADEA_SOCIAL_STAGING !== 'YES' || process.env.GOOGLE_CLOUD_PROJECT !== projectId
    || !process.env.ACADEA_STAGING_ACCESS_TOKEN || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw Error('Recette réservée au Staging autorisé.');
}
export function services() {
  guard();
  const app = initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: process.env.ACADEA_STAGING_ACCESS_TOKEN, expires_in: 1800 }) } }, `social-${randomUUID()}`);
  return { db: getFirestore(app), auth: getAuth(app), close: () => deleteApp(app) };
}
export function saveManifest(m) {
  mkdirSync('diagnostics/social-finance-staging', { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2), { mode: 0o600 });
}
export async function prepare(s) {
  guard();
  if (existsSync(manifestPath) && !JSON.parse(readFileSync(manifestPath, 'utf8')).retired) throw Error('Fixture précédente non clôturée.');
  const tag = `e2e-social-${randomUUID().replaceAll('-', '')}`;
  const schools = [tag + '-a', tag + '-b'];
  const year = tag + '-year', student = tag + '-student', fee = tag + '-fee';
  const users = ['school_admin', 'cashier', 'secretary', 'teacher'].map(role => ({ uid: tag + '-' + role, email: `${tag}-${role}@example.invalid`, role, schoolId: schools[0] }));
  const documents = [];
  const add = (collection, id, data) => documents.push({ path: `${collection}/${id}`, data: { id, fixtureId: tag, ...data } });
  for (const [i, schoolId] of schools.entries()) {
    const schoolYearId = i ? tag + '-other-year' : year;
    add('schools', schoolId, { name: 'École fictive recette sociale ' + i, status: 'active', currency: 'USD', activeSchoolYearId: schoolYearId,
      schoolOptions: [], schoolType: 'Primaire uniquement', educationLevels: ['Primaire'], subscriptionStatus: 'active', subscriptionPlan: 'premium' });
    add('schoolYears', schoolYearId, { schoolId, name: '2098-2099', status: 'active', currency: 'USD', startsAt: '2098-09-01', endsAt: '2099-07-31' });
  }
  for (const [i, id] of [student, tag + '-unpaid'].entries()) add('students', id, { schoolId: schools[0], schoolYearId: year, nom: i ? 'IMPAYE' : 'SOCIAL', postnom: 'FICTIF', prenom: 'Recette', matricule: `E2E-${i}`, className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', sexe: 'F', birthDate: '2090-01-01' });
  add('feeTypes', fee, { schoolId: schools[0], schoolYearId: year, name: 'Minerval', amount: 300, className: '1ère Primaire' });
  for (const u of users) add('users', u.uid, { role: u.role, schoolId: u.schoolId, name: 'Compte fictif ' + u.role, email: u.email, active: true, status: 'active', activeSchoolYearId: year });
  for (const row of documents) if ((await s.db.doc(row.path).get()).exists) throw Error('Collision de document.');
  for (const u of users) {
    try { await s.auth.getUser(u.uid); throw Error('Collision Auth.'); } catch(e) { if(e.code !== 'auth/user-not-found') throw e; }
  }
  const m = { projectId, tag, schools, year, student, fee, users, documents, createdAt: new Date().toISOString(), retired: false };
  saveManifest(m); // Durable plan before ANY write. No password or token persisted.
  const password = 'Ephemeral-' + randomUUID() + randomUUID();
  for (const row of documents) await s.db.doc(row.path).create(row.data);
  for (const u of users) {
    await s.auth.createUser({ uid: u.uid, email: u.email, password });
    await s.auth.setCustomUserClaims(u.uid, { role: u.role, schoolId: u.schoolId });
  }
  return { m, password };
}
export async function retire(s) {
  guard();
  if (!existsSync(manifestPath)) return;
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateManifest(m);
  const docs = [];
  for (const path of [...m.schools.map(id => `schools/${id}`), ...m.users.map(u => `users/${u.uid}`)]) {
    const d = await s.db.doc(path).get();
    if (d.exists && (d.data().fixtureId !== m.tag || d.data().id !== d.id)) throw Error('Document étranger.');
    if (d.exists) docs.push(d);
  }
  const accounts = [];
  for (const u of m.users) {
    try { const a = await s.auth.getUser(u.uid); if (a.email !== u.email) throw Error('Compte étranger.'); accounts.push(a); } catch(e) { if(e.code !== 'auth/user-not-found') throw e; }
  }
  for (const d of docs) await d.ref.update({ active: false, status: 'inactive', fixtureLifecycle: 'retired' }, { lastUpdateTime: d.updateTime });
  for (const a of accounts) {
    await s.auth.updateUser(a.uid, { disabled: true });
    await s.auth.setCustomUserClaims(a.uid, {});
    await s.auth.revokeRefreshTokens(a.uid);
    const check = await s.auth.getUser(a.uid);
    if (!check.disabled || Object.keys(check.customClaims || {}).length) throw Error('Clôture Auth non confirmée.');
  }
  for (const d of docs) if ((await d.ref.get()).data().active !== false) throw Error('Clôture Firestore non confirmée.');
  m.retired = true; m.retained = true; m.deleted = false; m.closedAt = new Date().toISOString(); saveManifest(m);
}
