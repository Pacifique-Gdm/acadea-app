import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 60000 });

/** Extends, never replaces, the full hosted recipe and its four role/PDF checks.
 * All writes are constrained to the school inventoried before provisioning. */
export async function runAnnualAllocationHosted({ db, tag, schoolId, yearId, put, api, allocation, manifest, save, output, browser, adminUser, password, origin, record, tokens }) {
  assert.equal(db.projectId, 'acadea-staging');
  assert.equal(schoolId, `${tag}-annual`); assert.ok(manifest.schools.includes(schoolId));
  const role = 'annual-admin', cashier = 'annual-cashier';
  const classId = `${tag}-annual-class`, fee = `${tag}-annual-fee`;
  const rubrics = [4000, 2000, 4000].map((basisPoints, i) => ({ id: String(i + 7).repeat(32), name: `Prévu fictif ${i + 1}`, mode: 'percent', basisPoints }));
  await put('classes', classId, { schoolId, schoolYearId: yearId, name: '1ère Primaire', section: 'Primaire', active: true });
  await put('feeTypes', fee, { schoolId, schoolYearId: yearId, name: 'Prévu annuel fictif', amount: 60, currency: 'USD', className: '1ère Primaire', createdAt: new Date().toISOString() });
  for (let i = 0; i < 10; i++) await put('students', `${tag}-annual-student-${i}`, { schoolId, schoolYearId: yearId, classId, className: '1ère Primaire', section: 'Primaire', nom: `ANNUEL FICTIF ${i}`, status: 'ACTIVE', createdAt: new Date().toISOString() });
  const workspace = () => api(role, { action: 'fee-allocation.get-workspace', schoolId });
  const prepare = async (feeTypeId, selectedRubrics) => {
    await allocation('save-drafts', { schoolYearId: yearId, baseFeeTypeId: feeTypeId, targets: [{ feeTypeId, expectedRevision: 0 }], rubrics: selectedRubrics }, role);
    return (await allocation('prepare-version', { feeTypeId, expectedRevision: 1 }, role)).version;
  };
  const version = await prepare(fee, rubrics);
  let w = await workspace();
  assert.deepEqual(w.forecast.rows.filter(r => r.feeTypeId === fee).map(r => r.amountMinor), [24000, 12000, 24000, 0]);
  assert.equal(w.ledger, null);
  await allocation('publish-configuration', { versionId: version.id }, role);
  let run = (await allocation('start-reconciliation', {}, role)).run;
  while (run.status === 'RUNNING') run = (await api(role, { action: 'fee-allocation.advance-reconciliation', runId: run.id, sequence: run.sequence })).run;
  assert.equal(run.status, 'COMPLETE');
  const opening = await allocation('prepare-opening', { cashCountMinor: 0, lines: rubrics.map(r => ({ rubricId: r.id, amountMinor: 0 })), confirmation: 'RAPPROCHER LA CAISSE' }, role);
  await allocation('approve-opening', { openingId: opening.openingId, confirmation: 'APPROUVER LE RAPPROCHEMENT' }, role);
  await allocation('activate', { openingId: opening.openingId, confirmation: 'ACTIVER LA REPARTITION FICTIVE' }, role);
  const openingRef = db.doc(`feeAllocationOpeningAudits/${opening.openingId}`), openingBefore = (await openingRef.get()).data();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'allow' });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(60000);
    await page.goto(origin + '/login');
    await page.getByPlaceholder('email@ecole.com').fill(adminUser.email);
    await page.getByPlaceholder('Votre mot de passe').fill(password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
    await page.getByRole('button', { name: 'Répartition des frais', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Répartition des frais', exact: true });
    await expect(drawer.getByRole('button', { name: '+ Ajouter', exact: true })).toBeEnabled();
    await expect(drawer.getByRole('button', { name: 'Mettre en pause', exact: true })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Configurer une répartition', exact: true })).toHaveCount(0);
    await drawer.getByLabel('Valeur correspondante', { exact: true }).selectOption(JSON.stringify([schoolId, fee]));
    const total = drawer.locator('tfoot tr td').nth(1);
    await expect(total).toContainText('$600,00');
    for (const [i, amount] of [240, 120, 240].entries()) {
      const row = drawer.locator('tbody tr').filter({ has: page.getByText(`Prévu fictif ${i + 1}`, { exact: true }) });
      await expect(row.locator('td').nth(1)).toContainText(`$${amount},00`);
    }
    await page.screenshot({ path: `${output}/annual-600-before.png`, fullPage: true });
    record('Prévu annuel hébergé : dix élèves sans paiement, 600 USD = 240 + 120 + 240');

    // Real application provisioning, no administrative token in the browser.
    const addedId = `student-${randomUUID()}`;
    manifest.paths.push(`students/${addedId}`); save();
    const input = { id: addedId, schoolId, schoolYearId: yearId, classId, className: '1ère Primaire', section: 'Primaire', nom: 'ANNUEL', postnom: 'FICTIF', prenom: 'AJOUT', sexe: 'F', birthDate: '2017-03-04', status: 'ACTIVE', address: '', phone: '' };
    const response = await fetch(origin + '/api/provision-school-account', { method: 'POST', headers: { Authorization: tokens.get(role), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-manual-student', intent: 'create', clientRequestId: randomUUID().replaceAll('-', ''), student: input }), signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200, 'Inscription réelle refusée');
    assert.equal((await response.json()).student.id, addedId);
    await expect(total).toContainText('$660,00', { timeout: 120000 });
    assert.equal(await drawer.getByLabel('Valeur correspondante', { exact: true }).inputValue(), JSON.stringify([schoolId, fee]));

    // Archive through Firestore's authenticated client API, as updateData does.
    const archive = await fetch(`https://firestore.googleapis.com/v1/projects/acadea-staging/databases/(default)/documents/students/${addedId}?updateMask.fieldPaths=status&updateMask.fieldPaths=deletedAt&updateMask.fieldPaths=exitReason`, {
      method: 'PATCH', headers: { Authorization: tokens.get(role), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { status: { stringValue: 'TRANSFERRED' }, deletedAt: { stringValue: new Date().toISOString() }, exitReason: { stringValue: 'Transfert' } } }), signal: AbortSignal.timeout(30000),
    });
    assert.equal(archive.status, 200, 'Archivage client autorisé refusé');
    await expect(total).toContainText('$600,00', { timeout: 120000 });
    assert.equal((await db.doc(`students/${addedId}`).get()).exists, true);
    assert.deepEqual((await openingRef.get()).data(), openingBefore);
    record('Inscription confirmée puis archivage authentifié : panneau ouvert 600 → 660 → 600, filtre et ouverture conservés');

    const newFee = `${tag}-annual-added-fee`, student = `${tag}-annual-student-0`;
    await put('feeTypes', newFee, { schoolId, schoolYearId: yearId, name: 'Nouveau frais après activation', amount: 30, currency: 'USD', className: '1ère Primaire', createdAt: new Date().toISOString() });
    const pay = (request, amount = 1, extra = {}) => api(cashier, { action: 'create-payment', schoolYearId: yearId, studentId: student, feeTypeId: newFee, amount, clientRequestId: request, ...extra });
    const beforeRequest = randomUUID(), before = await pay(beforeRequest, 10);
    const newVersion = await prepare(newFee, [{ id: 'a'.repeat(32), name: 'Nouveau fixe fictif', mode: 'fixed', fixedMinor: 1500 }]);
    await Promise.all([pay(randomUUID()), pay(randomUUID())]);
    const movements = async () => (await db.collection('feeAllocationMovements').where('schoolId', '==', schoolId).get()).docs.map(d => ({ ...d.data(), id: d.id }));
    const old = await movements(), capturedAt = (await db.doc(`payments/${before.payment.id}`).get()).data().createdAt;
    const publish = { action: 'fee-allocation.publish-configuration', versionId: newVersion.id, requestId: randomUUID() };
    await api(cashier, publish, 403);
    const published = await Promise.all([api(role, publish), api(role, publish)]);
    assert.equal(published.filter(p => p.idempotent).length, 1, 'Publication concurrente non unique');
    for (const movement of old) assert.deepEqual((await db.doc(`feeAllocationMovements/${movement.id}`).get()).data(), movement);
    const next = await pay(randomUUID(), 5, { proposedAt: capturedAt, expectedFeeAmount: 30, expectedCurrency: 'USD' });
    assert.equal((await pay(beforeRequest, 10)).idempotent, true);
    const latest = await movements(), allocated = latest.find(m => m.sourceId === next.payment.id);
    assert.equal(allocated.configVersionId, newVersion.id);
    assert.equal(allocated.lines.find(l => l.rubricId === 'a'.repeat(32)).amountMinor, 250);
    assert.equal(latest.find(m => m.sourceId === before.payment.id).configVersionId, null);
    assert.equal(latest.length, old.length + 1);
    assert.deepEqual((await openingRef.get()).data(), openingBefore);
    w = await workspace();
    assert.equal(w.forecast.rows.filter(r => r.feeTypeId === newFee).reduce((n, r) => n + r.amountMinor, 0), 30000);
    writeFileSync(`${output}/annual-live-publication.json`, JSON.stringify({ schoolId, publicationId: newVersion.id, priorMovementCount: old.length, finalMovementCount: latest.length, annualNetMinor: 60000, newFeeAnnualMinor: 30000, openingPreserved: true }, null, 2));
    record('Publication pendant les encaissements, concurrence et rejeu : ancien Non affecté intact, nouvelle recette et proposition antérieure ventilées une seule fois');
    await expect(total).toContainText('$600,00');
    await page.screenshot({ path: `${output}/annual-600-after.png`, fullPage: true });
  } finally { await context.close(); }
}
