import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { guard as baseGuard, services as baseServices } from './socialFinanceStagingFixture.mjs';

export const projectId = 'acadea-staging';
export const manifestPath = 'diagnostics/seven-amendments-staging/manifest.json';
const output = 'diagnostics/seven-amendments-staging';
const roles = [
  ['admin', 'school_admin', 'a'], ['cashier', 'cashier', 'a'],
  ['empty_admin', 'school_admin', 'c'], ['coordination', 'coordination_admin', ''],
  ['sub_coordination', 'sub_coordination_admin', ''], ['platform', 'super_admin', ''],
  ['teacher', 'teacher', 'a'],
];

export function guard() {
  baseGuard();
  if (process.env.ACADEA_SEVEN_STAGING !== 'YES'
    || process.env.GOOGLE_CLOUD_PROJECT !== projectId
    || process.env.GOOGLE_CLOUD_QUOTA_PROJECT !== projectId
    || !/^[a-f0-9]{40}$/.test(process.env.ACADEA_EXPECTED_SHA ?? '')) {
    throw Error('Recette des sept amendements réservée à acadea-staging et au SHA explicite.');
  }
}

export function services() { guard(); return baseServices(); }

export function validateManifest(m) {
  if (m?.projectId !== projectId || !/^e2e-seven-[a-f0-9]{32}$/.test(m.tag)
    || JSON.stringify(m.schools) !== JSON.stringify(['a', 'b', 'c', 'd'].map(suffix => `${m.tag}-${suffix}`))
    || !Array.isArray(m.users) || m.users.length !== roles.length
    || m.users.some((u, index) => u.key !== roles[index][0] || u.role !== roles[index][1]
      || u.uid !== `${m.tag}-${u.key}` || u.email !== `${m.tag}-${u.key}@example.invalid`
      || u.schoolId !== (roles[index][2] ? `${m.tag}-${roles[index][2]}` : ''))
    || !Array.isArray(m.documents) || m.documents.some(row => !/^[A-Za-z][\w]*\/e2e-seven-[a-f0-9]{32}[-_\w]*$/.test(row.path)
      || row.data?.fixtureId !== m.tag || row.data?.id !== row.path.split('/')[1])) {
    throw Error('Manifeste de fixture ambigu : clôture refusée.');
  }
}

export function saveManifest(m) {
  validateManifest(m);
  mkdirSync(output, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2), { mode: 0o600 });
}

