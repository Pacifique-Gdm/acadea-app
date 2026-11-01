import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { guard, plan, assertOwned } from './sectionStagingPlan.mjs';

const file = () => resolve('test-results/section-staging-manifest.json');
const save = m => { mkdirSync('test-results', { recursive: true }); writeFileSync(file(), JSON.stringify(m, null, 2), { mode: 0o600 }); };
export async function services() {
  guard(process.env);
  const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (credentials.type !== 'external_account' || credentials.private_key) throw new Error('WIF obligatoire, clés privées refusées.');
  const app = initializeApp({ credential: applicationDefault(), projectId: 'acadea-staging', storageBucket: process.env.STAGING_FIREBASE_STORAGE_BUCKET }, `section-${Date.now()}`);
  return { app, db: getFirestore(app), auth: getAuth(app), bucket: getStorage(app).bucket() };
}
export function manifest() {
  const m = JSON.parse(readFileSync(file(), 'utf8'));
  const expected = plan(m.tag);
  if (m.projectId !== expected.projectId || JSON.stringify(m.schools) !== JSON.stringify(expected.schools)
    || JSON.stringify(m.users) !== JSON.stringify(expected.users)
    || JSON.stringify(m.documents) !== JSON.stringify(expected.documents)) throw new Error('Manifeste incohérent.');
  return m;
}
export async function preparePlan(s) {
  if (existsSync(file())) throw new Error('Manifeste existant : nettoyage préalable requis.');
  if (!process.env.ACADEA_E2E_PASSWORD || process.env.ACADEA_E2E_PASSWORD.length < 40) throw new Error('Identifiant éphémère absent.');
  const m = plan();
  // Check every target before persisting the manifest or creating anything.
  for (const row of m.documents) if ((await s.db.doc(row.path).get()).exists) throw new Error('Collision de document.');
  for (const user of Object.values(m.users)) {
    try { await s.auth.getUser(user.uid); throw new Error('Collision de compte.'); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  }
  save(m);
}
export async function prepare(s) {
  const m = manifest();
  if (!process.env.ACADEA_E2E_PASSWORD || process.env.ACADEA_E2E_PASSWORD.length < 40) throw new Error('Identifiant éphémère absent.');
  for (const row of m.documents) {
    m.createdPaths.push(row.path); save(m); // Durable intent before write, including interrupted writes.
    await s.db.doc(row.path).create(row.data);
  }
  for (const user of Object.values(m.users)) {
    m.createdUsers.push(user.uid); save(m);
    await s.auth.createUser({ uid: user.uid, email: user.email, password: process.env.ACADEA_E2E_PASSWORD, disabled: ['kindergarten_admin', 'primary_admin', 'studies_prefect'].includes(user.role) });
    const { role, schoolId, parentId } = user;
    await s.auth.setCustomUserClaims(user.uid, { role, ...(schoolId ? { schoolId } : {}), ...(parentId ? { parentId } : {}) });
  }
}
export async function cleanup(s) {
  if (!existsSync(file())) return;
  const m = manifest();
  // Discover only records carrying fixture-owned schools/tag. Never scan real documents.
  const collect = async () => {
    const records = new Map();
    for (const collection of await s.db.listCollections()) {
      for (const [field, value] of [['fixtureId', m.tag], ...m.schools.map(id => ['schoolId', id])]) {
        for (const doc of (await collection.where(field, '==', value).get()).docs) records.set(doc.ref.path, doc);
      }
    }
    for (const { path } of m.documents) { const d = await s.db.doc(path).get(); if (d.exists) records.set(path, d); }
    return records;
  };
  const records = await collect();
  for (const [path, d] of records) {
    assertOwned(m, path, d.data());
    if ((await d.ref.listCollections()).length) throw new Error('Sous-collection imprévue : nettoyage manuel ciblé requis.');
  }
  // No files outside the two newly created schools; preconditions prevent concurrent replacement.
  for (const school of m.schools) for (const prefix of [`messages/${school}/`, `valves/${school}/`, `message-uploads/${school}/`]) {
    const [files] = await s.bucket.getFiles({ prefix });
    for (const object of files) { const [meta] = await object.getMetadata(); await object.delete({ ifGenerationMatch: meta.generation }); }
    if ((await s.bucket.getFiles({ prefix }))[0].length) throw new Error('Résidus Storage.');
  }
  for (const [path, d] of records) await s.db.doc(path).delete({ lastUpdateTime: d.updateTime });
  // Rate-limit documents have hashed ownership rather than schoolId.
  const actions = ['school.message.send', 'school.message.recipients', 'provision.account', 'provision.manage-section-administrator',
    'load-section-school-bootstrap', 'load-section-dashboard', 'list-section-school-records', 'students.save-manual',
    ...['list-section-financial-history', 'list-cash-balance', 'list-payroll-history', 'list-personnel-payments', 'list-resolved-expense-currencies',
      'create-payment', 'update-payment', 'delete-payment', 'create-expense', 'update-expense', 'delete-expense', 'create-cash-inflow',
      'create-personnel-payment', 'update-personnel-payment', 'delete-personnel-payment', 'list-arrears', 'list-arrears-batch'].map(a => `finance.${a}`)];
  for (const user of Object.values(m.users)) for (const action of actions) {
    const hash = createHash('sha256').update([user.uid, 'actor', action].join('\u001f')).digest('hex');
    for (const doc of (await s.db.collection('_rateLimits').where('actorIdHash', '==', hash).get()).docs) {
      if (doc.data().action !== action) throw new Error('Limiteur ambigu.');
      await doc.ref.delete({ lastUpdateTime: doc.updateTime });
    }
    if (!(await s.db.collection('_rateLimits').where('actorIdHash', '==', hash).get()).empty) throw new Error('Résidu limiteur.');
  }
  for (const uid of Object.values(m.users).map(u => u.uid)) {
    const expected = Object.values(m.users).find(user => user.uid === uid);
    if (!expected) throw new Error('UID non prévu.');
    try { const user = await s.auth.getUser(uid); if (user.email !== expected.email) throw new Error('Compte ambigu.'); await s.auth.deleteUser(uid); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    try { await s.auth.getUser(uid); throw new Error('Résidu Auth.'); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  }
  if ((await collect()).size) throw new Error('Résidus Firestore.');
  m.cleaned = true; save(m);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await services();
  try { if (process.argv[2] === 'plan') await preparePlan(s); else if (process.argv[2] === 'prepare') await prepare(s); else if (process.argv[2] === 'cleanup') await cleanup(s); else throw new Error('Commande invalide.'); }
  finally { await deleteApp(s.app); }
}
