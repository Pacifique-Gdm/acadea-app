import { describe, expect, it } from 'vitest';
import { completeAllocationFixture } from './feeAllocationLifecycle.test.js';
import { manageAllocationReconciliation } from './feeAllocationReconciliation.js';
import { manageFeeAllocationLifecycle } from './feeAllocationLifecycle.js';
import { reconcileFixture, markFixtureFinancialChange } from './feeAllocationTestHelpers.js';
import { executeFinancialOperation } from './financialTransactions.js';
import { resolveRecordedCurrency } from './cashBalance.js';

const now = '2026-11-13T10:00:00.000Z', admin = { uid: 'admin', schoolId: 'school', role: 'school_admin' };
const call = (db, action, body = {}, caller = admin) => manageAllocationReconciliation({ db, caller, now, body: { action, ...body } });
const advance = (db, run) => call(db, 'advance-reconciliation', { runId: run.id, sequence: run.sequence });
const publish = db => manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action: 'publish-configuration', versionId: 'version', requestId: 'publish-test-request' } });
const legacy = { id: 'legacy', schoolId: 'school', schoolYearId: 'year', studentId: 'student', feeTypeId: 'fee', amount: 25 };

describe('rapprochement borné, reprenable et preuve historique', () => {
  it('reprend 3001 pièces avec une réponse perdue, sans recopier ni doubler une page', async () => {
    const db = completeAllocationFixture(); await publish(db);
    for (let i = 0; i < 3001; i++) db.records.set(`payments/p${String(i).padStart(5, '0')}`, {
      schoolId: 'school', schoolYearId: 'year', currency: 'USD', amount: 1, createdAt: now,
      provenance: 'financial-api', clientRequestIdHash: `p${i}`,
    });
    let { run } = await call(db, 'start-reconciliation', { requestId: 'resume-3001-request' });
    const first = await advance(db, run), afterFirst = structuredClone([...db.records]);
    expect((await advance(db, run)).idempotent).toBe(true); expect([...db.records]).toEqual(afterFirst);
    run = first.run;
    db.interrupt = true;
    await expect(advance(db, run)).rejects.toThrow('interruption'); expect([...db.records]).toEqual(afterFirst);
    db.interrupt = false;
    let reads = first.metrics.sourceReads;
    while (run.status === 'RUNNING') { const result = await advance(db, run); expect(result.metrics.sourceReads).toBeLessThanOrEqual(100); reads += result.metrics.sourceReads; run = result.run; }
    expect(run).toMatchObject({ status: 'COMPLETE', evidenceCount: 3001, blockedCount: 0, pageCount: 34 });
    expect(reads).toBe(3002); // 3001 receipts + one configuration, not repeated history.
    const stored = db.records.get(`feeAllocationReconciliationRuns/${run.id}`);
    expect(stored.receivedMinor).toBe(300100);
    const pages = [...db.records].filter(([path]) => path.startsWith(`feeAllocationReconciliationRuns/${run.id}/pages/`));
    const ids = pages.flatMap(([, page]) => page.rows.filter(r => r.collection === 'payments').map(r => r.id));
    expect(new Set(ids).size).toBe(3001);
    const prepared = await manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action: 'prepare-opening', requestId: 'prepare-large-request',
      cashCountMinor: 300100, lines: [{ rubricId: 'a'.repeat(32), amountMinor: 300100 }], confirmation: 'RAPPROCHER LA CAISSE' } });
    expect(db.records.get(`feeAllocationOpeningAudits/${prepared.openingId}`).evidenceRunId).toBe(run.id);
  });
  it('invalide une interruption après un paiement réel du handler et refuse toute approbation partielle', async () => {
    const db = completeAllocationFixture(); await publish(db);
    const { run } = await call(db, 'start-reconciliation', { requestId: 'concurrent-request' });
    await expect(manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action: 'prepare-opening', requestId: 'prepare-incomplete', cashCountMinor: 0,
      lines: [{ rubricId: 'a'.repeat(32), amountMinor: 0 }], confirmation: 'RAPPROCHER LA CAISSE' } })).rejects.toThrow('complet');
    await executeFinancialOperation({ db, caller: { uid: 'cashier', schoolId: 'school', role: 'cashier' }, now, body: {
      action: 'create-payment', studentId: 'student', feeTypeId: 'fee', schoolYearId: 'year', amount: 25, clientRequestId: 'concurrent-payment' } });
    await expect(advance(db, run)).rejects.toMatchObject({ code: 'allocation-stale' });
    expect((await reconcileFixture(db)).status).toBe('COMPLETE');
    expect([...db.records.values()].filter(m => m.sourceType === 'opening')).toHaveLength(0);
  });
  it('justifie une devise historique par un reçu lié, conserve les originaux et refuse une preuve altérée', async () => {
    const db = completeAllocationFixture(); await publish(db);
    db.records.set('payments/legacy', { ...legacy });
    db.records.set('financialIdempotency/receipt', { schoolId: 'school', result: { payment: { ...legacy, currency: 'USD', createdAt: now } } });
    expect((await reconcileFixture(db)).status).toBe('BLOCKED');
    const body = { requestId: 'justify-legacy-request', collection: 'payments', sourceId: 'legacy', evidenceType: 'financialIdempotency', evidenceId: 'receipt', reason: 'Reçu serveur associé vérifié' };
    expect((await call(db, 'justify-history', body)).decision).toBe('accepted');
    expect((await call(db, 'justify-history', body)).idempotent).toBe(true);
    expect(db.records.get('payments/legacy')).toEqual(legacy);
    expect((await reconcileFixture(db)).status).toBe('COMPLETE');
    expect(await resolveRecordedCurrency(legacy, { db, documentId: 'legacy', collection: 'payments' })).toBe('USD');
    db.records.get('financialIdempotency/receipt').result.payment.amount = 26;
    markFixtureFinancialChange(db);
    expect((await reconcileFixture(db)).status).toBe('BLOCKED');
    await expect(resolveRecordedCurrency(legacy, { db, documentId: 'legacy', collection: 'payments' })).rejects.toThrow('inconnue');
  });
  it.each(['missing', 'foreign', 'wrong-amount', 'other-source', 'reused'])('refuse une preuve %s sans modifier la source', async kind => {
    const db = completeAllocationFixture(); db.records.set('payments/legacy', { ...legacy });
    const receipt = { schoolId: 'school', result: { payment: { ...legacy, currency: 'USD', createdAt: now } } };
    if (kind === 'foreign') receipt.schoolId = 'other';
    if (kind === 'wrong-amount') receipt.result.payment.amount++;
    if (kind === 'other-source') receipt.result.payment.id = 'other';
    if (kind !== 'missing') db.records.set('financialIdempotency/receipt', receipt);
    if (kind === 'reused') {
      const { allocationHash } = await import('./feeAllocationRuntime.js');
      db.records.set(`feeAllocationEvidenceClaims/${allocationHash(['financialIdempotency', 'receipt'])}`, { sourcePath: 'payments/other' });
    }
    expect((await call(db, 'justify-history', { requestId: `reject-${kind}-request`, collection: 'payments', sourceId: 'legacy',
      evidenceType: 'financialIdempotency', evidenceId: 'receipt', reason: 'Pièce candidate fictive' })).decision).toBe('rejected');
    expect(db.records.get('payments/legacy')).toEqual(legacy);
    expect((await reconcileFixture(db)).status).toBe('BLOCKED');
  });
  it('refuse un autre établissement, un caissier, des champs injectés et une séquence future', async () => {
    const db = completeAllocationFixture();
    for (const caller of [{ ...admin, schoolId: 'other' }, { ...admin, role: 'cashier' }])
      await expect(call(db, 'start-reconciliation', { requestId: 'scope-test-request' }, caller)).rejects.toMatchObject({ status: 403 });
    await expect(call(db, 'start-reconciliation', { requestId: 'scope-test-request', schoolId: 'other' })).rejects.toMatchObject({ status: 400 });
    const { run } = await call(db, 'start-reconciliation', { requestId: 'scope-test-request' });
    await expect(advance(db, { ...run, sequence: 2 })).rejects.toThrow('incorrecte');
    await publish(db);
    await expect(advance(db, run)).rejects.toMatchObject({ code: 'allocation-stale' });
  });
  it('refuse la reprise d’un travail remplacé même si les pièces sont inchangées', async () => {
    const db = completeAllocationFixture();
    const first = (await call(db, 'start-reconciliation', { requestId: 'first-run-request' })).run;
    await call(db, 'start-reconciliation', { requestId: 'second-run-request' });
    await expect(advance(db, first)).rejects.toMatchObject({ code: 'allocation-stale' });
  });
  it('résout une ancienne étiquette de devise invalide uniquement avec le reçu serveur concordant', async () => {
    const db = completeAllocationFixture();
    db.records.set('payments/legacy', { ...legacy, currency: 'inconnue' });
    db.records.set('financialIdempotency/receipt', { schoolId: 'school', result: { payment: { ...legacy, currency: 'USD', createdAt: now } } });
    const result = await call(db, 'justify-history', { requestId: 'invalid-currency-proof', collection: 'payments', sourceId: 'legacy',
      evidenceType: 'financialIdempotency', evidenceId: 'receipt', reason: 'Reçu original concordant' });
    expect(result.decision).toBe('accepted');
    expect(db.records.get('payments/legacy').currency).toBe('inconnue');
    expect(await resolveRecordedCurrency(db.records.get('payments/legacy'), { db, documentId: 'legacy', collection: 'payments' })).toBe('USD');
    expect((await reconcileFixture(db)).status).toBe('COMPLETE');
  });
});
