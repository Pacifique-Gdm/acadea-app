import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeAllocationFixture } from './feeAllocationLifecycle.test.js';
import { manageFeeAllocationLifecycle } from './feeAllocationLifecycle.js';
import { manageFeeAllocationPhase1 } from './feeAllocationPhase1.js';
import { manageFeeAllocationPhase2 } from './feeAllocationPhase2.js';
import { executeFinancialOperation } from './financialTransactions.js';
import { reconcileFixture } from './feeAllocationTestHelpers.js';

const admin = { uid: 'admin', role: 'school_admin', schoolId: 'school' }, cashier = { uid: 'cashier', role: 'cashier', schoolId: 'school' };
const at = '2026-11-13T10:00:00.000Z', publication = '2026-11-13T12:00:00.000Z';
let sequence = 0;
const lifecycle = (db, action, extra = {}, now = at, caller = admin) => manageFeeAllocationLifecycle({ db, caller, now, body: { action, requestId: `live-test-${++sequence}-request`, ...extra } });
async function liveSchool() {
  const db = completeAllocationFixture();
  await lifecycle(db, 'publish-configuration', { versionId: 'version' });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle(db, 'prepare-opening', { cashCountMinor: 0, lines: [{ rubricId: 'a'.repeat(32), amountMinor: 0 }], confirmation: 'RAPPROCHER LA CAISSE' });
  await lifecycle(db, 'approve-opening', { openingId: opening.openingId, confirmation: 'APPROUVER LE RAPPROCHEMENT' });
  await lifecycle(db, 'activate', { openingId: opening.openingId, confirmation: 'ACTIVER LA REPARTITION FICTIVE' });
  db.records.set('feeTypes/new-fee', { ...db.records.get('feeTypes/fee'), id: 'new-fee', name: 'Nouveau frais', createdAt: '2026-09-01T00:00:00.000Z' });
  return { db, opening };
}
const pay = (db, request, now, extra = {}) => executeFinancialOperation({ db, caller: cashier, now, body: {
  action: 'create-payment', schoolYearId: 'year', studentId: 'student', feeTypeId: 'new-fee', amount: 20, clientRequestId: request, ...extra,
} });
async function prepare(db) {
  await manageFeeAllocationPhase2({ db, caller: admin, body: { action: 'save-drafts', schoolYearId: 'year', baseFeeTypeId: 'new-fee', targets: [{ feeTypeId: 'new-fee', expectedRevision: 0 }],
    rubrics: [{ id: 'b'.repeat(32), name: 'Nouvelle rubrique', mode: 'percent', basisPoints: 5000 }], requestId: 'prepare-live-fee-draft' } });
  return (await manageFeeAllocationPhase1({ db, caller: admin, body: { action: 'prepare-version', feeTypeId: 'new-fee', expectedRevision: 1, requestId: 'prepare-live-fee-version' } })).version;
}
afterEach(() => vi.unstubAllEnvs());
describe('nouveau frais après activation, sans modifier les anciennes écritures', () => {
  it('continue les encaissements pendant le brouillon, publie puis conserve les anciens paiements et le rejeu', async () => {
    const { db, opening } = await liveSchool();
    const old = await pay(db, 'payment-before-publication', '2026-11-13T11:00:00.000Z');
    const version = await prepare(db);
    const second = await pay(db, 'payment-during-draft', '2026-11-13T11:30:00.000Z');
    const historical = new Map([...db.records].filter(([p]) => /^(payments|feeAllocationMovements|feeAllocationOpeningAudits|feeAllocationAnchors)\//.test(p)).map(([p,v]) => [p, structuredClone(v)]));
    const request = { action: 'publish-configuration', versionId: version.id, requestId: 'publish-live-fee-idempotent' };
    await manageFeeAllocationLifecycle({ db, caller: admin, body: request, now: publication });
    expect((await manageFeeAllocationLifecycle({ db, caller: admin, body: request, now: publication })).idempotent).toBe(true);
    for (const [path, value] of historical) expect(db.records.get(path)).toEqual(value);
    const next = await pay(db, 'payment-after-publication', '2026-11-13T12:30:00.000Z', { proposedAt: '2026-11-13T11:50:00.000Z' });
    const movements = [...db.records.values()].filter(v => v.sourceType === 'payment');
    expect(movements.find(v => v.sourceId === old.payment.id).configVersionId).toBeNull();
    expect(movements.find(v => v.sourceId === second.payment.id).configVersionId).toBeNull();
    expect(movements.find(v => v.sourceId === next.payment.id)).toMatchObject({ configVersionId: version.id, lines: expect.arrayContaining([{ rubricId: 'b'.repeat(32), amountMinor: 1000 }, { rubricId: 'UNALLOCATED', amountMinor: 1000 }]) });
    expect((await pay(db, 'payment-before-publication', '2026-11-13T13:00:00.000Z')).payment).toEqual(old.payment);
    expect(db.records.get(`feeAllocationOpeningAudits/${opening.openingId}`)).toEqual(historical.get(`feeAllocationOpeningAudits/${opening.openingId}`));
    expect([...db.records.values()].filter(v => v.sourceType === 'payment')).toHaveLength(3);
  });
  it('refuse les autres rôles et toute tentative de remplacement d’un frais déjà en service', async () => {
    const { db } = await liveSchool(), version = await prepare(db);
    await expect(lifecycle(db, 'publish-configuration', { versionId: version.id }, publication, cashier)).rejects.toMatchObject({ status: 403 });
    await lifecycle(db, 'publish-configuration', { versionId: version.id }, publication);
    const before = structuredClone([...db.records]);
    await expect(lifecycle(db, 'publish-configuration', { versionId: version.id }, publication)).rejects.toThrow();
    await expect(manageFeeAllocationPhase1({ db, caller: admin, body: { action: 'save-draft', feeTypeId: 'new-fee', expectedRevision: 1,
      rubrics: version.rubrics, requestId: 'forbidden-live-rewrite' } })).rejects.toThrow('déjà réparti');
    expect([...db.records]).toEqual(before);
  });
});
