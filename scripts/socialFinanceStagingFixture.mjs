import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

export const projectId = 'acadea-staging';
export const manifestPath = 'diagnostics/social-finance-staging/manifest.json';
export function validateManifest(m) {
  const roles = ['school_admin', 'cashier', 'secretary', 'teacher', ...(m.recipe === 'navigation' ? ['study_director', 'discipline_director', 'coordination_admin', 'sub_coordination_admin'] : [])];
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
  // Admin Auth reads this official setting when using end-user OAuth tokens.
  // Pin quota attribution to Staging, exactly like the Firestore OAuth client.
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  const app = initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: process.env.ACADEA_STAGING_ACCESS_TOKEN, expires_in: 1800 }) } }, `social-${randomUUID()}`);
  // Firebase Admin Auth accepts a short-lived credential; its Firestore wrapper
  // only accepts ADC/certificates. Use the official Google Cloud client with
  // the same OAuth identity, without persisting credentials or changing IAM.
  const authClient = new OAuth2Client({ quotaProjectId: projectId });
  authClient.setCredentials({ access_token: process.env.ACADEA_STAGING_ACCESS_TOKEN });
  const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });
  return { db, auth: getAuth(app), close: async () => { await db.terminate(); await deleteApp(app); } };
}
export function saveManifest(m) {
  mkdirSync('diagnostics/social-finance-staging', { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2), { mode: 0o600 });
}
export async function prepare(s, recipe) {
  guard();
  if (recipe !== undefined && recipe !== 'navigation') throw Error('Recette inconnue.');
  if (existsSync(manifestPath) && !JSON.parse(readFileSync(manifestPath, 'utf8')).retired) throw Error('Fixture précédente non clôturée.');
  const tag = `e2e-social-${randomUUID().replaceAll('-', '')}`;
  const schools = [tag + '-a', tag + '-b'];
  const year = tag + '-year', student = tag + '-student', fee = tag + '-fee';
  const users = ['school_admin', 'cashier', 'secretary', 'teacher', ...(recipe === 'navigation' ? ['study_director', 'discipline_director', 'coordination_admin', 'sub_coordination_admin'] : [])].map(role => ({ uid: tag + '-' + role, email: `${tag}-${role}@example.invalid`, role, schoolId: schools[0], ...(role.includes('coordination_admin') ? {coordinationId:tag+'-coordination'} : {}), ...(role==='sub_coordination_admin' ? {subCoordinationId:tag+'-subcoordination'} : {}) }));
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
  add('correspondences', tag + '-letter', { schoolId: schools[0], schoolYearId: year, status: 'draft', subject: 'Recette fictive PDF' });
  for (const u of users) add('users', u.uid, { role: u.role, schoolId: u.schoolId, name: 'Compte fictif ' + u.role, email: u.email, active: true, status: 'active', activeSchoolYearId: year, ...(recipe === 'navigation' ? {sectionIds:['Primaire']} : {}), ...(u.coordinationId ? {coordinationId:u.coordinationId} : {}), ...(u.subCoordinationId ? {subCoordinationId:u.subCoordinationId} : {}) });
  if (recipe === 'navigation') {
    const coordinationId=tag+'-coordination',subCoordinationId=tag+'-subcoordination';
    add('coordinations',coordinationId,{name:'Coordination fictive navigation',code:'FICTIF',status:'active',referenceSchoolYear:'2098-2099',principalCoordinatorUserId:tag+'-coordination_admin'});
    add('subCoordinations',subCoordinationId,{coordinationId,coordinatorUserId:tag+'-sub_coordination_admin',active:true,status:'active',circumscription:'Fictif'});
    add('coordinationSchools',coordinationId+'__'+schools[0],{coordinationId,schoolId:schools[0],active:true,addedAt:new Date().toISOString()});
    add('subCoordinationSchools',subCoordinationId+'__'+schools[0],{coordinationId,subCoordinationId,schoolId:schools[0],active:true});
    documents.find(row=>row.path==='schools/'+schools[0]).data.activeCoordinationId=coordinationId;
    add('classes', tag+'-class', {schoolId:schools[0],schoolYearId:year,name:'1ère Primaire',section:'Primaire',active:true});
    for (const suffix of ['A','B']) add('classes', tag+'-class-'+suffix, {schoolId:schools[0],schoolYearId:year,name:'1ère Primaire',section:'Primaire',active:true,parentClassId:tag+'-class',subClassLabel:suffix});
    add('classes', tag+'-empty', {schoolId:schools[0],schoolYearId:year,name:'2ème Primaire',section:'Primaire',active:true});
    add('parents', tag+'-parent', {schoolId:schools[0],fullName:'Émilie Parent Fictif',phone:'+243000000001',email:'parent@example.invalid',studentIds:[student],status:'active'});
    for (const row of documents.filter(row=>row.path.startsWith('students/'))) Object.assign(row.data,{classId:tag+'-class',subClassId:tag+'-class-A',parentId:tag+'-parent'});
  }
  for (const row of documents) {
    let existing;
    try { existing = await s.db.doc(row.path).get(); }
    catch (e) { throw Error(`Précontrôle Firestore (${e.code ?? 'inconnu'}) : ${e.message}`); }
    if (existing.exists) throw Error('Collision de document.');
  }
  for (const u of users) {
    try { await s.auth.getUser(u.uid); throw Error('Collision Auth.'); } catch(e) {
      if(e.code !== 'auth/user-not-found') throw Error(`Précontrôle Auth (${e.code ?? 'inconnu'}) : ${e.message}`);
    }
  }
  const m = { projectId, tag, schools, year, student, fee, users, documents, ...(recipe ? {recipe} : {}), createdAt: new Date().toISOString(), retired: false };
  saveManifest(m); // Durable plan before ANY write. No password or token persisted.
  const password = 'Ephemeral-' + randomUUID() + randomUUID();
  for (const row of documents) await s.db.doc(row.path).create(row.data);
  for (const u of users) {
    await s.auth.createUser({ uid: u.uid, email: u.email, password });
    await s.auth.setCustomUserClaims(u.uid, { role: u.role, schoolId: u.schoolId, ...(u.coordinationId ? {coordinationId:u.coordinationId} : {}), ...(u.subCoordinationId ? {subCoordinationId:u.subCoordinationId} : {}) });
  }
  return { m, password };
}
export async function retire(s) {
  guard();
  if (!existsSync(manifestPath)) return;
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateManifest(m);
  const docs = [];
  const extra = m.recipe === 'navigation' ? [`coordinations/${m.tag}-coordination`,`subCoordinations/${m.tag}-subcoordination`,`coordinationSchools/${m.tag}-coordination__${m.schools[0]}`,`subCoordinationSchools/${m.tag}-subcoordination__${m.schools[0]}`] : [];
  for (const path of [...m.schools.map(id => `schools/${id}`), ...m.users.map(u => `users/${u.uid}`), ...extra]) {
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
