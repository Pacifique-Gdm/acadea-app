import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect as baseExpect } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
const expect = baseExpect.configure({ timeout: 60000 });

/** Extends, never replaces, the full hosted recipe and its four role/PDF checks.
 * All writes are constrained to the school inventoried before provisioning. */
export async function runAnnualAllocationHosted({ db, tag, schoolId, yearId, put, api, allocation, manifest, save, output, browser, adminUser, password, origin, record, tokens, pdfOcr }) {
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
  let page;
  const requestErrors = [];
  try {
    page = await context.newPage(); page.setDefaultTimeout(60000);
    page.on('response', response => {
      if (response.url().startsWith(origin + '/api/') && response.status() >= 400) {
        requestErrors.push({ path: new URL(response.url()).pathname, status: response.status(), action: response.request().postDataJSON()?.action });
      }
    });
    await page.addInitScript(() => window.addEventListener('acadea:offline-context-ready', () => { window.acadeaAnnualContextReady = true; }));
    await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
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
    const annualPdf = async (label, amount) => {
      await drawer.getByRole('button', { name: 'Exporter PDF', exact: true }).click();
      await expect(page.locator('[data-pdf-download]')).toHaveAttribute('href', /^blob:/, { timeout: 90000 });
      const bytes = new Uint8Array(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('[data-pdf-download]').href)).arrayBuffer()))));
      writeFileSync(`${output}/${label}.pdf`, bytes);
      const pdf = await getDocument({ data: bytes.slice(), standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/') }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const sheet = await pdf.getPage(i), viewport = sheet.getViewport({ scale: 2 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await sheet.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
        const png = canvas.toBuffer('image/png'); writeFileSync(`${output}/${label}-${i}.png`, png);
        text += '\n' + (await pdfOcr.recognize(png)).data.text;
      }
      assert.ok(text.includes(`$${amount},00`), 'Prévu PDF différent du panneau après changement confirmé');
      await page.locator('[data-pdf-close]').click();
    };
    await expect(total).toContainText('$600,00');
    for (const [i, amount] of [240, 120, 240].entries()) {
      const row = drawer.locator('tbody tr').filter({ has: page.getByText(`Prévu fictif ${i + 1}`, { exact: true }) });
      await expect(row.locator('td').nth(1)).toContainText(`$${amount},00`);
    }
    await page.screenshot({ path: `${output}/annual-600-before.png`, fullPage: true });
    await annualPdf('annual-before-enrollment', 600);
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
    await annualPdf('annual-after-enrollment', 660);

    // Archive through Firestore's authenticated client API, as updateData does.
    const archive = await fetch(`https://firestore.googleapis.com/v1/projects/acadea-staging/databases/(default)/documents/students/${addedId}?updateMask.fieldPaths=status&updateMask.fieldPaths=deletedAt&updateMask.fieldPaths=exitReason`, {
      method: 'PATCH', headers: { Authorization: tokens.get(role), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { status: { stringValue: 'TRANSFERRED' }, deletedAt: { stringValue: new Date().toISOString() }, exitReason: { stringValue: 'Transfert' } } }), signal: AbortSignal.timeout(30000),
    });
    assert.equal(archive.status, 200, 'Archivage client autorisé refusé');
    await expect(total).toContainText('$600,00', { timeout: 120000 });
    await annualPdf('annual-after-archive', 600);
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
    const specialFee = `${tag}-annual-social-fee`, unallocatedFee = `${tag}-annual-unallocated-fee`;
    await put('classes', `${tag}-annual-second-class`, { schoolId, schoolYearId: yearId, name: '2ème Primaire', section: 'Primaire', active: true });
    await put('feeTypes', specialFee, { schoolId, schoolYearId: yearId, name: 'Tarif social fictif', amount: 80, currency: 'USD', className: '2ème Primaire' });
    await put('feeTypes', unallocatedFee, { schoolId, schoolYearId: yearId, name: 'Frais sans répartition fictif', amount: 20, currency: 'USD', className: '2ème Primaire' });
    for (const [index, reductionMinor] of [0, 4000, 8000].entries()) {
      await put('students', `${tag}-annual-social-${index}`, { schoolId, schoolYearId: yearId, className: '2ème Primaire', section: 'Primaire', status: 'ACTIVE', nom: `SOCIAL FICTIF ${index}`,
        financialSupport: { decision: { schoolYearId: yearId, lines: { [specialFee]: { reductionMinor, commitmentMinor: index === 1 ? 4000 : 0 } } } } });
    }
    const fixed = await prepare(specialFee, [{ id: 'b'.repeat(32), name: 'Fixe social fictif', mode: 'fixed', fixedMinor: 4000 }]);
    await allocation('publish-configuration', { versionId: fixed.id }, role);
    const check = await workspace();
    assert.deepEqual(check.forecast.rows.filter(r => r.feeTypeId === specialFee).map(r => r.amountMinor), [6000, 6000]);
    assert.deepEqual(check.forecast.rows.filter(r => r.feeTypeId === unallocatedFee).map(r => [r.rubricId, r.amountMinor]), [['UNALLOCATED', 6000]]);
    assert.equal((await movements()).length, latest.length, 'Une obligation ou promesse ne doit pas créer un encaissement');
    assert.deepEqual((await openingRef.get()).data(), openingBefore);
    record('Prévu hébergé : tarif 80 USD, réduction 40, exonération 80, fixe proratisé 60/60, engagement non encaissé et frais non réparti 60');
    await expect(total).toContainText('$600,00');
    await page.screenshot({ path: `${output}/annual-600-after.png`, fullPage: true });
    // Keep this same drawer and selected fee open across the offline capture.
    await expect.poll(() => page.evaluate(() => Boolean(window.acadeaAnnualContextReady)), { timeout: 90000 }).toBe(true);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Voir les opérations', exact: true }).click();
    const queue = page.getByRole('region', { name: 'État des opérations hors connexion', exact: true });
    await queue.getByLabel('Classe préchargée', { exact: true }).selectOption(classId);
    await queue.getByLabel('Nom', { exact: true }).fill('ANNUEL HORS LIGNE');
    await queue.getByLabel('Post-nom', { exact: true }).fill('FICTIF');
    await queue.getByLabel('Prénom', { exact: true }).fill('SYNCHRONISE');
    await queue.getByLabel('Date de naissance', { exact: true }).fill('2017-05-06');
    await queue.getByRole('button', { name: 'Enregistrer le brouillon local', exact: true }).click();
    await expect(queue.getByText('Brouillon local enregistré.', { exact: false })).toBeVisible();
    await expect(total).toContainText('$600,00');
    await context.setOffline(false);
    await expect(queue.getByText('Confirmée par le serveur', { exact: true })).toBeVisible({ timeout: 120000 });
    await expect(total).toContainText('$660,00', { timeout: 120000 });
    assert.equal(await drawer.getByLabel('Valeur correspondante', { exact: true }).inputValue(), JSON.stringify([schoolId, fee]));
    const synced = (await db.collection('students').where('schoolId', '==', schoolId).get()).docs.filter(d => d.data().nom === 'ANNUEL HORS LIGNE');
    assert.equal(synced.length, 1);
    manifest.paths.push(synced[0].ref.path); save();
    await queue.getByRole('button', { name: 'Fermer', exact: true }).click();
    await annualPdf('annual-after-offline-sync', 660);
    assert.equal((await movements()).length, latest.length);
    assert.deepEqual((await openingRef.get()).data(), openingBefore);
    record('Inscription hors connexion confirmée : un seul élève, prévu 600 → 660 sans clic ni perte du filtre, PDF à jour, caisse et ouverture inchangées');
  } catch (error) {
    if (page) {
      await page.screenshot({ path: `${output}/annual-failure.png`, fullPage: true }).catch(() => {});
      writeFileSync(`${output}/annual-visible-state.json`, JSON.stringify({ url: page.url(), text: await page.locator('body').innerText(), requestErrors }));
    }
    throw error;
  } finally { await context.close(); }
}