export async function prepare(s) {
  guard();
  if (existsSync(manifestPath) && !JSON.parse(readFileSync(manifestPath, 'utf8')).retired) throw Error('Fixture précédente non clôturée.');
  const tag = `e2e-seven-${randomUUID().replaceAll('-', '')}`;
  const schools = ['a', 'b', 'c', 'd'].map(suffix => `${tag}-${suffix}`);
  const [schoolUsd, schoolCdf, schoolEmpty, schoolForeign] = schools;
  const year = suffix => `${tag}-${suffix}-year`;
  const oldYear = suffix => `${tag}-${suffix}-old-year`;
  const coordinationId = `${tag}-coordination`, subCoordinationId = `${tag}-subcoordination`;
  // L'API compare la date au jour UTC de son horloge serveur.
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4));
  const academicStart = Number(today.slice(5, 7)) >= 9 ? currentYear : currentYear - 1;
  const users = roles.map(([key, role, suffix]) => ({ key, role, uid: `${tag}-${key}`,
    email: `${tag}-${key}@example.invalid`, schoolId: suffix ? `${tag}-${suffix}` : '',
    ...(role.includes('coordination_admin') ? { coordinationId } : {}),
    ...(role === 'sub_coordination_admin' ? { subCoordinationId } : {}) }));
  const documents = [];
  const add = (collection, id, fields) => documents.push({ path: `${collection}/${id}`, data: { id, fixtureId: tag, ...fields } });

  for (const [index, id] of schools.entries()) {
    const suffix = ['a', 'b', 'c', 'd'][index];
    const currency = index === 1 || index === 3 ? 'CDF' : 'USD';
    const relation = index === 3 ? `${tag}-foreign-coordination` : coordinationId;
    add('schools', id, { name: `École fictive PR48 ${suffix.toUpperCase()}`, status: 'active', active: true, currency,
      schoolType: 'Primaire uniquement', educationLevels: ['Primaire'], schoolOptions: [],
      activeSchoolYearId: year(suffix), activeCoordinationId: relation,
      subscriptionStatus: 'active', subscriptionPlan: 'premium' });
    add('schoolYears', year(suffix), { schoolId: id, name: `${academicStart}-${academicStart + 1}`,
      status: 'active', currency, startsAt: `${academicStart}-09-01`, endsAt: `${academicStart + 1}-07-31` });
    add('classes', `${tag}-${suffix}-class`, { schoolId: id, schoolYearId: year(suffix), name: '1ère Primaire',
      section: 'Primaire', active: true });
    add('coordinationSchools', `${relation}__${id}`, { coordinationId: relation, schoolId: id, active: true,
      addedAt: new Date().toISOString() });
    if (index < 3) add('subCoordinationSchools', `${subCoordinationId}__${id}`, { coordinationId, subCoordinationId,
      schoolId: id, active: true });
  }
  add('coordinations', coordinationId, { name: 'Coordination fictive PR48', code: 'E2E48', status: 'active',
    active: true, referenceSchoolYear: `${academicStart}-${academicStart + 1}`, principalCoordinatorUserId: `${tag}-coordination` });
  add('coordinations', `${tag}-foreign-coordination`, { name: 'Coordination étrangère fictive PR48', code: 'E2E48X', status: 'active', active: true });
  add('subCoordinations', subCoordinationId, { coordinationId, coordinatorUserId: `${tag}-sub_coordination`,
    circumscription: 'Zone fictive PR48', status: 'active', active: true });
  for (const [suffix, currency] of [['a', 'USD'], ['b', 'CDF']]) {
    const schoolId = suffix === 'a' ? schoolUsd : schoolCdf;
    add('schoolYears', oldYear(suffix), { schoolId, name: `${academicStart - 1}-${academicStart}`,
      status: 'archived', currency, startsAt: `${academicStart - 1}-09-01`, endsAt: `${academicStart}-07-31` });
    add('students', `${tag}-${suffix}-student`, { schoolId, schoolYearId: year(suffix),
      nom: `FICTIF-${suffix.toUpperCase()}`, postnom: 'RECETTE', prenom: 'Acadéa', matricule: `${tag}-${suffix}-M`,
      className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', sexe: 'F', birthDate: '2016-01-01',
      importedFromStudentId: `${tag}-${suffix}-old-student` });
    add('students', `${tag}-${suffix}-old-student`, { schoolId, schoolYearId: oldYear(suffix),
      nom: `FICTIF-${suffix.toUpperCase()}`, postnom: 'RECETTE', prenom: 'Acadéa', matricule: `${tag}-${suffix}-M`,
      className: '1ère Primaire', section: 'Primaire', status: 'ARCHIVED', sexe: 'F', birthDate: '2016-01-01' });
    add('feeTypes', `${tag}-${suffix}-fee`, { schoolId, schoolYearId: year(suffix), name: 'Minerval',
      amount: currency === 'USD' ? 300 : 30000, className: '1ère Primaire' });
    add('feeTypes', `${tag}-${suffix}-old-fee`, { schoolId, schoolYearId: oldYear(suffix), name: 'Minerval',
      amount: currency === 'USD' ? 100 : 10000, className: '1ère Primaire' });
  }
  add('students', `${tag}-a-other-student`, { schoolId: schoolUsd, schoolYearId: year('a'),
    nom: 'AUTRE-FICTIF', postnom: 'RECETTE', prenom: 'Acadéa', matricule: `${tag}-a-other-M`,
    className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', sexe: 'F', birthDate: '2016-01-01' });
  add('students', `${tag}-foreign-student`, { schoolId: schoolForeign, schoolYearId: year('d'),
    nom: 'HORS-PERIMETRE', postnom: 'FICTIF', prenom: 'Acadéa', matricule: `${tag}-foreign-M`,
    className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', sexe: 'F', birthDate: '2016-01-01' });
  add('payments', `${tag}-old-payment`, { schoolId: schoolUsd, schoolYearId: oldYear('a'),
    collectionSchoolYearId: year('a'), studentId: `${tag}-a-old-student`, currentStudentId: `${tag}-a-student`,
    feeTypeId: `${tag}-a-old-fee`, feeName: 'Minerval', debtSchoolYearName: `${academicStart - 1}-${academicStart}`,
    amount: 20, currency: 'USD', paidAt: today, createdAt: `${today}T10:00:00Z`,
    cashierId: `${tag}-cashier`, cashierName: 'Caissier fictif PR48', receiptNumber: `${tag}-receipt` });
  add('cashInflows', `${tag}-legacy-inflow`, { schoolId: schoolUsd, schoolYearId: year('a'),
    category: 'Frais de fonctionnement', amount: 1, currency: 'USD', entryDate: today,
    source: 'Archive fictive', paymentMethod: 'Espèces', description: 'Ancienne catégorie fictive PR48',
    createdAt: `${today}T10:00:00Z`, validatedAt: `${today}T10:00:00Z`,
    cashierName: 'Caissier fictif PR48', provenance: 'financial-api', clientRequestIdHash: tag });
  for (const u of users) add('users', u.uid, { role: u.role, schoolId: u.schoolId,
    name: `Compte fictif PR48 ${u.key}`, email: u.email, active: true, status: 'active',
    activeSchoolYearId: u.schoolId ? `${u.schoolId}-year` : '',
    ...(u.coordinationId ? { coordinationId: u.coordinationId } : {}),
    ...(u.subCoordinationId ? { subCoordinationId: u.subCoordinationId } : {}) });

  const m = { projectId, tag, schools, users, documents, today, years: { a: year('a'), b: year('b'), c: year('c'), d: year('d') },
    students: { a: `${tag}-a-student`, aOther: `${tag}-a-other-student`, b: `${tag}-b-student`, foreign: `${tag}-foreign-student` },
    fees: { a: `${tag}-a-fee`, b: `${tag}-b-fee` }, coordinationId, subCoordinationId,
    createdAt: new Date().toISOString(), retired: false };
  validateManifest(m);
  for (const row of documents) if ((await s.db.doc(row.path).get()).exists) throw Error(`Collision de document ${row.path}`);
  for (const u of users) {
    try { await s.auth.getUser(u.uid); throw Error('Collision de compte Auth.'); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  }
  saveManifest(m); // Plan durable sans mot de passe ni jeton AVANT la première écriture.
  const password = `Ephemeral-${randomUUID()}${randomUUID()}`;
  for (const row of documents) await s.db.doc(row.path).create(row.data);
  for (const u of users) {
    await s.auth.createUser({ uid: u.uid, email: u.email, password });
    await s.auth.setCustomUserClaims(u.uid, { role: u.role,
      ...(u.schoolId ? { schoolId: u.schoolId } : {}),
      ...(u.coordinationId ? { coordinationId: u.coordinationId } : {}),
      ...(u.subCoordinationId ? { subCoordinationId: u.subCoordinationId } : {}) });
  }
  return { m, password };
}

export async function retire(s) {
  guard();
  if (!existsSync(manifestPath)) return;
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateManifest(m);
  const paths = m.documents.filter(row => /^(schools|users|coordinations|subCoordinations|coordinationSchools|subCoordinationSchools)\//.test(row.path));
  const snapshots = [];
  for (const row of paths) {
    const snapshot = await s.db.doc(row.path).get();
    if (snapshot.exists) {
      if (snapshot.data().fixtureId !== m.tag || snapshot.data().id !== snapshot.id) throw Error('Document étranger : clôture refusée.');
      snapshots.push(snapshot);
    }
  }
  const accounts = [];
  for (const u of m.users) {
    try { const account = await s.auth.getUser(u.uid); if (account.email !== u.email) throw Error('Compte étranger.'); accounts.push(account); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  }
  for (const snapshot of snapshots) await snapshot.ref.update({ active: false, status: 'inactive', fixtureLifecycle: 'retired' }, { lastUpdateTime: snapshot.updateTime });
  for (const account of accounts) {
    await s.auth.updateUser(account.uid, { disabled: true });
    await s.auth.setCustomUserClaims(account.uid, {});
    await s.auth.revokeRefreshTokens(account.uid);
    const check = await s.auth.getUser(account.uid);
    if (!check.disabled || Object.keys(check.customClaims ?? {}).length) throw Error('Clôture Auth non confirmée.');
  }
  for (const snapshot of snapshots) if ((await snapshot.ref.get()).data().active !== false) throw Error('Clôture Firestore non confirmée.');
  m.retired = true; m.retained = true; m.deleted = false; m.closedAt = new Date().toISOString(); saveManifest(m);
}
