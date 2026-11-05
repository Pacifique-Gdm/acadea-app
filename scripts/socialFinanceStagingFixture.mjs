import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { studentSearchFields } from '../src/utils/studentSearch.js';

export const projectId = 'acadea-staging';
export const manifestPath = 'diagnostics/social-finance-staging/manifest.json';
const navigationRecipe = (recipe) => recipe === 'navigation' || recipe === 'pr46pr47';
export function fixtureDocument(collection, id, tag, data) {
  return { path: `${collection}/${id}`, data: { id, fixtureId: tag, ...data, ...(collection === 'students' ? studentSearchFields(data) : {}) } };
}
export function validateManifest(m) {
  if (m.recipe !== undefined && !navigationRecipe(m.recipe)) throw Error('Recette de manifeste inconnue.');
  const roles = ['school_admin', 'cashier', 'secretary', 'teacher', ...(navigationRecipe(m.recipe) ? ['study_director', 'discipline_director', 'coordination_admin', 'sub_coordination_admin'] : [])];
  if (m.projectId !== projectId || !/^e2e-social-[a-f0-9]{32}$/.test(m.tag)
    || JSON.stringify(m.schools) !== JSON.stringify([m.tag + '-a', m.tag + '-b'])
    || !Array.isArray(m.users) || m.users.length !== roles.length
    || m.users.some((u, i) => u.role !== roles[i] || u.uid !== `${m.tag}-${roles[i]}`
      || u.email !== `${m.tag}-${roles[i]}@example.invalid` || u.schoolId !== m.schools[0])) throw Error('Manifeste ambigu.');
  if (m.uiEnrollments !== undefined && (!Array.isArray(m.uiEnrollments)
    || m.uiEnrollments.some((entry) => !['school_admin', 'secretary'].includes(entry.role)
      || entry.nom !== m.tag.toUpperCase() || entry.postnom !== 'PR46'
      || entry.prenom !== (entry.role === 'school_admin' ? 'Admin' : 'Secretaire')
      || entry.schoolId !== m.schools[0] || entry.schoolYearId !== m.year
      || entry.className !== '2ème Primaire'
      || (entry.path !== undefined && !/^students\/student-[a-zA-Z0-9-]+$/.test(entry.path))))) throw Error('Inscription UI ambiguë.');
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
function assertEnrollment(m, entry) {
  validateManifest(m);
  if (m.recipe !== 'pr46pr47' || !entry || !['school_admin', 'secretary'].includes(entry.role)
    || entry.nom !== m.tag.toUpperCase() || entry.postnom !== 'PR46'
    || entry.prenom !== (entry.role === 'school_admin' ? 'Admin' : 'Secretaire')) throw Error('Inscription UI hors fixture.');
}
async function findEnrollment(s, entry) {
  // A single-school query avoids requiring a composite index. This is an isolated
  // school with only fixture data, so the bounded scan cannot touch real pupils.
  const snapshot = await s.db.collection('students').where('schoolId', '==', entry.schoolId).get();
  return snapshot.docs.filter((doc) => {
    const data = doc.data();
    return data.schoolYearId === entry.schoolYearId
      && String(data.nom ?? '').toLocaleUpperCase('fr') === entry.nom
      && String(data.postnom ?? '').toLocaleUpperCase('fr') === entry.postnom
      && String(data.prenom ?? '').toLocaleUpperCase('fr') === entry.prenom.toLocaleUpperCase('fr')
      && data.className === entry.className;
  });
}
export async function beforeEnrollment(s, m, candidate) {
  guard();
  const entry = { ...candidate, schoolId: m.schools[0], schoolYearId: m.year, className: '2ème Primaire', plannedAt: new Date().toISOString() };
  assertEnrollment(m, entry);
  if (m.uiEnrollments?.some((item) => item.role === entry.role)) throw Error('Inscription UI déjà planifiée.');
  if ((await findEnrollment(s, entry)).length) throw Error('Inscription UI préexistante : création interdite.');
  m.uiEnrollments = [...(m.uiEnrollments ?? []), entry];
  saveManifest(m); // Durable intent before the application's write.
  return entry;
}
export async function afterEnrollment(s, m, candidate) {
  guard();
  assertEnrollment(m, candidate);
  const entry = m.uiEnrollments?.find((item) => item.role === candidate.role);
  if (!entry) throw Error('Inscription UI non planifiée.');
  const found = await findEnrollment(s, entry);
  if (found.length !== 1) throw Error(`Inscription UI ambiguë ou non confirmée (${found.length}).`);
  const doc = found[0];
  const data = doc.data();
  if (data.fixtureId && data.fixtureId !== m.tag) throw Error('Inscription UI étrangère.');
  if (entry.path && entry.path !== doc.ref.path) throw Error('Inscription UI différente de celle manifestée.');
  entry.path = doc.ref.path;
  saveManifest(m); // Save the exact path before tagging the already-identified document.
  if (data.fixtureId !== m.tag) await doc.ref.update({ fixtureId: m.tag }, { lastUpdateTime: doc.updateTime });
  return { path: entry.path };
}
export async function verifyEnrollmentLifecycle(s, m) {
  guard();
  validateManifest(m);
  const evidence = [];
  for (const entry of m.uiEnrollments ?? []) {
    const found = await findEnrollment(s, entry);
    if (found.length > 1) throw Error('Inscription UI multiple après clôture.');
    if (entry.path && (found.length !== 1 || found[0].ref.path !== entry.path)) throw Error('Inscription UI manifestée introuvable.');
    if (found.length) {
      const data = found[0].data();
      if (data.fixtureId !== m.tag || data.status !== 'ARCHIVED' || data.active !== false || data.fixtureLifecycle !== 'retired') throw Error('Inscription UI non clôturée.');
      evidence.push(found[0].ref.path);
    }
  }
  return { archivedUiEnrollments: evidence.length, paths: evidence };
}
export async function inventoryPr46Pr47Residues(s, m) {
  guard();
  validateManifest(m);
  if (m.recipe !== 'pr46pr47') throw Error('Inventaire réservé à la recette PR46/47.');
  const result = {};
  for (const collection of ['students', 'parents', 'classes', 'feeTypes', 'schoolYears', 'payments',
    'manualStudentReceipts', 'studentIdentityLocks', 'auditLogs', 'correspondences',
    'notifications', 'messages', 'conversations']) {
    const rows = await s.db.collection(collection).where('schoolId', 'in', m.schools).get();
    result[collection] = rows.docs.map((doc) => ({ path: doc.ref.path,
      fixtureTagged: doc.data().fixtureId === m.tag,
      schoolId: doc.data().schoolId,
      retired: doc.data().fixtureLifecycle === 'retired' || doc.data().active === false || doc.data().status === 'ARCHIVED' }));
  }
  const counterPath = `studentMatriculeCounters/${m.schools[0]}__${m.year}`;
  const counter = await s.db.doc(counterPath).get();
  result.studentMatriculeCounters = counter.exists ? [{ path: counterPath, schoolId: counter.data()?.schoolId, fixtureTagged: false, retained: true }] : [];
  for (const rows of Object.values(result)) for (const row of rows) {
    if (!m.schools.includes(row.schoolId)) throw Error(`Résidu hors école fictive : ${row.path}`);
  }
  return result;
}
export async function prepare(s, recipe) {
  guard();
  if (recipe !== undefined && !navigationRecipe(recipe)) throw Error('Recette inconnue.');
  if (existsSync(manifestPath) && !JSON.parse(readFileSync(manifestPath, 'utf8')).retired) throw Error('Fixture précédente non clôturée.');
  const tag = `e2e-social-${randomUUID().replaceAll('-', '')}`;
  const schools = [tag + '-a', tag + '-b'];
  const year = tag + '-year', student = tag + '-student', fee = tag + '-fee';
  const users = ['school_admin', 'cashier', 'secretary', 'teacher', ...(navigationRecipe(recipe) ? ['study_director', 'discipline_director', 'coordination_admin', 'sub_coordination_admin'] : [])].map(role => ({ uid: tag + '-' + role, email: `${tag}-${role}@example.invalid`, role, schoolId: schools[0], ...(role.includes('coordination_admin') ? {coordinationId:tag+'-coordination'} : {}), ...(role==='sub_coordination_admin' ? {subCoordinationId:tag+'-subcoordination'} : {}) }));
  const documents = [];
  const add = (collection, id, data) => documents.push(fixtureDocument(collection, id, tag, data));
  for (const [i, schoolId] of schools.entries()) {
    const schoolYearId = i ? tag + '-other-year' : year;
    const currency = recipe === 'pr46pr47' && i === 1 ? 'CDF' : 'USD';
    add('schools', schoolId, { name: 'École fictive recette sociale ' + i, status: 'active', currency, activeSchoolYearId: schoolYearId,
      schoolOptions: recipe === 'pr46pr47' && i === 0 ? ['Commerciale', 'Sciences'] : [],
      schoolType: recipe === 'pr46pr47' && i === 0 ? 'Mixte' : 'Primaire uniquement',
      educationLevels: recipe === 'pr46pr47' && i === 0 ? ['Primaire', 'Secondaire'] : ['Primaire'],
      subscriptionStatus: 'active', subscriptionPlan: 'premium' });
    add('schoolYears', schoolYearId, { schoolId, name: '2098-2099', status: 'active', currency, startsAt: '2098-09-01', endsAt: '2099-07-31' });
  }
  for (const [i, id] of [student, tag + '-unpaid'].entries()) add('students', id, { schoolId: schools[0], schoolYearId: year, nom: i ? 'IMPAYE' : 'SOCIAL', postnom: 'FICTIF', prenom: 'Recette', matricule: `E2E-${i}`, className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', sexe: 'F', birthDate: '2090-01-01' });
  add('feeTypes', fee, { schoolId: schools[0], schoolYearId: year, name: 'Minerval', amount: 300, className: '1ère Primaire' });
  add('correspondences', tag + '-letter', { schoolId: schools[0], schoolYearId: year, status: 'draft', subject: 'Recette fictive PDF' });
  for (const u of users) add('users', u.uid, { role: u.role, schoolId: u.schoolId, name: 'Compte fictif ' + u.role, email: u.email, active: true, status: 'active', activeSchoolYearId: year,
    ...(navigationRecipe(recipe) ? {sectionIds: recipe === 'pr46pr47' && u.role === 'study_director' ? ['Primaire', 'Secondaire'] : ['Primaire']} : {}),
    ...(u.coordinationId ? {coordinationId:u.coordinationId} : {}), ...(u.subCoordinationId ? {subCoordinationId:u.subCoordinationId} : {}) });
  if (navigationRecipe(recipe)) {
    const coordinationId=tag+'-coordination',subCoordinationId=tag+'-subcoordination';
    add('coordinations',coordinationId,{name:'Coordination fictive navigation',code:'FICTIF',status:'active',referenceSchoolYear:'2098-2099',principalCoordinatorUserId:tag+'-coordination_admin'});
    add('subCoordinations',subCoordinationId,{coordinationId,coordinatorUserId:tag+'-sub_coordination_admin',active:true,status:'active',circumscription:'Fictif'});
    add('coordinationSchools',coordinationId+'__'+schools[0],{coordinationId,schoolId:schools[0],active:true,addedAt:new Date().toISOString()});
    add('subCoordinationSchools',subCoordinationId+'__'+schools[0],{coordinationId,subCoordinationId,schoolId:schools[0],active:true});
    documents.find(row=>row.path==='schools/'+schools[0]).data.activeCoordinationId=coordinationId;
    add('classes', tag+'-class', {schoolId:schools[0],schoolYearId:year,name:'1ère Primaire',section:'Primaire',active:true});
    for (const suffix of ['A','B']) add('classes', tag+'-class-'+suffix, {schoolId:schools[0],schoolYearId:year,name:'1ère Primaire',section:'Primaire',active:true,parentClassId:tag+'-class',subClassLabel:suffix});
    add('classes', tag+'-empty', {schoolId:schools[0],schoolYearId:year,name:'2ème Primaire',section:'Primaire',active:true});
    add('parents', tag+'-parent', {schoolId:schools[0],schoolYearId:year,fullName:'Émilie Parent Fictif',phone:'+243000000001',email:'parent@example.invalid',studentIds:[student],status:'active'});
    if (recipe === 'pr46pr47') {
      add('parents', tag+'-parent-alt', {schoolId:schools[0],schoolYearId:year,fullName:'Basile Parent Fictif',phone:'+243000000002',email:'parent-alt@example.invalid',studentIds:[],status:'active'});
      add('parents', tag+'-parent-foreign', {schoolId:schools[1],fullName:'Parent Étranger Fictif',phone:'+243000000003',email:'parent-foreign@example.invalid',studentIds:[],status:'active'});
      add('students', tag+'-student-foreign', {schoolId:schools[1],schoolYearId:tag+'-other-year',nom:'ÉTRANGER',postnom:'FICTIF',prenom:'Recette',matricule:'E2E-FOREIGN',className:'1ère Primaire',section:'Primaire',status:'ACTIVE',sexe:'M',birthDate:'2090-01-01'});
      for (const [suffix, option] of [['commercial', 'Commerciale'], ['sciences', 'Sciences']])
        add('students', tag+'-student-'+suffix, {schoolId:schools[0],schoolYearId:year,
          nom:suffix.toUpperCase(),postnom:'FICTIF',prenom:'Recette',matricule:'E2E-'+suffix.toUpperCase(),
          className:'3ème Humanité',section:'Secondaire',option,status:'ACTIVE',sexe:'F',birthDate:'2090-01-01'});
      add('classes', tag+'-class-foreign', {schoolId:schools[1],schoolYearId:tag+'-other-year',name:'1ère Primaire',section:'Primaire',active:true});
      add('feeTypes', tag+'-fee-foreign', {schoolId:schools[1],schoolYearId:tag+'-other-year',name:'Minerval CDF',amount:1500000,className:'1ère Primaire'});
      const today = new Date().toISOString().slice(0, 10);
      add('payments', tag+'-payment-usd', {schoolId:schools[0],schoolYearId:year,studentId:student,feeTypeId:fee,
        amount:120,currency:'USD',paidAt:today,createdAt:new Date().toISOString(),cashierName:'Caissier fictif E2E',
        cashierId:tag+'-cashier',receiptNumber:'E2E-USD-'+tag,active:true,status:'active'});
      add('payments', tag+'-payment-cdf', {schoolId:schools[1],schoolYearId:tag+'-other-year',studentId:tag+'-student-foreign',
        feeTypeId:tag+'-fee-foreign',amount:500000,currency:'CDF',paidAt:today,createdAt:new Date().toISOString(),
        cashierName:'Caissier fictif E2E',receiptNumber:'E2E-CDF-'+tag,active:true,status:'active'});
      add('coordinationSchools', coordinationId+'__'+schools[1], {coordinationId,schoolId:schools[1],active:true,addedAt:new Date().toISOString()});
      add('subCoordinationSchools', subCoordinationId+'__'+schools[1], {coordinationId,subCoordinationId,schoolId:schools[1],active:true});
      documents.find(row=>row.path==='schools/'+schools[1]).data.activeCoordinationId=coordinationId;
    }
    for (const row of documents.filter(row=>row.path.startsWith('students/') && row.data.schoolId===schools[0] && row.data.section==='Primaire'))
      Object.assign(row.data,{classId:tag+'-class',subClassId:tag+'-class-A',parentId:tag+'-parent'});
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
  const extra = navigationRecipe(m.recipe) ? [`coordinations/${m.tag}-coordination`,`subCoordinations/${m.tag}-subcoordination`,`coordinationSchools/${m.tag}-coordination__${m.schools[0]}`,`subCoordinationSchools/${m.tag}-subcoordination__${m.schools[0]}`,
    ...(m.recipe === 'pr46pr47' ? [`coordinationSchools/${m.tag}-coordination__${m.schools[1]}`,`subCoordinationSchools/${m.tag}-subcoordination__${m.schools[1]}`] : [])] : [];
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
  if (m.recipe === 'pr46pr47') {
    for (const entry of m.uiEnrollments ?? []) {
      const found = await findEnrollment(s, entry);
      if (found.length > 1 || (entry.path && (found.length !== 1 || found[0].ref.path !== entry.path))) throw Error('Inscription UI ambiguë : clôture suspendue.');
      if (!found.length) continue; // The form may have failed before creating a pupil.
      const doc = found[0];
      const data = doc.data();
      if (data.fixtureId && data.fixtureId !== m.tag) throw Error('Inscription UI étrangère : clôture suspendue.');
      if (data.id !== doc.id) throw Error('Inscription UI incohérente : clôture suspendue.');
      await doc.ref.update({ fixtureId: m.tag, active: false, status: 'ARCHIVED', fixtureLifecycle: 'retired' }, { lastUpdateTime: doc.updateTime });
      entry.path = doc.ref.path;
      saveManifest(m);
    }
    for (const row of m.documents) {
      if (!/^(students|parents|classes|feeTypes|schoolYears|correspondences|payments)\//.test(row.path)) continue;
      const snapshot = await s.db.doc(row.path).get();
      if (!snapshot.exists) continue; // Une préparation partielle reste clôturable.
      if (!snapshot.id.startsWith(m.tag) || snapshot.data().fixtureId !== m.tag || snapshot.data().id !== snapshot.id) throw Error('Résidu étranger : clôture suspendue.');
      const collection = row.path.split('/')[0];
      await snapshot.ref.update({ active: false, fixtureLifecycle: 'retired', ...(collection === 'students' ? { status: 'ARCHIVED' } : { status: 'inactive' }) }, { lastUpdateTime: snapshot.updateTime });
    }
  }
  m.retired = true; m.retained = true; m.deleted = false; m.closedAt = new Date().toISOString(); saveManifest(m);
}
