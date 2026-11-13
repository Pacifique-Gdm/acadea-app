import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { allocationBalanceId } from '../api/_lib/feeAllocationRuntime.js';
import { expect } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Synthetic volume is explicitly separate from the real API/payment recipe.
 * No real school, secret, or asserted permission is accepted as a parameter. */
export async function runHostedAllocationVolume({ db, tag, schoolId, yearId, put, api, allocation, manifest, save, output, browser, user, adminUser, password, origin, record }) {
  assert.equal(db.projectId, 'acadea-staging'); assert.equal(schoolId, `${tag}-volume`);
  assert.equal(manifest.projectId, 'acadea-staging'); assert.ok(manifest.schools.includes(schoolId));
  const fee = `${tag}-volume-fee`, student = `${tag}-volume-student`, rubricId = 'f'.repeat(32);
  const times = [], sizes = [], transactionReads = [], attempts = [], started = performance.now();
  const thresholds = { sourcePage: 100, ledgerPage: 101, responseBytes: 700000, p95Ms: 15000, maxMs: 30000, reconciliationMs: 600000, exportMs: 120000 };
  writeFileSync(`${output}/volume-thresholds.json`, JSON.stringify(thresholds, null, 2));
  async function measured(body, role = 'volume-admin') {
    const start = performance.now(), data = await api(role, body), duration = performance.now() - start;
    const size = Buffer.byteLength(JSON.stringify(data)); times.push(duration); sizes.push(size);
    const metrics = data.metrics ?? data.ledger?.metrics;
    if (metrics) { transactionReads.push(metrics.transactionDocumentReads); attempts.push(metrics.transactionAttempts); }
    assert.ok(duration <= thresholds.maxMs, 'Durée maximale dépassée'); assert.ok(size <= thresholds.responseBytes, 'Réponse trop volumineuse');
    return data;
  }
  const advance = run => measured({ action: 'fee-allocation.advance-reconciliation', runId: run.id, sequence: run.sequence });
  async function scan() {
    let { run } = await allocation('start-reconciliation', {}, 'volume-admin');
    let sourceReads = 0;
    while (run.status === 'RUNNING') { const next = await advance(run); assert.ok(next.metrics.sourceReads <= thresholds.sourcePage);
      assert.ok(next.metrics.transactionDocumentReads <= 316 * next.metrics.transactionAttempts); sourceReads += next.metrics.sourceReads; run = next.run; }
    return { run, sourceReads };
  }
  await put('classes', `${tag}-volume-class`, { schoolId, schoolYearId: yearId, name: '1ère Primaire', section: 'Primaire', active: true });
  await put('feeTypes', fee, { schoolId, schoolYearId: yearId, name: 'Frais volume fictif', amount: 1000, className: '1ère Primaire', createdAt: new Date().toISOString() });
  await put('students', student, { schoolId, schoolYearId: yearId, nom: 'FICTIF VOLUME', className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', createdAt: new Date().toISOString() });
  await allocation('save-draft', { feeTypeId: fee, expectedRevision: 0, rubrics: [{ id: rubricId, name: 'Volume fictif', mode: 'percent', basisPoints: 10000 }] }, 'volume-admin');
  const prepared = await allocation('prepare-version', { feeTypeId: fee, expectedRevision: 1 }, 'volume-admin');
  await allocation('publish-configuration', { versionId: prepared.version.id }, 'volume-admin');
  const payment = await api('volume-cashier', { action: 'create-payment', schoolYearId: yearId, studentId: student, feeTypeId: fee, amount: 5, clientRequestId: randomUUID() });
  const sourceRef = db.doc(`payments/${payment.payment.id}`), source = await sourceRef.get();
  assert.equal(source.data().schoolId, schoolId); manifest.paths.push(sourceRef.path); save();
  // Only this API-created fictitious receipt is degraded to reproduce a legacy
  // missing-currency record; its immutable server receipt remains the evidence.
  const historical = { ...source.data(), currency: null, provenance: 'legacy-fixture' };
  await sourceRef.update({ currency: null, provenance: 'legacy-fixture' }, { lastUpdateTime: source.updateTime });
  const receipts = await db.collection('financialIdempotency').where('schoolId', '==', schoolId).get();
  const receipt = receipts.docs.find(d => d.data().result?.payment?.id === payment.payment.id); assert.ok(receipt);
  let blocked = await scan(); assert.equal(blocked.run.status, 'BLOCKED');
  const blockedView = await api('volume-admin', { action: 'fee-allocation.get-activation' });
  assert.equal(blockedView.reconciliation.id, blocked.run.id);
  assert.ok(blockedView.evidencePage.rows.some(row => row.id === payment.payment.id && row.reason));
  writeFileSync(`${output}/historical-view.json`, JSON.stringify(blockedView, null, 2));
  const proofContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  let proofTab;
  const proofCalls = [];
  try {
    const tab = await proofContext.newPage(); proofTab = tab; tab.setDefaultTimeout(60000);
    tab.on('response', response => {
      if (!response.url().endsWith('/api/manage-financial-transaction')) return;
      try { proofCalls.push({ action: response.request().postDataJSON()?.action, status: response.status() }); } catch { /* No credentials or bodies captured. */ }
    });
    await tab.goto(`${origin}/login`); await tab.getByPlaceholder('email@ecole.com').fill(adminUser.email);
    await tab.getByPlaceholder('Votre mot de passe').fill(password); await tab.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await tab.getByRole('button', { name: 'Menu', exact: true }).last().click();
    await tab.getByRole('button', { name: 'Répartition des frais', exact: true }).click();
    const panel = tab.getByRole('region', { name: 'Activation par établissement' });
    for (const [evidenceId, decision] of [[`${tag}-missing`, 'rejected'], [receipt.id, 'accepted']]) {
      // A wrapping label includes the select's option text in getByLabel's
      // exact match. The accessible combobox name remains stable and precise.
      await panel.getByRole('combobox', { name: 'Écriture bloquante', exact: true }).selectOption(`payments/${payment.payment.id}`);
      await panel.getByRole('textbox', { name: 'Référence de preuve', exact: true }).fill(evidenceId);
      await panel.getByRole('textbox', { name: 'Motif de justification', exact: true }).fill('Reçu serveur original de la fixture hébergée');
      const pending = tab.waitForResponse(response => {
        if (!response.url().endsWith('/api/manage-financial-transaction') || response.request().method() !== 'POST') return false;
        try { return response.request().postDataJSON()?.action === 'fee-allocation.justify-history'; } catch { return false; }
      });
      await panel.getByRole('button', { name: 'Vérifier et enregistrer la décision', exact: true }).click();
      const response = await pending; assert.equal(response.status(), 200); assert.equal((await response.json()).decision, decision);
      await expect(panel.getByText(decision === 'accepted' ? /Justification vérifiée et conservée/ : /Justification refusée/)).toBeVisible({ timeout: 45000 });
    }
    await tab.screenshot({ path: `${output}/justification-historique.png`, fullPage: true });
  } catch (error) {
    if (proofTab) {
      await proofTab.screenshot({ path: `${output}/justification-failure.png`, fullPage: true }).catch(() => {});
      const panel = proofTab.getByRole('region', { name: 'Activation par établissement' });
      writeFileSync(`${output}/justification-diagnostic.json`, JSON.stringify({ calls: proofCalls,
        panel: await panel.innerText({ timeout: 1000 }).catch(() => 'Panneau absent'),
        labels: await panel.locator('label').allTextContents().catch(() => []) }, null, 2));
    }
    throw error;
  } finally { await proofContext.close(); }
  assert.deepEqual((await sourceRef.get()).data(), historical, 'Une justification ne réécrit pas la source');
  record('Formulaire Administrateur hébergé : pièce absente refusée, reçu serveur lié accepté, original conservé');

  // Durable inventory precedes every bounded fixture batch. All records are new,
  // tagged and scoped, and retained/neutralized by the caller even on failure.
  async function synthetic(collection, rows) {
    for (let offset = 0; offset < rows.length; offset += 200) {
      const chunk = rows.slice(offset, offset + 200), batch = db.batch();
      for (const row of chunk) { assert.ok(row.id.startsWith(tag)); manifest.paths.push(`${collection}/${row.id}`); }
      save();
      for (const row of chunk) batch.create(db.doc(`${collection}/${row.id}`), { ...row, schoolId, fixtureId: tag, syntheticVolume: true });
      await batch.commit();
    }
  }
  await synthetic('payments', Array.from({ length: 3001 }, (_, i) => ({ id: `${tag}-volume-p-${String(i).padStart(5, '0')}`,
    schoolYearId: yearId, currency: 'USD', amount: 1, createdAt: new Date().toISOString(), provenance: 'financial-api', clientRequestIdHash: `synthetic-${i}`,
    studentId: `${tag}-synthetic-volume`, feeTypeId: `${tag}-synthetic-volume-fee` })));
  let { run } = await allocation('start-reconciliation', {}, 'volume-admin');
  const first = await advance(run), replay = await advance(run);
  assert.equal(replay.idempotent, true); assert.deepEqual(replay.run, first.run);
  // A legitimate hosted API write during the scan invalidates all pages.
  await api('volume-cashier', { action: 'create-payment', schoolYearId: yearId, studentId: student, feeTypeId: fee, amount: 1, clientRequestId: randomUUID() });
  await api('volume-admin', { action: 'fee-allocation.advance-reconciliation', runId: run.id, sequence: first.run.sequence }, 409);
  const scanStart = performance.now();
  ({ run } = await allocation('start-reconciliation', {}, 'volume-admin'));
  let sourceReads = 0;
  while (run.status === 'RUNNING') { const next = await advance(run); sourceReads += next.metrics.sourceReads; run = next.run;
    if (run.sequence === 2) { const reopened = await api('volume-admin', { action: 'fee-allocation.get-activation' }); assert.equal(reopened.reconciliation.sequence, 2); } }
  const reconciliationMs = performance.now() - scanStart;
  assert.ok(reconciliationMs <= thresholds.reconciliationMs); assert.equal(run.status, 'COMPLETE'); assert.equal(run.evidenceCount, 3003);
  assert.equal(sourceReads, 3004);
  const pages = await db.collection(`feeAllocationReconciliationRuns/${run.id}/pages`).get();
  const ids = pages.docs.flatMap(d => d.data().rows.filter(r => r.collection === 'payments').map(r => r.id));
  assert.equal(ids.length, 3003); assert.equal(new Set(ids).size, 3003);
  const opening = await allocation('prepare-opening', { cashCountMinor: 300700, lines: [{ rubricId, amountMinor: 300700 }], confirmation: 'RAPPROCHER LA CAISSE' }, 'volume-admin');
  await allocation('approve-opening', { openingId: opening.openingId, confirmation: 'APPROUVER LE RAPPROCHEMENT' }, 'volume-admin');
  await allocation('activate', { openingId: opening.openingId, confirmation: 'ACTIVER LA REPARTITION FICTIVE' }, 'volume-admin');
  record('Volume hébergé : 3 003 pièces, réponse perdue/reprise idempotente, concurrence invalidante, ouverture exacte');
  await synthetic('payments', Array.from({ length: 3001 }, (_, i) => ({ id: `${tag}-volume-post-${String(i).padStart(5, '0')}`,
    schoolYearId: yearId, collectionSchoolYearId: yearId, currency: 'USD', amount: 1, createdAt: new Date().toISOString(),
    provenance: 'financial-api', clientRequestIdHash: `synthetic-post-${i}`, studentId: `${tag}-synthetic-volume`, feeTypeId: fee })));
  await synthetic('feeAllocationMovements', Array.from({ length: 3001 }, (_, i) => ({ id: `${tag}-volume-m-${String(i).padStart(5, '0')}`,
    collectionSchoolYearId: yearId, currency: 'USD', sourceType: 'payment', type: 'receipt', sourceId: `${tag}-volume-post-${String(i).padStart(5, '0')}`,
    amountMinor: 100, lines: [{ rubricId, amountMinor: 100 }], postedAt: new Date().toISOString(), feeTypeId: fee, className: '1ère Primaire' })));
  const balanceRef = db.doc(`feeAllocationBalances/${allocationBalanceId(schoolId, yearId, 'USD', rubricId)}`), balance = await balanceRef.get();
  assert.equal(balance.data().schoolId, schoolId);
  await balanceRef.update({ receivedMinor: 300100, availableMinor: 600800 }, { lastUpdateTime: balance.updateTime });
  let page = await measured({ action: 'fee-allocation.get-workspace', schoolId }), movementReads = page.ledger.metrics.movementReads;
  const movements = [...page.ledger.movements], fingerprint = page.ledger.pagination.fingerprint;
  while (page.ledger.pagination.hasNext) {
    const prior = page.ledger.pagination;
    page = await measured({ action: 'fee-allocation.get-workspace', schoolId, ledgerPage: prior.page + 1, ledgerCursor: prior.nextCursor, ledgerFingerprint: fingerprint });
    assert.equal(page.ledger.pagination.fingerprint, fingerprint); assert.ok(page.ledger.metrics.movementReads <= 101);
    assert.ok(page.ledger.metrics.transactionDocumentReads <= 200 * page.ledger.metrics.transactionAttempts);
    movementReads += page.ledger.metrics.movementReads; movements.push(...page.ledger.movements);
  }
  assert.equal(movements.length, 3002); assert.equal(new Set(movements.map(m => m.id)).size, 3002);
  assert.ok(movementReads <= 3002 + Math.ceil(3002 / 100));
  assert.equal(movements.reduce((sum, m) => sum + m.amountMinor, 0), 600800);
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  try {
    const tab = await context.newPage(); tab.setDefaultTimeout(60000);
    await tab.goto(`${origin}/login`); await tab.getByPlaceholder('email@ecole.com').fill(user.email);
    await tab.getByPlaceholder('Votre mot de passe').fill(password); await tab.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await tab.getByRole('button', { name: 'Menu', exact: true }).last().click();
    await tab.getByRole('button', { name: 'Répartition des frais', exact: true }).click();
    await expect(tab.getByRole('button', { name: 'Exporter PDF', exact: true })).toBeEnabled({ timeout: 120000 });
    await expect(tab.getByText(/6[\s\u202f]008,00/).first()).toBeVisible({ timeout: 120000 });
    const exportStart = performance.now();
    await tab.getByRole('button', { name: /Exporter.*PDF/ }).click();
    await expect(tab.locator('[data-pdf-download]')).toHaveAttribute('href', /^blob:/, { timeout: 120000 });
    const bytes = new Uint8Array(await tab.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('[data-pdf-download]').href)).arrayBuffer()))));
    writeFileSync(`${output}/volume.pdf`, bytes);
    const pdf = await getDocument({ data: bytes.slice() }).promise; assert.ok(pdf.numPages >= 1);
    assert.ok(performance.now() - exportStart <= thresholds.exportMs);
    await tab.screenshot({ path: `${output}/volume-registre.png`, fullPage: true });
  } finally { await context.close(); }
  const sorted = [...times].sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * .95) - 1];
  assert.ok(p95 <= thresholds.p95Ms, 'p95 dépassé');
  writeFileSync(`${output}/volume-measurements.json`, JSON.stringify({ thresholds, sourceReads, movementReads, reconciliationMs,
    p95Ms: p95, maxMs: Math.max(...times), maxBytes: Math.max(...sizes), transactionReads, transactionAttempts: attempts,
    scope: 'SDK transaction document reads, excluding API auth/rate-limit and fixture setup', syntheticMovements: 3001,
    realApiHistoricalPayments: 2, durationMs: performance.now() - started }, null, 2));
  record('Registre hébergé : 3 002 mouvements, pages bornées, total exact, export authentifié complet et seuils mesurés');
}
