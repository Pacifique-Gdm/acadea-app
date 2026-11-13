import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { services } from './socialFinanceStagingFixture.mjs';

const origin = 'https://acadea-staging.vercel.app', output = 'diagnostics/fee-allocation-hosted';
const manifestPath = `${output}/manifest.json`, expectedSha = process.env.ACADEA_EXPECTED_SHA;
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'acadea-staging');
assert.equal(process.env.GOOGLE_CLOUD_QUOTA_PROJECT, 'acadea-staging');
assert.equal(process.env.ACADEA_ALLOCATION_STAGING, 'YES');
assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/);
assert.ok(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
const version = await fetch(`${origin}/version.json`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
assert.equal(version.status, 200, 'Preview protégé/inaccessible : aucune fixture créée.');
assert.equal((await version.json()).version, expectedSha, 'SHA hébergé différent : aucune fixture créée.');
const html = await (await fetch(origin)).text(), asset = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(asset);
const bundle = await (await fetch(origin + asset)).text();
assert.match(bundle, /projectId\s*:\s*["']acadea-staging["']/);
assert.ok(!/projectId\s*:\s*["']acadea-production["']/.test(bundle));
if (existsSync(manifestPath)) assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).retired, true, 'Fixture précédente à clôturer.');
mkdirSync(output, { recursive: true });
const results = [{ name: 'SHA et projet Firebase avant fixture', result: 'PASS' }];
// The caller supplies an official short-lived OAuth credential, never a key file.
const s = services();
const tag = `e2e-allocation-${randomUUID().replaceAll('-', '')}`;
const school = `${tag}-a`, foreign = `${tag}-b`, year = `${tag}-year`, fee = `${tag}-fee`, student = `${tag}-student`;
const coord = `${tag}-coord`, sub = `${tag}-sub`;
const roles = ['school_admin', 'cashier', 'coordination_admin', 'sub_coordination_admin', 'teacher'];
const users = roles.map(role => ({ role, uid: `${tag}-${role}`, email: `${tag}-${role}@example.invalid` }));
const manifest = { projectId: 'acadea-staging', tag, sha: expectedSha, schools: [school, foreign], users, paths: [], retired: false, createdAt: new Date().toISOString() };
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
save(); // Durable identity-only inventory before the first write. No password/token.
const password = `Fictif-${randomUUID()}${randomUUID()}`;
let browser;
const tokens = new Map();
const record = name => { results.push({ name, result: 'PASS' }); console.log(`PASS: ${name}`); };
async function put(collection, id, data) {
  assert.ok(id.startsWith(tag));
  const path = `${collection}/${id}`;
  assert.equal((await s.db.doc(path).get()).exists, false, 'Collision fixture.');
  manifest.paths.push(path); save();
  await s.db.doc(path).create({ ...data, id, fixtureId: tag });
}
async function api(role, body, status = 200) {
  const response = await fetch(`${origin}/api/manage-financial-transaction`, { method: 'POST',
    headers: { Authorization: tokens.get(role), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  assert.equal(response.status, status, `${body.action}: HTTP ${response.status}, code ${data.code ?? 'inconnu'}`);
  return data;
}
const requestId = () => randomUUID();
const allocation = (action, body = {}, role = 'school_admin', status = 200) => api(role, { action: `fee-allocation.${action}`, requestId: requestId(), ...body }, status);
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
  const retained = {};
  for (const collection of ['payments', 'expenses', 'personnelPayments', 'feeAllocationStates', 'feeAllocationConfigs', 'feeAllocationVersions', 'feeAllocationOpeningAudits', 'feeAllocationBalances', 'feeAllocationMovements', 'feeAllocationRequests']) {
    retained[collection] = (await s.db.collection(collection).where('schoolId', '==', school).get()).docs.map(d => d.id);
  }
  manifest.retired = true; manifest.deleted = false; manifest.retained = retained; manifest.closedAt = new Date().toISOString(); save();
  record('Clôture : comptes désactivés, sessions révoquées, écoles neutralisées, registre fictif inventorié sans suppression');
}
try {
  const createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  await put('feeAllocationTestScopes', tag, { projectId: 'acadea-staging', schoolIds: [school, foreign], status: 'active', createdAt, expiresAt });
  for (const [sid, currency] of [[school, 'USD'], [foreign, 'CDF']]) {
    await put('schools', sid, { name: `Répartition fictive ${currency}`, status: 'active', active: true, currency, activeSchoolYearId: sid === school ? year : `${tag}-foreign-year`,
      schoolType: 'Primaire uniquement', educationLevels: ['Primaire'], schoolOptions: [], subscriptionStatus: 'active', subscriptionPlan: 'premium', ...(sid === school ? { activeCoordinationId: coord } : {}) });
    await put('schoolYears', sid === school ? year : `${tag}-foreign-year`, { schoolId: sid, status: 'active', currency, name: '2026-2027', startsAt: '2026-09-01', endsAt: '2027-07-31' });
  }
  await put('coordinations', coord, { name: 'Coordination fictive répartition', status: 'active', principalCoordinatorUserId: users[2].uid, referenceSchoolYear: '2026-2027' });
  await put('subCoordinations', sub, { name: 'Sous-coordination fictive', status: 'active', active: true, coordinationId: coord, coordinatorUserId: users[3].uid });
  await put('coordinationSchools', `${coord}__${school}`, { schoolId: school, coordinationId: coord, active: true });
  await put('subCoordinationSchools', `${sub}__${school}`, { schoolId: school, coordinationId: coord, subCoordinationId: sub, active: true });
  for (const u of users) {
    const scope = u.role.includes('coordination') ? { coordinationId: coord, ...(u.role === 'sub_coordination_admin' ? { subCoordinationId: sub } : {}) } : { schoolId: school };
    await put('users', u.uid, { role: u.role, ...scope, schoolId: scope.schoolId ?? '', name: `Compte fictif ${u.role}`, email: u.email, active: true, status: 'active', activeSchoolYearId: year });
    await s.auth.createUser({ uid: u.uid, email: u.email, password }); await s.auth.setCustomUserClaims(u.uid, { role: u.role, ...scope });
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.STAGING_FIREBASE_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password, returnSecureToken: true }) });
    assert.equal(response.status, 200, 'Authentification Firebase officielle refusée'); tokens.set(u.role, `Bearer ${(await response.json()).idToken}`);
  }
  await put('classes', `${tag}-class`, { schoolId: school, schoolYearId: year, name: '1ère Primaire', section: 'Primaire', active: true });
  await put('feeTypes', fee, { schoolId: school, schoolYearId: year, name: 'Minerval fictif', className: '1ère Primaire', amount: 100, createdAt });
  const rubrics = Array.from({ length: 20 }, (_, i) => ({ id: (i + 1).toString(16).padStart(32, '0'), name: `Rubrique fictive ${i + 1}`, mode: 'percent', basisPoints: 400 }));
  await allocation('save-draft', { feeTypeId: fee, expectedRevision: 0, rubrics });
  const prepared = await allocation('prepare-version', { feeTypeId: fee, expectedRevision: 1 });
  await allocation('publish-configuration', { versionId: prepared.version.id });
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
      paidAt: new Date().toISOString().slice(0, 10), amount: 1, recoveries: [], deduction: 0, cnss: 0, tax: 0, description: 'Paie fictive', allocationRubricId: rubrics[0].id, clientRequestId: requestId() };
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
  browser = await chromium.launch({ headless: true });
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
      await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `${output}/${u.role}-mobile.png`, fullPage: true });
      await drawer.getByRole('button', { name: 'Exporter PDF', exact: true }).click();
      await expect(page.locator('[data-pdf-download]')).toHaveAttribute('href', /^blob:/, { timeout: 90000 });
      const bytes = new Uint8Array(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('[data-pdf-download]').href)).arrayBuffer()))));
      writeFileSync(`${output}/${u.role}.pdf`, bytes);
      const pdf = await getDocument({ data: bytes.slice() }).promise; assert.ok(pdf.numPages >= 2, 'Tableau multipage attendu');
      for (let i = 1; i <= pdf.numPages; i++) {
        const sheet = await pdf.getPage(i), viewport = sheet.getViewport({ scale: 1.2 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await sheet.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
        writeFileSync(`${output}/${u.role}-${i}.png`, canvas.toBuffer('image/png'));
      }
      record(`${u.role} : connexion réelle, drawer rapproché, mobile Chromium et PDF multipage`);
    } finally { await context.close(); }
  }
} catch (error) {
  results.push({ name: 'Recette interrompue', result: 'FAIL', detail: String(error.message).slice(0, 600) }); process.exitCode = 1;
  console.error('FAIL: recette interrompue, consulter le rapport expurgé.');
} finally {
  await browser?.close();
  try { await retire(); } catch { results.push({ name: 'Clôture', result: 'FAIL' }); process.exitCode = 1; }
  writeFileSync(`${output}/results.json`, JSON.stringify({ projectId: 'acadea-staging', expectedSha, results }, null, 2));
  await s.close(); tokens.clear();
}
