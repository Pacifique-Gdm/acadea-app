import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect as baseExpect } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { fileURLToPath } from 'node:url';
import { services } from './socialFinanceStagingFixture.mjs';
import { feeAllocationAnchorId } from '../api/_lib/feeAllocationReceipts.js';
import { validateFeeAllocationRubrics } from '../api/_lib/feeAllocationMath.js';
import { runHostedAllocationVolume } from './feeAllocationHostedVolume.mjs';
import { runHostedAllocationPanel } from './feeAllocationHostedPanel.mjs';
import { guardedRoute, redactRecipeError } from './hostedRecipeSafety.mjs';
// A mutation is followed by authenticated workspace + activation reads. Match
// the hosted response budget, not Playwright's unrelated five-second default.
const expect = baseExpect.configure({ timeout: 45000 });

const origin = 'https://acadea-staging.vercel.app', expectedSha = process.env.ACADEA_EXPECTED_SHA;
const panelOnly = process.env.ACADEA_ALLOCATION_RECIPE === 'panel-only';
const volumeOnly = process.env.ACADEA_ALLOCATION_RECIPE === 'volume' || panelOnly;
const panelRecipe = process.env.ACADEA_ALLOCATION_RECIPE === 'panel' || panelOnly;
assert.ok(!process.env.ACADEA_ALLOCATION_RECIPE || volumeOnly || panelRecipe, 'Parcours de recette inconnu');
const output = `diagnostics/fee-allocation-hosted/${expectedSha}${volumeOnly ? `-volume-${Date.now()}` : ''}`;
const manifestPath = 'diagnostics/fee-allocation-hosted/manifest.json';
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'acadea-staging');
assert.equal(process.env.GOOGLE_CLOUD_QUOTA_PROJECT, 'acadea-staging');
assert.equal(process.env.ACADEA_ALLOCATION_STAGING, 'YES');
assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/);
assert.ok(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
const version = await fetch(`${origin}/version.json`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
assert.equal(version.status, 200, 'Preview protégé/inaccessible : aucune fixture créée.');
assert.equal((await version.json()).version, expectedSha, 'SHA hébergé différent : aucune fixture créée.');
console.log('Précontrôle : SHA Staging confirmé.');
const html = await (await fetch(origin, { signal: AbortSignal.timeout(30000) })).text(), asset = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(asset);
const bundle = await (await fetch(origin + asset, { signal: AbortSignal.timeout(30000) })).text();
assert.match(bundle, /projectId\s*:\s*["']acadea-staging["']/);
assert.ok(!/projectId\s*:\s*["']acadea-production["']/.test(bundle));
console.log('Précontrôle : bundle Firebase exclusivement Staging.');
async function googleRead(path) {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${process.env.ACADEA_STAGING_ACCESS_TOKEN}`,
    'x-goog-user-project': 'acadea-staging' }, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, 'Précontrôle règles/index indisponible : aucune fixture créée.');
  return response.json();
}
const release = await googleRead('https://firebaserules.googleapis.com/v1/projects/acadea-staging/releases/cloud.firestore');
assert.ok(release.rulesetName.startsWith('projects/acadea-staging/rulesets/'));
const rules = await googleRead('https://firebaserules.googleapis.com/v1/' + release.rulesetName);
const canonicalRules = value => value.replaceAll('\r\n', '\n').trim();
assert.equal(canonicalRules(rules.source.files.find(f => f.name === 'firestore.rules').content), canonicalRules(readFileSync('firestore.rules', 'utf8')), 'Règles candidates non actives');
const indexes = await googleRead('https://firestore.googleapis.com/v1/projects/acadea-staging/databases/(default)/collectionGroups/feeAllocationConfigs/indexes');
assert.ok(indexes.indexes?.some(i => i.state === 'READY' && ['schoolId', 'schoolYearId'].every(key => i.fields.some(f => f.fieldPath === key))), 'Index de configuration non prêt');
const ledgerIndexes = await googleRead('https://firestore.googleapis.com/v1/projects/acadea-staging/databases/(default)/collectionGroups/feeAllocationMovements/indexes');
assert.ok(ledgerIndexes.indexes?.some(i => i.state === 'READY' && ['schoolId', 'collectionSchoolYearId', 'currency'].every(key => i.fields.some(f => f.fieldPath === key))), 'Index de pagination non prêt : aucune fixture créée');
console.log('Précontrôle : règles et index conformes.');
if (existsSync(manifestPath)) {
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(previous.retired, true, 'Fixture précédente à clôturer.');
  mkdirSync('diagnostics/fee-allocation-hosted/archive', { recursive: true });
  assert.match(previous.tag, /^e2e-allocation-[a-f0-9]{32}$/);
  writeFileSync(`diagnostics/fee-allocation-hosted/archive/${previous.tag}.json`, JSON.stringify(previous, null, 2));
}
mkdirSync(output, { recursive: true });
const results = [{ name: 'SHA, projet Firebase, règles exactes et index READY avant fixture', result: 'PASS', ruleset: release.rulesetName }];
// The caller supplies an official short-lived OAuth credential, never a key file.
const s = services();
const tag = `e2e-allocation-${randomUUID().replaceAll('-', '')}`;
const school = `${tag}-a`, foreign = `${tag}-b`, year = `${tag}-year`, fee = `${tag}-fee`, student = `${tag}-student`;
const inactiveSchool = `${tag}-inactive`, inactiveYear = `${tag}-inactive-year`;
const volumeSchool = `${tag}-volume`, volumeYear = `${tag}-volume-year`;
const coord = `${tag}-coord`, sub = `${tag}-sub`;
const roles = ['school_admin', 'cashier', 'coordination_admin', 'sub_coordination_admin', 'teacher'];
const users = roles.map(role => ({ role, uid: `${tag}-${role}`, email: `${tag}-${role}@example.invalid` }));
users.push(...[['cdf-admin', 'school_admin'], ['cdf-cashier', 'cashier']].map(([key, role]) => ({ key, role, uid: `${tag}-${key}`, email: `${tag}-${key}@example.invalid`, schoolId: foreign })));
users.push(...[['inactive-admin', 'school_admin'], ['inactive-cashier', 'cashier']].map(([key, role]) => ({ key, role, uid: `${tag}-${key}`, email: `${tag}-${key}@example.invalid`, schoolId: inactiveSchool })));
users.push(...[['volume-admin', 'school_admin'], ['volume-cashier', 'cashier']].map(([key, role]) => ({ key, role, uid: `${tag}-${key}`, email: `${tag}-${key}@example.invalid`, schoolId: volumeSchool })));
if (volumeOnly) users.splice(0, users.length, ...users.filter(u => u.schoolId === volumeSchool));
const manifest = { projectId: 'acadea-staging', tag, sha: expectedSha, schools: volumeOnly ? [volumeSchool] : [school, foreign, inactiveSchool, volumeSchool], users, paths: [], retired: false, createdAt: new Date().toISOString() };
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
save(); // Durable identity-only inventory before the first write. No password/token.
const password = `Fictif-${randomUUID()}${randomUUID()}`;
let browser, pdfOcr;
const tokens = new Map();
const safeError = error => redactRecipeError(error, [password, ...tokens.values()]);
const checkpoint = () => writeFileSync(`${output}/results.json`, JSON.stringify({ projectId: 'acadea-staging', expectedSha, results }, null, 2));
const record = name => { results.push({ name, result: 'PASS' }); checkpoint(); console.log(`PASS: ${name}`); };
async function put(collection, id, data) {
  assert.ok(id.startsWith(tag));
  const path = `${collection}/${id}`;
  assert.equal((await s.db.doc(path).get()).exists, false, 'Collision fixture.');
  manifest.paths.push(path); save();
  const ref = s.db.doc(path);
  const created = await ref.create({ ...data, id, fixtureId: tag });
  if (collection === 'students' && data.createdAt) {
    // A workstation clock can run ahead of the hosted financial API. Synthetic
    // new obligations use Firestore's actual creation instant, not that clock.
    // Historical inputs without createdAt remain deliberately undated.
    await ref.update({ createdAt: created.writeTime.toDate().toISOString() }, { lastUpdateTime: created.writeTime });
  }
}
async function ownUpdate(collection, id, data) {
  const ref = s.db.doc(`${collection}/${id}`), snap = await ref.get();
  assert.equal(snap.data()?.fixtureId, tag); assert.ok(id.startsWith(tag));
  await ref.update(data, { lastUpdateTime: snap.updateTime });
}
async function fixtureAnchor(source, data) {
  assert.equal(source.schoolId, school); assert.ok(source.studentId.startsWith(tag)); assert.ok(source.feeTypeId.startsWith(tag));
  const id = feeAllocationAnchorId(source), path = `feeAllocationAnchors/${id}`;
  assert.equal((await s.db.doc(path).get()).exists, false);
  manifest.paths.push(path); save();
  await s.db.doc(path).create({ ...data, id, fixtureId: tag });
}
async function api(role, body, status = 200) {
  const response = await fetch(`${origin}/api/manage-financial-transaction`, { method: 'POST',
    headers: { Authorization: tokens.get(role), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  assert.equal(response.status, status, `${body.action}: HTTP ${response.status}, code ${data.code ?? 'inconnu'} (${String(data.error ?? '').slice(0, 200)})`);
  return data;
}
const requestId = () => randomUUID();
const allocation = (action, body = {}, role = 'school_admin', status = 200) => api(role, { action: `fee-allocation.${action}`, requestId: requestId(), ...body }, status);
async function reconcile(role = 'school_admin') {
  let { run } = await allocation('start-reconciliation', {}, role);
  while (run.status === 'RUNNING') ({ run } = await api(role, { action: 'fee-allocation.advance-reconciliation', runId: run.id, sequence: run.sequence }));
  assert.equal(run.status, 'COMPLETE', 'Rapprochement hébergé incomplet'); return run;
}
async function retire() {
  assert.equal(manifest.projectId, 'acadea-staging'); assert.match(tag, /^e2e-allocation-[a-f0-9]{32}$/);
  for (const u of users) {
    let account; try { account = await s.auth.getUser(u.uid); } catch (e) { if (e.code === 'auth/user-not-found') continue; throw e; }
    assert.equal(account.email, u.email);
    await s.auth.updateUser(u.uid, { disabled: true }); await s.auth.setCustomUserClaims(u.uid, {}); await s.auth.revokeRefreshTokens(u.uid);
    const check = await s.auth.getUser(u.uid); assert.equal(check.disabled, true); assert.equal(Object.keys(check.customClaims ?? {}).length, 0);
  }
  for (const path of manifest.paths.filter(p => /^(schools|users|coordinations|subCoordinations|coordinationSchools|subCoordinationSchools|feeAllocationTestScopes)\//.test(p))) {
    const ref = s.db.doc(path), snap = await ref.get(); if (!snap.exists) continue;
    assert.equal(snap.data().fixtureId, tag); assert.equal(snap.data().id, snap.id);
    await ref.update({ active: false, status: 'inactive', fixtureLifecycle: 'retired' }, { lastUpdateTime: snap.updateTime });
    assert.equal((await ref.get()).data().active, false);
  }
  for (const u of users.slice(0, 4)) {
    const tokenKey = u.key ?? u.role;
    if (!tokens.has(tokenKey)) continue;
    const response = await fetch(`${origin}/api/manage-financial-transaction`, { method: 'POST', headers: {
      Authorization: tokens.get(tokenKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fee-allocation.get-workspace', schoolId: u.schoolId ?? school }), signal: AbortSignal.timeout(30000) });
    assert.ok([401, 403].includes(response.status), 'Compte fictif encore autorisé après neutralisation');
  }
  const retained = {};
  for (const collection of ['payments', 'expenses', 'personnelPayments', 'feeAllocationStates', 'feeAllocationConfigs', 'feeAllocationVersions', 'feeAllocationOpeningAudits', 'feeAllocationBalances', 'feeAllocationMovements', 'feeAllocationRequests', 'feeAllocationAnchors', 'financialIdempotency', 'financialCounters', 'financialCashLocks', 'auditLogs', 'socialSupportDecisions', 'socialSupportRequests', 'socialSupportAudit', 'socialSupportFeeLocks', 'feeAllocationReconciliationRuns', 'feeAllocationHistoricalProofs', 'feeAllocationHistoricalDecisions', 'feeAllocationEvidenceClaims', 'feeAllocationEvidenceRevisions']) {
    retained[collection] = [];
    for (const sid of manifest.schools) retained[collection].push(...(await s.db.collection(collection).where('schoolId', '==', sid).get()).docs.map(d => ({ schoolId: sid, id: d.id })));
  }
  retained.openingEvidencePages = [];
  retained.reconciliationDocuments = [];
  for (const run of retained.feeAllocationReconciliationRuns) for (const collection of ['pages', 'versions']) {
    const docs = await s.db.collection(`feeAllocationReconciliationRuns/${run.id}/${collection}`).get();
    for (const doc of docs.docs) {
      assert.ok(manifest.schools.includes(doc.data().schoolId));
      retained.reconciliationDocuments.push({ schoolId: doc.data().schoolId, path: doc.ref.path });
    }
  }
  for (const audit of retained.feeAllocationOpeningAudits) {
    const pages = await s.db.collection(`feeAllocationOpeningAudits/${audit.id}/evidencePages`).get();
    for (const doc of pages.docs) {
      assert.ok(manifest.schools.includes(doc.data().schoolId));
      retained.openingEvidencePages.push({ schoolId: doc.data().schoolId, path: doc.ref.path });
    }
  }
  manifest.retired = true; manifest.deleted = false; manifest.retained = retained; manifest.closedAt = new Date().toISOString(); save();
  record('Clôture : comptes désactivés, sessions révoquées, écoles neutralisées, registre fictif inventorié sans suppression');
}
try {
  const createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  await put('feeAllocationTestScopes', tag, { projectId: 'acadea-staging', schoolIds: manifest.schools, status: 'active', createdAt, expiresAt });
  const fixtureYear = sid => sid === school ? year : sid === foreign ? `${tag}-foreign-year` : sid === volumeSchool ? volumeYear : inactiveYear;
  for (const [sid, currency] of [[school, 'USD'], [foreign, 'CDF'], [inactiveSchool, 'USD'], [volumeSchool, 'USD']]) {
    if (!manifest.schools.includes(sid)) continue;
    await put('schools', sid, { name: `Répartition fictive ${currency}`, status: 'active', active: true, currency, activeSchoolYearId: fixtureYear(sid),
      schoolType: 'Primaire uniquement', educationLevels: ['Primaire'], schoolOptions: [], subscriptionStatus: 'active', subscriptionPlan: 'premium', ...(sid === school ? { activeCoordinationId: coord } : {}) });
    await put('schoolYears', fixtureYear(sid), { schoolId: sid, status: 'active', currency, name: '2026-2027', startsAt: '2026-09-01', endsAt: '2027-07-31' });
  }
  if (!volumeOnly) {
  await put('coordinations', coord, { name: 'Coordination fictive répartition', status: 'active', principalCoordinatorUserId: users[2].uid, referenceSchoolYear: '2026-2027' });
  await put('subCoordinations', sub, { name: 'Sous-coordination fictive', status: 'active', active: true, coordinationId: coord, coordinatorUserId: users[3].uid });
  await put('coordinationSchools', `${coord}__${school}`, { schoolId: school, coordinationId: coord, active: true });
  await put('subCoordinationSchools', `${sub}__${school}`, { schoolId: school, coordinationId: coord, subCoordinationId: sub, active: true });
  }
  for (const u of users) {
    const scope = u.role.includes('coordination') ? { coordinationId: coord, ...(u.role === 'sub_coordination_admin' ? { subCoordinationId: sub } : {}) } : { schoolId: u.schoolId ?? school };
    await put('users', u.uid, { role: u.role, ...scope, schoolId: scope.schoolId ?? '', name: `Compte fictif ${u.role}`, email: u.email, active: true, status: 'active', activeSchoolYearId: fixtureYear(u.schoolId ?? school) });
    await s.auth.createUser({ uid: u.uid, email: u.email, password }); await s.auth.setCustomUserClaims(u.uid, { role: u.role, ...scope });
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.STAGING_FIREBASE_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password, returnSecureToken: true }) });
    assert.equal(response.status, 200, 'Authentification Firebase officielle refusée'); tokens.set(u.key ?? u.role, `Bearer ${(await response.json()).idToken}`);
  }
  if (!volumeOnly) {
  const inactiveFee = `${tag}-inactive-fee`, inactiveStudent = `${tag}-inactive-student`;
  await put('classes', `${tag}-inactive-class`, { schoolId: inactiveSchool, schoolYearId: inactiveYear, name: '1ère Primaire', section: 'Primaire', active: true });
  await put('feeTypes', inactiveFee, { schoolId: inactiveSchool, schoolYearId: inactiveYear, name: 'Frais fictif inactif', className: '1ère Primaire', amount: 100, createdAt });
  await put('students', inactiveStudent, { schoolId: inactiveSchool, schoolYearId: inactiveYear, nom: 'FICTIF INACTIF', className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', createdAt });
  const inactivePayment = { action: 'create-payment', schoolYearId: inactiveYear, studentId: inactiveStudent, feeTypeId: inactiveFee, amount: 25, clientRequestId: requestId() };
  await api('inactive-cashier', inactivePayment); assert.equal((await api('inactive-cashier', inactivePayment)).idempotent, true);
  await api('inactive-cashier', { action: 'create-expense', schoolYearId: inactiveYear, amount: 5, category: 'Fournitures', description: 'Circuit historique fictif', beneficiary: 'Fictif', paymentMethod: 'Espèces', clientRequestId: requestId() });
  assert.equal((await api('inactive-admin', { action: 'fee-allocation.get-workspace', schoolId: inactiveSchool })).ledger, null);
  assert.equal((await s.db.collection('feeAllocationMovements').where('schoolId', '==', inactiveSchool).get()).size, 0);
  record('Troisième école non activée : paiement, rejeu et dépense sans rubrique, aucun mouvement de répartition');
  await put('payments', `${tag}-unjustifiable-history`, { schoolId: inactiveSchool, schoolYearId: inactiveYear,
    amount: 2, currency: null, provenance: 'legacy-fixture', createdAt });
  let blockedRun = (await allocation('start-reconciliation', {}, 'inactive-admin')).run;
  while (blockedRun.status === 'RUNNING') blockedRun = (await api('inactive-admin', { action: 'fee-allocation.advance-reconciliation', runId: blockedRun.id, sequence: blockedRun.sequence })).run;
  assert.equal(blockedRun.status, 'BLOCKED');
  assert.equal((await allocation('justify-history', { collection: 'payments', sourceId: `${tag}-unjustifiable-history`, evidenceType: 'financialIdempotency',
    evidenceId: `${tag}-nonexistent-evidence`, reason: 'Absence volontaire de preuve vérifiable' }, 'inactive-admin')).decision, 'rejected');
  assert.equal((await api('inactive-admin', { action: 'fee-allocation.get-workspace', schoolId: inactiveSchool })).ledger, null);
  record('Historique non justifiable : refus explicite et école maintenue inactive, sans affectation automatique');
  await put('classes', `${tag}-class`, { schoolId: school, schoolYearId: year, name: '1ère Primaire', section: 'Primaire', active: true });
  await put('feeTypes', fee, { schoolId: school, schoolYearId: year, name: 'Minerval fictif', className: '1ère Primaire', amount: 100, createdAt });
  const rubrics = Array.from({ length: 20 }, (_, i) => ({ id: (i + 1).toString(16).padStart(32, '0'), name: `Rubrique fictive ${i + 1}`, mode: 'percent', basisPoints: 400 }));
  rubrics[0] = { id: rubrics[0].id, name: rubrics[0].name, mode: 'fixed', fixedMinor: 400 };
  await allocation('save-draft', { feeTypeId: fee, expectedRevision: 0, rubrics });
  const prepared = await allocation('prepare-version', { feeTypeId: fee, expectedRevision: 1 });
  await allocation('publish-configuration', { versionId: prepared.version.id });
  const secondFee = `${tag}-second-fee`, unallocatedFee = `${tag}-unallocated-fee`;
  await put('classes', `${tag}-second-class`, { schoolId: school, schoolYearId: year, name: '2ème Primaire', section: 'Primaire', active: true });
  await put('feeTypes', secondFee, { schoolId: school, schoolYearId: year, name: 'Minerval fictif', className: '2ème Primaire', amount: 200, createdAt });
  await put('feeTypes', unallocatedFee, { schoolId: school, schoolYearId: year, name: 'Frais sans répartition', className: '1ère Primaire', amount: 20, createdAt });
  await allocation('save-draft', { feeTypeId: secondFee, expectedRevision: 0, rubrics });
  const secondVersion = await allocation('prepare-version', { feeTypeId: secondFee, expectedRevision: 1 });
  await allocation('publish-configuration', { versionId: secondVersion.version.id });
  // A genuinely new obligation after publication, not an invented historical anchor.
  await new Promise(resolve => setTimeout(resolve, 1100));
  await put('students', student, { schoolId: school, schoolYearId: year, nom: 'FICTIF', postnom: 'REPARTITION', prenom: 'Recette', matricule: `${tag}-M`,
    sexe: 'F', birthDate: '2016-01-01', className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', createdAt: new Date().toISOString() });
  const historicalStudent = `${tag}-historical-student`;
  await put('students', historicalStudent, { schoolId: school, schoolYearId: year, nom: 'FICTIF', postnom: 'OUVERTURE', prenom: 'Recette',
    className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', createdAt: new Date().toISOString() });
  // The opening is proved by a real API receipt in the still-inactive fixture,
  // never by manufacturing a ledger balance with Admin credentials.
  await api('cashier', { action: 'create-payment', schoolYearId: year, studentId: historicalStudent, feeTypeId: fee, amount: 5, clientRequestId: requestId() });
  await reconcile();
  const p = await allocation('prepare-opening', { cashCountMinor: 500, lines: [{ rubricId: 'UNALLOCATED', amountMinor: 500 }], confirmation: 'RAPPROCHER LA CAISSE' });
  await allocation('approve-opening', { openingId: p.openingId, confirmation: 'APPROUVER LE RAPPROCHEMENT' });
  const activation = { openingId: p.openingId, confirmation: 'ACTIVER LA REPARTITION FICTIVE', requestId: requestId() };
  await allocation('activate', activation); assert.equal((await allocation('activate', activation)).idempotent, true);
  record('Configuration et activation fictive auditée/idempotente');
  const payment = { action: 'create-payment', schoolYearId: year, studentId: student, feeTypeId: fee, amount: 30, clientRequestId: requestId() };
  const concurrent = await Promise.all([api('cashier', payment), api('cashier', payment)]); assert.equal(concurrent.filter(r => r.idempotent).length, 1);
  for (const amount of [20, 50]) await api('cashier', { ...payment, amount, clientRequestId: requestId() });
  const expense = { action: 'create-expense', schoolYearId: year, amount: 1, category: 'Fournitures', description: 'Papier fictif', beneficiary: 'Fournisseur fictif', paymentMethod: 'Espèces', allocationRubricId: rubrics[0].id, clientRequestId: requestId() };
  await api('cashier', expense); assert.equal((await api('cashier', expense)).idempotent, true);
  for (const kind of ['salary', 'bonus']) {
    const body = { action: 'create-personnel-payment', schoolYearId: year, beneficiaryId: users[4].uid, kind, periodMonth: 11, periodYear: 2026,
      paidAt: new Date().toISOString().slice(0, 10), amount: kind === 'salary' ? 4 : 1, recoveries: [], deduction: kind === 'salary' ? 1 : 0,
      ...(kind === 'salary' ? { deductionReason: 'Retenue fictive' } : {}), cnss: kind === 'salary' ? 1 : 0, tax: kind === 'salary' ? 1 : 0,
      description: 'Paie fictive', allocationRubricId: rubrics[0].id, clientRequestId: requestId() };
    await api('cashier', body); assert.equal((await api('cashier', body)).idempotent, true);
  }
  const workspace = await api('school_admin', { action: 'fee-allocation.get-workspace', schoolId: school });
  const totals = workspace.ledger.balances.reduce((a, b) => ({ received: a.received + b.receivedMinor, spent: a.spent + b.spentMinor, available: a.available + b.availableMinor }), { received: 0, spent: 0, available: 0 });
  assert.deepEqual(totals, { received: 10000, spent: 300, available: 10200 });
  assert.equal(workspace.ledger.balances.reduce((n, b) => n + b.openingMinor, 0), 500);
  assert.equal(workspace.ledger.balances.find(b => b.rubricId === rubrics[0].id).availableMinor, 100);
  record('Encaissements 30+20+50, concurrence, dépense/salaire/prime uniques, registre exactement rapproché');
  await api('cashier', { ...expense, amount: 2, clientRequestId: requestId() }, 409);
  await api('cashier', { ...expense, allocationRubricId: 'f'.repeat(32), clientRequestId: requestId() }, 409);
  for (const role of roles.slice(0, 4)) await api(role, { action: 'fee-allocation.get-workspace', schoolId: foreign }, 403);
  await allocation('pause', { reason: 'Pause fictive contrôlée' });
  await api('cashier', { ...expense, clientRequestId: requestId() }, 409);
  await allocation('resume', { reason: 'Reprise fictive contrôlée' });
  record('Solde insuffisant, rubrique étrangère, accès interétablissements et pause refusés');
  const ledger = async () => (await s.db.collection('feeAllocationMovements').where('schoolId', '==', school).get()).docs.map(d => d.data());
  const freshStudent = async (suffix, extra = {}) => {
    const id = `${tag}-${suffix}`;
    await put('students', id, { schoolId: school, schoolYearId: year, nom: 'FICTIF', postnom: suffix.toUpperCase(), prenom: 'Recette',
      matricule: id, sexe: 'F', birthDate: '2016-01-01', className: '1ère Primaire', classId: `${tag}-class`, section: 'Primaire', status: 'ACTIVE', createdAt: new Date().toISOString(), ...extra });
    return id;
  };
  const social = await freshStudent('social'), exempt = await freshStudent('exempt');
  const beforeSocial = (await ledger()).length;
  const decision = { action: 'save-social-support', schoolYearId: year, reason: 'social', nature: 'fixed', observation: 'Recette fictive', lines: [{ feeTypeId: fee, value: 50 }] };
  await api('school_admin', { ...decision, studentId: social, clientRequestId: requestId() });
  await api('school_admin', { ...decision, studentId: exempt, nature: 'full', clientRequestId: requestId() });
  // Legacy unpaid commitment: a synthetic historical input, not a new promise
  // feature or a mocked API response. The actual third-party payment is server-confirmed.
  const socialData = (await s.db.doc(`students/${social}`).get()).data();
  await ownUpdate('students', social, { financialSupport: { ...socialData.financialSupport,
    legacy: { id: 'legacy', schoolYearId: year, thirdPartyName: 'Tiers fictif', lines: { [fee]: { reductionMinor: 0, commitmentMinor: 3000 } } } } });
  assert.equal((await ledger()).length, beforeSocial);
  await api('cashier', { ...payment, studentId: exempt, amount: 1, clientRequestId: requestId() }, 409);
  await api('cashier', { ...payment, studentId: social, amount: 20, clientRequestId: requestId() });
  const third = { ...payment, studentId: social, amount: 30, supportDecisionId: 'legacy', clientRequestId: requestId() };
  const thirdResult = await api('cashier', third); assert.equal((await api('cashier', third)).idempotent, true);
  await api('school_admin', { action: 'delete-payment', transactionId: thirdResult.payment.id, reason: 'Refus attendu', clientRequestId: requestId() }, 409);
  assert.equal((await ledger()).length, beforeSocial + 2);
  record('Réduction, exonération et engagement non encaissé sans recette ; paiement réel du tiers unique');
  const classTwo = await freshStudent('class-two', { className: '2ème Primaire', classId: `${tag}-second-class` });
  await api('cashier', { ...payment, studentId: classTwo, feeTypeId: secondFee, amount: 200, clientRequestId: requestId() });
  await api('cashier', { ...payment, feeTypeId: unallocatedFee, amount: 20, clientRequestId: requestId() });
  const allocatedSecond = (await ledger()).find(m => m.sourceType === 'payment' && m.feeTypeId === secondFee);
  assert.equal(allocatedSecond.lines.find(l => l.rubricId === rubrics[0].id).amountMinor, 400);
  assert.equal(allocatedSecond.lines.find(l => l.rubricId === 'UNALLOCATED').amountMinor, 4400);
  assert.ok((await ledger()).some(m => m.feeTypeId === unallocatedFee && m.lines.length === 1 && m.lines[0].rubricId === 'UNALLOCATED' && m.amountMinor === 2000));
  record('Tarifs 100/200 selon classe, montant fixe + pourcentages, frais sans répartition');
  // Identified synthetic historical sources exercise the real historical reader.
  for (const [suffix, configured] of [['old1', true], ['old2', false]]) {
    const oldYear = `${tag}-${suffix}`, oldStudent = `${oldYear}-student`, oldFee = `${oldYear}-fee`, oldVersion = `${oldYear}-version`;
    await put('schoolYears', oldYear, { schoolId: school, name: configured ? '2025-2026' : '2024-2025', status: 'archived', startsAt: configured ? '2025-09-01' : '2024-09-01', currency: 'USD' });
    await put('students', oldStudent, { schoolId: school, schoolYearId: oldYear, className: '1ère Primaire', status: 'ACTIVE',
      ...(configured ? { importedFromStudentId: `${tag}-old2-student` } : {}) });
    await put('feeTypes', oldFee, { schoolId: school, schoolYearId: oldYear, name: 'Ancien minerval fictif', className: '1ère Primaire', amount: 100 });
    if (configured) {
      const oldRubrics = [{ id: rubrics[0].id, name: rubrics[0].name, mode: 'percent', basisPoints: 5000 }];
      await put('feeAllocationVersions', oldVersion, { schoolId: school, schoolYearId: oldYear, feeTypeId: oldFee, className: '1ère Primaire', currency: 'USD', feeAmountMinor: 10000, status: 'superseded', effectiveFrom: '2025-09-01', rubrics: oldRubrics, shares: validateFeeAllocationRubrics(oldRubrics, 10000).shares });
      await fixtureAnchor({ schoolId: school, schoolYearId: oldYear, studentId: oldStudent, feeTypeId: oldFee, currency: 'USD' },
        { schoolId: school, originSchoolYearId: oldYear, studentId: oldStudent, feeTypeId: oldFee, currency: 'USD', configVersionId: oldVersion, feeAmountMinor: 10000, className: '1ère Primaire', classOptionKey: null, anchoredAt: '2025-09-02' });
    }
  }
  await ownUpdate('students', student, { importedFromStudentId: `${tag}-old1-student` });
  for (const suffix of ['old1', 'old2']) {
    const oldYear = `${tag}-${suffix}`;
    for (const amount of [30, 70]) await api('cashier', { ...payment, feeTypeId: `${oldYear}-fee`, debtSchoolYearId: oldYear, amount, clientRequestId: requestId() });
    const moves = (await ledger()).filter(m => m.originSchoolYearId === oldYear);
    assert.equal(moves.length, 2); assert.equal(moves.reduce((n, m) => n + m.amountMinor, 0), 10000);
    assert.ok(moves.every(m => m.collectionSchoolYearId === year && m.currency === 'USD'));
    assert.ok(moves.every(m => suffix === 'old1' ? m.configVersionId === `${oldYear}-version` : m.configVersionId === null && m.lines.length === 1 && m.lines[0].rubricId === 'UNALLOCATED'));
  }
  record('Arriérés avec ancre historique et sans preuve : années distinctes, Non affecté sans réutiliser la version courante');
  const originalExpense = (await s.db.collection('expenses').where('schoolId', '==', school).get()).docs.find(d => !d.data().personnelPaymentId);
  const immutableBefore = await ledger();
  await api('school_admin', { action: 'update-expense', transactionId: originalExpense.id, amount: 0.5, category: 'Fournitures', description: 'Correction fictive', reason: 'Recette', clientRequestId: requestId() });
  await api('school_admin', { action: 'delete-expense', transactionId: originalExpense.id, reason: 'Annulation fictive autorisée', clientRequestId: requestId() });
  for (const original of immutableBefore) assert.deepEqual((await s.db.doc(`feeAllocationMovements/${original.id}`).get()).data(), original);
  const concurrentExpenses = await Promise.all([1, 2].map(async () => {
    const response = await fetch(`${origin}/api/manage-financial-transaction`, { method: 'POST', headers: { Authorization: tokens.get('cashier'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...expense, amount: 40, clientRequestId: requestId() }), signal: AbortSignal.timeout(60000) });
    return response.status;
  }));
  assert.deepEqual(concurrentExpenses.sort(), [200, 409]);
  for (const collection of ['feeAllocationTestScopes', 'feeAllocationMovements', 'feeAllocationBalances', 'feeAllocationVersions']) {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/acadea-staging/databases/(default)/documents/${collection}/${tag}-forged`, {
      method: 'PATCH', headers: { Authorization: tokens.get('school_admin'), 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { schoolId: { stringValue: school } } }) });
    assert.equal(response.status, 403);
  }
  record('Compensations immuables, concurrence de décaissements et écritures clientes refusées');
  const cdfYear = `${tag}-foreign-year`, cdfFee = `${tag}-cdf-fee`, cdfStudent = `${tag}-cdf-student`, cdfRubric = 'e'.repeat(32);
  await put('classes', `${tag}-cdf-class`, { schoolId: foreign, schoolYearId: cdfYear, name: '1ère Primaire', section: 'Primaire', active: true });
  await put('feeTypes', cdfFee, { schoolId: foreign, schoolYearId: cdfYear, name: 'Minerval fictif CDF', className: '1ère Primaire', amount: 1500000, createdAt: new Date().toISOString() });
  await allocation('save-draft', { feeTypeId: cdfFee, expectedRevision: 0, rubrics: [{ id: cdfRubric, name: 'Fonctionnement CDF', mode: 'percent', basisPoints: 5000 }] }, 'cdf-admin');
  const cdfVersion = await allocation('prepare-version', { feeTypeId: cdfFee, expectedRevision: 1 }, 'cdf-admin');
  await put('students', cdfStudent, { schoolId: foreign, schoolYearId: cdfYear, nom: 'FICTIF CDF', className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', createdAt: new Date().toISOString() });
  // Deliberately historical fixture: the real API must not reject its later
  // payment merely because the approved publication is newer than the tariff.
  await ownUpdate('students', cdfStudent, { createdAt: '2026-09-01T00:00:00.000Z' });
  await ownUpdate('feeTypes', cdfFee, { createdAt: '2026-09-01T00:00:00.000Z' });
  await api('cdf-cashier', { action: 'create-payment', schoolYearId: cdfYear, studentId: cdfStudent, feeTypeId: cdfFee, amount: 100, clientRequestId: requestId() });
  const cdfExpense = { action: 'create-expense', schoolYearId: cdfYear, amount: 10, category: 'Fournitures', description: 'Dépense fictive historique', beneficiary: 'Fictif', paymentMethod: 'Espèces', clientRequestId: requestId() };
  await api('cdf-cashier', cdfExpense);
  assert.equal((await s.db.collection('feeAllocationMovements').where('schoolId', '==', foreign).get()).size, 0);
  browser = await chromium.launch({ headless: true });
  const activationContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  try {
    const page = await activationContext.newPage(); page.setDefaultTimeout(60000);
    const u = users.find(u => u.key === 'cdf-admin');
    await page.goto(origin + '/login'); await page.getByPlaceholder('email@ecole.com').fill(u.email); await page.getByPlaceholder('Votre mot de passe').fill(password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
    await page.getByRole('button', { name: 'Répartition des frais', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Activation par établissement' });
    const transportFailures = [];
    await page.route('**/api/manage-financial-transaction', guardedRoute(async route => {
      const action = route.request().postDataJSON()?.action;
      if (!['publish-configuration', 'start-reconciliation', 'prepare-opening', 'approve-opening', 'activate', 'pause', 'resume'].some(a => action === `fee-allocation.${a}`)) return route.continue();
      const response = await route.fetch({ maxRetries: 1 });
      await new Promise(resolve => setTimeout(resolve, 800));
      await route.fulfill({ response });
    }, transportFailures));
    // Wait for the actual authenticated mutation, not Playwright's five-second
    // assertion default. A slow confirmed reply is not a server rejection.
    async function activationClick(label, action) {
      const responsePromise = page.waitForResponse(response => {
        if (!response.url().endsWith('/api/manage-financial-transaction') || response.request().method() !== 'POST') return false;
        try { return response.request().postDataJSON()?.action === `fee-allocation.${action}`; } catch { return false; }
      }, { timeout: 45000 });
      void responsePromise.catch(() => {}); // Awaited below; never leak a raw event error.
      const control = panel.getByRole('button', { name: label, exact: true });
      const before = await control.boundingBox();
      await control.click();
      const waiting = panel.getByRole('button', { name: 'Chargement...', exact: true });
      await expect(waiting).toBeDisabled();
      const during = await waiting.boundingBox();
      assert.equal(before.width, during.width); assert.equal(before.height, during.height);
      const response = await responsePromise;
      assert.equal(transportFailures.length, 0, 'Transport hébergé interrompu');
      const reply = await response.json();
      assert.equal(response.status(), 200, `Activation ${action}: HTTP ${response.status()}, code ${reply.code ?? 'inconnu'}`);
      assert.equal(reply.operational, false, 'Contrat de confirmation invalide');
    }
    await activationClick('Publier la répartition', 'publish-configuration');
    await expect(panel.getByRole('button', { name: 'Publier la répartition', exact: true })).toHaveCount(0, { timeout: 45000 });
    await activationClick('Vérifier le solde de départ', 'start-reconciliation');
    await panel.getByRole('button', { name: 'Continuer la vérification', exact: true }).click();
    await expect(panel.getByText('Vérification terminée.', { exact: false })).toBeVisible({ timeout: 60000 });
    await panel.getByRole('button', { name: 'Préparer le solde de départ', exact: true }).click();
    await panel.getByLabel('Caisse constatée (CDF)', { exact: true }).fill('90');
    await panel.getByLabel('Ouverture : Fonctionnement CDF (CDF)', { exact: true }).fill('90');
    await panel.getByLabel('Confirmation du rapprochement', { exact: true }).fill('RAPPROCHER LA CAISSE');
    await activationClick('Confirmer le solde de départ', 'prepare-opening');
    await expect(panel.getByRole('button', { name: 'Approuver le solde de départ', exact: true })).toBeVisible({ timeout: 45000 });
    await panel.getByLabel('Confirmation du rapprochement', { exact: true }).fill('APPROUVER LE RAPPROCHEMENT');
    await activationClick('Approuver le solde de départ', 'approve-opening');
    await expect(panel.getByRole('button', { name: 'Activer la répartition', exact: true })).toBeVisible({ timeout: 45000 });
    await panel.getByLabel('Confirmation du rapprochement', { exact: true }).fill('ACTIVER LA REPARTITION FICTIVE');
    await activationClick('Activer la répartition', 'activate');
    await expect(panel.getByRole('heading', { name: 'Active', exact: true })).toBeVisible({ timeout: 45000 });
    await page.screenshot({ path: `${output}/activation-administrateur-cdf.png`, fullPage: true });
    await panel.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
    await panel.getByLabel('Motif audité', { exact: true }).fill('Pause fictive de contrôle du panneau');
    await activationClick('Confirmer la pause', 'pause');
    await expect(panel.getByRole('heading', { name: 'En pause', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Reprendre la répartition', exact: true }).click();
    await panel.getByLabel('Motif audité', { exact: true }).fill('Reprise fictive de contrôle du panneau');
    await activationClick('Confirmer la reprise', 'resume');
    await expect(panel.getByRole('heading', { name: 'Active', exact: true })).toBeVisible();
    record('Publication, rapprochement, approbation et activation explicites depuis le véritable formulaire Administrateur');
  } catch (error) {
    const tab = activationContext.pages()[0];
    if (tab) {
      await tab.screenshot({ path: `${output}/activation-failure.png`, fullPage: true }).catch(() => {});
      writeFileSync(`${output}/activation-failure.json`, JSON.stringify({ error: safeError(error),
        panel: await tab.getByRole('region', { name: 'Activation par établissement' }).innerText({ timeout: 1000 }).catch(() => 'Panneau indisponible') }, null, 2));
    }
    throw error;
  } finally { await activationContext.close(); }
  await api('cdf-cashier', { action: 'create-payment', schoolYearId: cdfYear, studentId: cdfStudent, feeTypeId: cdfFee, amount: 10000, clientRequestId: requestId() });
  await api('cdf-cashier', { ...cdfExpense, amount: 2000, allocationRubricId: cdfRubric, clientRequestId: requestId() });
  const cdfWorkspace = await api('cdf-admin', { action: 'fee-allocation.get-workspace', schoolId: foreign });
  assert.equal(cdfWorkspace.currency, 'CDF');
  assert.equal(cdfWorkspace.ledger.balances.reduce((n, b) => n + b.availableMinor, 0), 809000);
  assert.ok(cdfWorkspace.ledger.movements.every(m => !m.feeTypeId || m.feeTypeId === cdfFee));
  record('Deuxième école CDF : cycle inactif préservé, ouverture 90 + recette 10 000 - dépense 2 000 = 8 090 FC ; devises séparées');
  const offlineStudent = await freshStudent('offline');
  const oldProposal = { action: 'create-payment', schoolYearId: year, studentId: offlineStudent, feeTypeId: unallocatedFee, amount: 11,
    expectedFeeAmount: 20, expectedCurrency: 'USD', proposedAt: new Date(Date.now() - 86400000).toISOString(), clientRequestId: requestId() };
  const beforeOffline = (await ledger()).length;
  await api('cashier', oldProposal, 409); assert.equal((await ledger()).length, beforeOffline);
  const profile = mkdtempSync(join(tmpdir(), 'acadea-allocation-e2e-'));
  manifest.browserProfile = profile; save(); // Only this fictitious, revoked session; no real IndexedDB is touched.
  let offlineContext;
  try {
    offlineContext = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'allow', viewport: { width: 1440, height: 1000 } });
    let page = await offlineContext.newPage(); page.setDefaultTimeout(30000);
    await page.addInitScript(() => window.addEventListener('acadea:offline-context-ready', () => { window.acadeaOfflineContextReady = true; }));
    await page.goto(origin + '/login'); await page.getByPlaceholder('email@ecole.com').fill(users[1].email); await page.getByPlaceholder('Votre mot de passe').fill(password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Menu', exact: true }).last()).toBeVisible({ timeout: 60000 });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller && window.acadeaOfflineContextReady)), { timeout: 90000 }).toBe(true);
    await expect.poll(() => page.evaluate(async () => Boolean(await (await caches.open('acadea-pwa-v6-assets')).match(document.querySelector('script[type="module"]')?.src || ''))), { timeout: 60000 }).toBe(true);
    await offlineContext.setOffline(true);
    await page.getByRole('button', { name: 'Voir les opérations' }).click();
    await page.getByLabel('Élève', { exact: true }).selectOption(offlineStudent);
    await page.getByLabel('Type de frais').selectOption(unallocatedFee);
    await page.getByLabel('Montant provisoire').fill('11');
    await page.getByRole('button', { name: 'Enregistrer le brouillon local' }).click();
    await expect(page.getByText('Brouillon local enregistré.', { exact: false })).toBeVisible();
    assert.equal((await ledger()).length, beforeOffline);
    const url = page.url(); await offlineContext.close();
    offlineContext = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'allow', offline: true, viewport: { width: 1440, height: 1000 } });
    page = await offlineContext.newPage(); page.setDefaultTimeout(30000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Cold offline reopening uses OfflineAccessScreen: the queue is already open.
    await expect(page.getByRole('heading', { name: 'Acadéa hors connexion', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'État des opérations hors connexion' })).toBeVisible();
    await expect(page.getByText('En attente', { exact: true })).toBeVisible();
    assert.equal((await ledger()).length, beforeOffline);
    let lost = false, delivered = false, replay;
    const offlineTransportFailures = [];
    await offlineContext.route('**/api/manage-financial-transaction', guardedRoute(async route => {
      const input = route.request().postDataJSON();
      if (input?.action !== 'create-payment' || input.studentId !== offlineStudent) return route.continue();
      // Send to the real hosted API, then lose only the confirmed network response.
      const response = await route.fetch(); assert.equal(response.status(), 200);
      if (lost) {
        assert.equal(input.clientRequestId, replay.clientRequestId);
        await route.fulfill({ response }); delivered = true; return;
      }
      lost = true; replay = input; await route.abort('connectionreset');
    }, offlineTransportFailures));
    await offlineContext.setOffline(false);
    // Reconnection reloads the normal authenticated screen. Wait for the real
    // server write, then open its queue through the normal offline notice.
    await expect(page.getByRole('button', { name: 'Menu', exact: true }).last()).toBeVisible({ timeout: 60000 });
    await expect.poll(async () => (await ledger()).length, { timeout: 120000 }).toBe(beforeOffline + 1);
    await expect.poll(() => delivered, { timeout: 120000 }).toBe(true);
    await offlineContext.setOffline(true);
    await page.getByRole('button', { name: 'Voir les opérations' }).click();
    await expect(page.getByText('Confirmée par le serveur', { exact: true })).toBeVisible({ timeout: 120000 });
    assert.equal(lost, true, 'Perte de réponse non exercée'); assert.ok(replay?.proposedAt && replay.clientRequestId);
    assert.equal(offlineTransportFailures.length, 0, 'Transport hors connexion interrompu');
    assert.equal((await api('cashier', replay)).idempotent, true);
    const after = await ledger(); assert.equal(after.length, beforeOffline + 1);
    assert.ok(after.some(m => m.studentId === offlineStudent && m.amountMinor === 1100 && m.lines.length === 1 && m.lines[0].rubricId === 'UNALLOCATED'));
    await page.screenshot({ path: `${output}/cashier-offline-confirmed.png`, fullPage: true });
    record('Réouverture réelle hors ligne, proposition conservée, synchronisation automatique, réponse perdue et rejeu uniques');
  } finally { await offlineContext?.close(); }
  const finalWorkspace = await api('school_admin', { action: 'fee-allocation.get-workspace', schoolId: school });
  for (const role of ['cashier', 'coordination_admin', 'sub_coordination_admin', 'teacher']) {
    await allocation('pause', { reason: 'Tentative non autorisée fictive' }, role, 403);
  }
  record('Activation/pause réservées à l’administrateur : mutations refusées aux quatre autres rôles');
  const finalTotals = finalWorkspace.ledger.balances.reduce((a, b) => ({ opening: a.opening + b.openingMinor, received: a.received + b.receivedMinor, spent: a.spent + b.spentMinor, available: a.available + b.availableMinor }), { opening: 0, received: 0, spent: 0, available: 0 });
  assert.deepEqual(finalTotals, { opening: 500, received: 58100, spent: 4200, available: 54400 });
  const flagged = [[rubrics[0].id, 0, 6000, 4200, 1800, 400, 5600], ['UNALLOCATED', 500, 25500, 0, 26000, 4400, 21100]];
  const flaggedProof = flagged.map(([id, opening, received, spent, available, filtered, difference]) => {
    const balance = finalWorkspace.ledger.balances.find(b => b.rubricId === id);
    assert.deepEqual([balance.openingMinor, balance.receivedMinor, balance.spentMinor, balance.availableMinor], [opening, received, spent, available]);
    const selected = finalWorkspace.ledger.movements.filter(m => m.feeTypeId === secondFee && m.sourceType !== 'expense');
    assert.equal(selected.reduce((n, m) => n + (m.lines.find(l => l.rubricId === id)?.amountMinor ?? 0), 0), filtered);
    assert.equal(received - filtered, difference); assert.equal(opening + received - spent, available);
    return { rubricId: id, opening, received, spent, available, filtered, difference };
  });
  writeFileSync(`${output}/flagged-rubrics-proof.json`, JSON.stringify({ sha: expectedSha, currency: 'USD', rows: flaggedProof }, null, 2));
  record('Deux rubriques signalées : écarts hors filtre 56/211 USD et équations du solde confirmés dans le registre hébergé');
  writeFileSync(`${output}/reconciliation-proof.json`, JSON.stringify({ currency: 'USD', expected: { opening: 500, received: 58100, spent: 4200, available: 54400 }, actual: finalTotals, sha: expectedSha }, null, 2));
  record('Rapprochement final : ouverture 5 + recettes 581 - dépenses nettes 42 = disponible 544 USD');
  browser ??= await chromium.launch({ headless: true });
  pdfOcr = await createWorker('fra', 1, { langPath: fileURLToPath(new URL('../node_modules/@tesseract.js-data/fra/4.0.0_best_int', import.meta.url)), cacheMethod: 'none', logger: () => {} });
  for (const u of users.slice(0, 4)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    try {
      const page = await context.newPage(); page.setDefaultTimeout(30000);
      await page.goto(origin + '/login'); await page.getByPlaceholder('email@ecole.com').fill(u.email); await page.getByPlaceholder('Votre mot de passe').fill(password);
      await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Menu', exact: true }).last()).toBeVisible({ timeout: 60000 });
      await page.getByRole('button', { name: 'Menu', exact: true }).last().click(); await page.getByRole('button', { name: 'Répartition des frais', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Répartition des frais', exact: true });
      await expect(drawer.getByRole('button', { name: 'Exporter PDF', exact: true })).toBeEnabled({ timeout: 60000 });
      await expect(drawer.locator('tbody tr')).toHaveCount(21);
      await expect(drawer.getByRole('button', { name: '+ Ajouter', exact: true })).toHaveCount(0);
      const toolbar = drawer.getByRole('region', { name: 'Commandes de répartition' });
      await expect(toolbar.locator('button, select')).toHaveCount(3);
      assert.ok((await drawer.getByLabel('Valeur correspondante', { exact: true }).locator('option').allTextContents()).every(text => !text.includes('Répartition fictive USD')));
      await page.screenshot({ path: `${output}/${u.role}-desktop.png`, fullPage: true });
      let expectedReceived = 581, expectedFilter;
      if (u.role === 'school_admin') {
        await drawer.getByLabel('Valeur correspondante', { exact: true }).selectOption(JSON.stringify([school, secondFee]));
        expectedReceived = 200;
        expectedFilter = 'Minerval';
      } else if (u.role === 'cashier') {
        await drawer.getByLabel('Filtre', { exact: true }).selectOption('class');
        await drawer.getByLabel('Valeur correspondante', { exact: true }).selectOption(JSON.stringify([school, '2ème Primaire']));
        expectedReceived = 200;
        expectedFilter = '2ème Primaire';
      } else {
        await drawer.getByLabel('Filtre', { exact: true }).selectOption('period');
        await drawer.getByLabel('Valeur correspondante', { exact: true }).selectOption('custom');
        const day = new Date(Date.now() + (u.role === 'coordination_admin' ? 86400000 : 0)).toISOString().slice(0, 10);
        await drawer.getByLabel('Du', { exact: true }).fill(day);
        await drawer.getByLabel('Au', { exact: true }).fill(day);
        expectedFilter = day;
        if (u.role === 'coordination_admin') expectedReceived = 0;
      }
      const summary = drawer.getByRole('table', { name: 'Situation des répartitions' }).locator('tfoot tr');
      const money = amount => `$${amount.toFixed(2).replace('.', ',')}`;
      await expect(summary.locator('td').nth(2)).toContainText(money(expectedReceived));
      for (const [i, amount] of [5, 581, 42, 544].entries()) await expect(summary.locator('td').nth(i + 3)).toContainText(money(amount));
      for (const [name, opening, cumulative, spent, available, selected] of [['Rubrique fictive 1', 0, 60, 42, 18, 4], ['Non affecté', 5, 255, 0, 260, 44]]) {
        const row = drawer.getByRole('table', { name: 'Situation des répartitions' }).locator('tbody tr').filter({ has: page.getByText(name, { exact: true }) });
        await expect(row).toHaveCount(1);
        const filtered = u.role === 'coordination_admin' ? 0 : ['school_admin', 'cashier'].includes(u.role) ? selected : cumulative;
        for (const [i, amount] of [filtered, opening, cumulative, spent, available].entries()) await expect(row.locator('td').nth(i + 2)).toContainText(money(amount));
        assert.equal(opening + cumulative - spent, available);
      }
      await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const positions = await toolbar.locator('button, select').evaluateAll(nodes => nodes.map(n => ({ y: n.getBoundingClientRect().y, h: n.getBoundingClientRect().height })));
      assert.ok(positions.every(p => Math.abs(p.y - positions[0].y) < 2 && Math.abs(p.h - positions[0].h) < 2));
      await page.screenshot({ path: `${output}/${u.role}-mobile.png`, fullPage: true });
      await drawer.getByRole('button', { name: 'Exporter PDF', exact: true }).click();
      await expect(page.locator('[data-pdf-download]')).toHaveAttribute('href', /^blob:/, { timeout: 90000 });
      const bytes = new Uint8Array(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('[data-pdf-download]').href)).arrayBuffer()))));
      writeFileSync(`${output}/${u.role}.pdf`, bytes);
      const pdf = await getDocument({ data: bytes.slice(), standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/') }).promise; assert.ok(pdf.numPages >= 2, 'Tableau multipage attendu');
      let pdfText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const sheet = await pdf.getPage(i), viewport = sheet.getViewport({ scale: 2 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await sheet.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
        const raster = canvas.toBuffer('image/png');
        writeFileSync(`${output}/${u.role}-${i}.png`, raster);
        // Inspect every rendered page, including the separate global detail.
        pdfText += '\n' + (await pdfOcr.recognize(raster)).data.text;
      }
      writeFileSync(`${output}/${u.role}-ocr.txt`, pdfText);
      for (const amount of [expectedReceived, 5, 581, 42, 544, 60, 255, 18, 260]) assert.ok(pdfText.includes(money(amount)), 'Composantes PDF différentes du registre/drawer');
      assert.ok(pdfText.includes('Selon le filtre') && pdfText.includes('Situation globale de la rubrique'), 'Périmètres financiers absents du PDF');
      const globalDetail = pdfText.slice(pdfText.lastIndexOf('Situation globale de la rubrique'));
      assert.ok(globalDetail.includes('Rubrique fictive 1') && globalDetail.includes('Non affecté'), 'Rubriques absentes du détail global');
      // OCR traverses adjacent header columns and may interleave their wrapped
      // lines. Require every filter token, not an artificial contiguous phrase.
      assert.ok(expectedFilter.split(/\s+/).every(token => pdfText.includes(token)) && pdfText.includes('ouverture'), 'Filtre ou ouverture absent du PDF rendu');
      record(`${u.role} : connexion réelle, filtre frais/classe/période, disponible cumulé 544 USD, mobile Chromium et PDF multipage`);
    } catch (error) {
      results.push({ name: `${u.role} : export/drawer`, result: 'FAIL', detail: safeError(error) });
      process.exitCode = 1;
      console.error(`FAIL: ${u.role} : export/drawer (rapport expurgé conservé)`);
    } finally { await context.close(); }
  }
  if (panelRecipe && !results.some(r => r.result === 'FAIL')) {
    await ownUpdate('schools', foreign, { activeCoordinationId: coord });
    await put('coordinationSchools', `${coord}__${foreign}`, { schoolId: foreign, coordinationId: coord, active: true });
    await put('subCoordinationSchools', `${sub}__${foreign}`, { schoolId: foreign, coordinationId: coord, subCoordinationId: sub, active: true });
    for (const u of users.filter(u => ['coordination_admin', 'sub_coordination_admin'].includes(u.role))) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(60000);
        await page.goto(origin + '/login'); await page.getByPlaceholder('email@ecole.com').fill(u.email); await page.getByPlaceholder('Votre mot de passe').fill(password);
        await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
        await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
        await page.getByRole('button', { name: 'Répartition des frais', exact: true }).click();
        const drawer = page.getByRole('dialog', { name: 'Répartition des frais', exact: true });
        await expect(drawer.locator('tfoot tr')).toHaveCount(2);
        const labels = await drawer.getByLabel('Valeur correspondante', { exact: true }).locator('option').allTextContents();
        assert.ok(labels.some(l => l.includes('Répartition fictive USD')) && labels.some(l => l.includes('Répartition fictive CDF')));
        await page.screenshot({ path: `${output}/${u.role}-multi-ecoles.png`, fullPage: true });
        await drawer.getByRole('combobox', { name: 'Établissement', exact: true }).selectOption(school);
        await expect(drawer.locator('tfoot tr')).toHaveCount(1);
        assert.ok((await drawer.getByLabel('Valeur correspondante', { exact: true }).locator('option').allTextContents()).every(l => !l.includes('Répartition fictive')));
        record(`${u.role} : deux écoles/devises distinctes puis école unique sans répétitions`);
      } finally { await context.close(); }
    }
  }
  }
  browser ??= await chromium.launch({ headless: true });
  if (!results.some(result => result.result === 'FAIL')) await (panelRecipe ? runHostedAllocationPanel : runHostedAllocationVolume)({ db: s.db, tag, schoolId: volumeSchool, yearId: volumeYear,
    put, api, allocation, manifest, save, output, browser, user: users.find(u => u.key === 'volume-cashier'), adminUser: users.find(u => u.key === 'volume-admin'), password, origin, record });
} catch (error) {
  results.push({ name: 'Recette interrompue', result: 'FAIL', detail: safeError(error) }); process.exitCode = 1;
  checkpoint();
  console.error('FAIL: recette interrompue, consulter le rapport expurgé.');
} finally {
  // Fixture neutralization must still run if a browser/OCR worker failed.
  await Promise.allSettled([Promise.resolve().then(() => pdfOcr?.terminate()), Promise.resolve().then(() => browser?.close())]);
  try { await retire(); } catch { results.push({ name: 'Clôture', result: 'FAIL' }); process.exitCode = 1; }
  writeFileSync(`${output}/results.json`, JSON.stringify({ projectId: 'acadea-staging', expectedSha, results }, null, 2));
  await s.close(); tokens.clear();
}
