import { describe, expect, it } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { readAllocationActivation } from "./feeAllocationActivationView.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { reconcileFixture, markFixtureFinancialChange } from './feeAllocationTestHelpers.js';
import { manageAllocationReconciliation } from './feeAllocationReconciliation.js';

const now = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32);
const admin = { uid: "admin", schoolId: "school", role: "school_admin" };
const view = (db, body = {}, caller = admin) => readAllocationActivation({ db, caller, now, body: { action: "get-activation", ...body } });
const mutate = async (db, action, body = {}) => {
  if (action === 'prepare-opening') await reconcileFixture(db);
  return manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action, requestId: `view-test-${action}`, ...body } });
};

describe("consultation sécurisée du cycle d'activation", () => {
  it("résume 36 sources et retrouve la paie bloquée hors de la page affichée sans modifier l'original", async () => {
    const db = completeAllocationFixture();
    // 34 payments + one expense + one existing configuration = 36 sources.
    for (let i = 0; i < 34; i++) db.records.set(`payments/p${i}`, {
      schoolId: 'school', schoolYearId: 'year', amount: 2, currency: 'USD', createdAt: now,
      provenance: 'financial-api', clientRequestIdHash: `request-${i}`,
    });
    db.records.set('expenses/payroll', { schoolId: 'school', schoolYearId: 'year', amount: 12,
      provenance: 'personnel-payroll', personnelPaymentId: 'salary' });
    db.records.set('personnelPayments/salary', { schoolId: 'school', schoolYearId: 'year', expenseId: 'payroll',
      netPaid: 12, currency: 'USD', createdAt: now, beneficiaryName: 'NEVER EXPOSE' });
    await reconcileFixture(db);
    const before = structuredClone([...db.records]);
    const first = await view(db);
    expect(first.reconciliation).toMatchObject({ scanned: 36, blockedCount: 1, status: 'BLOCKED' });
    expect(first.evidencePage.rows.every(row => !row.reason)).toBe(true);
    expect(first.singleBlocker).toMatchObject({ nature: 'Paiement de personnel', amountMinor: 1200,
      currency: null, createdAt: null, reason: 'Date ou devise non justifiée' });
    const blocked = await view(db, { blockedOnly: true });
    expect(blocked.evidencePage.page).toBeGreaterThan(0);
    expect(blocked.evidencePage.rows).toHaveLength(1);
    const proofs = await view(db, { action: 'get-history-proofs', collection: 'expenses', sourceId: 'payroll' });
    expect(proofs.candidates).toEqual([{ type: 'personnelPayments', id: 'salary', nature: 'Paie liée',
      amount: 12, currency: 'USD', createdAt: now, receiptNumber: null }]);
    expect(JSON.stringify(proofs)).not.toContain('NEVER EXPOSE');
    expect([...db.records]).toEqual(before);
    const original = structuredClone(db.records.get('expenses/payroll'));
    const justify = evidenceId => manageAllocationReconciliation({ db, caller: admin, now, body: {
      action: 'justify-history', requestId: `proof-choice-${evidenceId}`, collection: 'expenses', sourceId: 'payroll',
      evidenceType: 'personnelPayments', evidenceId, reason: 'Paie liée vérifiée dans le test isolé',
    } });
    expect((await justify('missing')).decision).toBe('rejected');
    expect((await justify('salary')).decision).toBe('accepted');
    expect((await justify('salary')).idempotent).toBe(true);
    expect(db.records.get('expenses/payroll')).toEqual(original);
    await reconcileFixture(db);
    expect((await view(db)).reconciliation.blockedCount).toBe(0);
  });
  it("refuse les suggestions étrangères, les rôles non autorisés et les paramètres injectés", async () => {
    const db = completeAllocationFixture();
    db.records.set('expenses/foreign', { schoolId: 'foreign', schoolYearId: 'year', amount: 12 });
    const body = { action: 'get-history-proofs', collection: 'expenses', sourceId: 'foreign' };
    await expect(view(db, body)).rejects.toMatchObject({ status: 403 });
    await expect(view(db, body, { ...admin, role: 'cashier' })).rejects.toMatchObject({ status: 403 });
    await expect(view(db, { ...body, schoolId: 'foreign' })).rejects.toMatchObject({ status: 400 });
    await expect(view(db, { ...body, sourceId: '../foreign' })).rejects.toMatchObject({ status: 400 });
    await expect(view(db, { blockedOnly: 'true' })).rejects.toMatchObject({ status: 400 });
  });
  it("ne crée rien en consultant ; expose les pièces paginées et leur somme exhaustive", async () => {
    const db = completeAllocationFixture();
    for (let i = 0; i < 251; i++) db.records.set(`payments/p${String(i).padStart(4, "0")}`, {
      schoolId: "school", schoolYearId: "year", amount: 2, currency: "USD", createdAt: now,
      provenance: "financial-api", clientRequestIdHash: `request-${i}`, studentId: "never-return-student",
    });
    await reconcileFixture(db);
    const before = structuredClone([...db.records]);
    const first = await view(db);
    expect(first.inventory).toMatchObject({ evidenceCount: 251, schoolAvailableMinor: 50200, cashAvailableMinor: 50200, hasNext: true });
    expect(first.inventory.evidence).toHaveLength(100);
    expect(JSON.stringify(first)).not.toContain("never-return-student");
    const second = await view(db, { page: 1, fingerprint: first.inventory.fingerprint });
    expect(second.inventory.evidence).toHaveLength(100); expect(second.inventory.hasNext).toBe(true);
    expect((await view(db, { page: 2, fingerprint: first.inventory.fingerprint })).inventory.evidence).toHaveLength(51);
    expect([...db.records]).toEqual(before);
    db.records.get("payments/p0000").amount = 3;
    markFixtureFinancialChange(db);
    await expect(view(db, { page: 1, fingerprint: first.inventory.fingerprint })).rejects.toThrow("pièces ont changé");
  });
  it("retrouve une proposition après réouverture et invalide son approbation si les pièces changent", async () => {
    const db = completeAllocationFixture();
    await mutate(db, "publish-configuration", { versionId: "version" });
    const result = await mutate(db, "prepare-opening", { confirmation: "RAPPROCHER LA CAISSE", cashCountMinor: 0, lines: [{ rubricId, amountMinor: 0 }] });
    expect((await view(db)).opening).toMatchObject({ id: result.openingId, stale: false, status: "proposed" });
    await mutate(db, "approve-opening", { confirmation: "APPROUVER LE RAPPROCHEMENT", openingId: result.openingId });
    expect((await view(db)).opening).toMatchObject({ stale: false, status: "approved", approvedByCurrentUser: true });
    db.records.set("payments/new", { schoolId: "school", schoolYearId: "year", amount: 1, currency: "USD", createdAt: now, provenance: "financial-api", clientRequestIdHash: "new" });
    markFixtureFinancialChange(db);
    expect((await view(db)).opening.stale).toBe(true);
    await expect(mutate(db, "activate", { openingId: result.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" })).rejects.toThrow("refaire le rapprochement");
  });
  it.each(["cashier", "coordination_admin", "sub_coordination_admin", "parent"])("refuse l'accès aux pièces de préparation au rôle %s", async role => {
    const db = completeAllocationFixture();
    await expect(view(db, {}, { ...admin, role })).rejects.toMatchObject({ status: 403 });
  });
  it("refuse les scopes injectés et les profils suspendus", async () => {
    const db = completeAllocationFixture();
    await expect(view(db, { schoolId: "other" })).rejects.toMatchObject({ status: 400 });
    db.records.get("users/admin").status = "suspended";
    await expect(view(db)).rejects.toMatchObject({ status: 403 });
  });
  it("n'active pas une caisse ni un montant sans provenance certaine", async () => {
    const db = completeAllocationFixture();
    db.records.set("payments/legacy", { schoolId: "school", schoolYearId: "year", amount: 9, currency: "USD", createdAt: now });
    await reconcileFixture(db);
    const result = await view(db);
    expect(result.inventory).toBeNull();
    expect(result.reconciliation.status).toBe('BLOCKED');
    expect(result.evidencePage.rows[0].reason).toContain('Provenance serveur');
    expect([...db.records.keys()].some(k => k.startsWith("feeAllocationMovements/"))).toBe(false);
  });
});
