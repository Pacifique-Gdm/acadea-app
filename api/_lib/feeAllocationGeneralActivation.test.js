import { describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle, getAllocationSpendOptions } from "./feeAllocationLifecycle.js";
import { readOperationalAllocation, allocationBalanceId } from "./feeAllocationRuntime.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from './feeAllocationTestHelpers.js';

const now = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32);
const admin = { uid: "admin", role: "school_admin", schoolId: "school" };
const cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
function ordinarySchool(project = "acadea-staging") {
  const db = completeAllocationFixture(); db.projectId = project;
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", ""); vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
  delete db.records.get("schools/school").fixtureId;
  for (const key of db.records.keys()) if (key.startsWith("feeAllocationTestScopes/")) db.records.delete(key);
  return db;
}
const action = async (db, action, extra = {}, caller = admin) => {
  if (action === 'prepare-opening') await reconcileFixture(db, caller, now);
  return manageFeeAllocationLifecycle({ db, caller, now, body: { action, requestId: `general-${action}-request`, ...extra } });
};
async function approved(db) {
  await action(db, "publish-configuration", { versionId: "version" });
  const p = await action(db, "prepare-opening", { cashCountMinor: 0, lines: [{ rubricId, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await action(db, "approve-opening", { openingId: p.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  return p;
}
describe("activation ordinaire sans inscription de fixture (base en mémoire)", () => {
  it.each(["acadea-staging", "acadea-production"])("%s exige le cycle explicite, sans activation au déploiement", async project => {
    const db = ordinarySchool(project);
    expect(await readOperationalAllocation({ db, schoolId: "school", schoolYearId: "year", currency: "USD", now })).toBeNull();
    const p = await approved(db);
    await expect(action(db, "activate", { openingId: p.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" })).rejects.toThrow();
    const result = await action(db, "activate", { openingId: p.openingId, confirmation: "ACTIVER LA REPARTITION DE MON ETABLISSEMENT" });
    expect(result.testOnly).toBe(false);
    const state = await readOperationalAllocation({ db, schoolId: "school", schoolYearId: "year", currency: "USD", now });
    expect(state).toMatchObject({ status: "ACTIVE", testOnly: false });
    expect((await getAllocationSpendOptions({ db, caller: cashier, body: {}, now })).required).toBe(true);
    await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 100, clientRequestId: "general-payment-001" } });
    expect([...db.records.values()].filter(m => m.sourceType === "payment")).toHaveLength(1);
    expect([...db.records.values()].find(m => m.sourceType === "payment").testOnly).toBe(false);
  });
  it.each(["inactive", "disabled", "suspended", "deleted"])("refuse le profil %s sans écritures", async status => {
    const db = ordinarySchool(); db.records.get("users/admin").status = status;
    const before = structuredClone([...db.records]);
    await expect(action(db, "publish-configuration", { versionId: "version" })).rejects.toMatchObject({ status: 403 });
    expect([...db.records]).toEqual(before);
  });
  it("refuse l'administrateur étranger, le caissier et une preuve d'activation absente", async () => {
    const db = ordinarySchool();
    for (const caller of [cashier, { ...admin, schoolId: "foreign" }]) await expect(action(db, "publish-configuration", { versionId: "version" }, caller)).rejects.toThrow();
    const p = await approved(db);
    await action(db, "activate", { openingId: p.openingId, confirmation: "ACTIVER LA REPARTITION DE MON ETABLISSEMENT" });
    db.records.delete(`feeAllocationOpeningAudits/${p.openingId}`);
    await expect(readOperationalAllocation({ db, schoolId: "school", schoolYearId: "year", currency: "USD", now })).rejects.toThrow("Preuve");
  });
  it("conserve le circuit historique d'une école non activée", async () => {
    const db = ordinarySchool();
    await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 100, clientRequestId: "inactive-payment-001" } });
    expect([...db.records.keys()].some(k => k.startsWith("feeAllocationMovements/"))).toBe(false);
  });
  it("interdit les fixtures en Production même si le marqueur semble valide", async () => {
    const db = ordinarySchool("acadea-production"); db.records.get("schools/school").fixtureId = `e2e-allocation-${"b".repeat(32)}`;
    await expect(action(db, "publish-configuration", { versionId: "version" })).rejects.toMatchObject({ code: "test-scope-required" });
  });
  it("une obligation ancienne sans liaison approuvée ne reçoit pas la version actuelle", async () => {
    const db = ordinarySchool();
    db.records.get("students/student").createdAt = "2026-09-01T00:00:00.000Z";
    db.records.get("feeTypes/fee").createdAt = "2026-09-01T00:00:00.000Z";
    const p = await approved(db);
    await action(db, "activate", { openingId: p.openingId, confirmation: "ACTIVER LA REPARTITION DE MON ETABLISSEMENT" });
    delete db.records.get(`feeAllocationOpeningAudits/${p.openingId}`).receiptVersions;
    delete db.records.get(`feeAllocationOpeningAudits/${p.openingId}`).receiptVersionsRunId;
    const before = structuredClone([...db.records]);
    await expect(executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: {
      action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 100, clientRequestId: "legacy-obligation-001",
    } })).rejects.toThrow("postérieure à l'obligation");
    expect([...db.records]).toEqual(before);
  });
  it("affecte seulement les nouveaux encaissements approuvés d'un tarif historique, sans doubler l'ouverture", async () => {
    const db = ordinarySchool(), past = "2026-09-01T00:00:00.000Z";
    db.records.get("students/student").createdAt = past; db.records.get("feeTypes/fee").createdAt = past;
    const old = { id: "historical", schoolId: "school", schoolYearId: "year", studentId: "student", feeTypeId: "fee",
      amount: 30, currency: "USD", createdAt: past, provenance: "financial-api", clientRequestIdHash: "historical-provenance" };
    db.records.set("payments/historical", structuredClone(old));
    await action(db, "publish-configuration", { versionId: "version" });
    const p = await action(db, "prepare-opening", { cashCountMinor: 3000, lines: [{ rubricId, amountMinor: 2400 }, { rubricId: "UNALLOCATED", amountMinor: 600 }], confirmation: "RAPPROCHER LA CAISSE" });
    await action(db, "approve-opening", { openingId: p.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
    await action(db, "activate", { openingId: p.openingId, confirmation: "ACTIVER LA REPARTITION DE MON ETABLISSEMENT" });
    const args = { db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 70, clientRequestId: "historical-remainder-001" } };
    await executeFinancialOperation(args);
    expect((await executeFinancialOperation(args)).idempotent).toBe(true);
    expect(db.records.get("payments/historical")).toEqual(old);
    expect(db.records.get(`feeAllocationBalances/${allocationBalanceId("school", "year", "USD", rubricId)}`)).toMatchObject({ openingMinor: 2400, receivedMinor: 5600, availableMinor: 8000 });
    expect([...db.records.values()].filter(m => m.sourceType === "payment")).toHaveLength(1);
    expect([...db.records.values()].find(a => a.allocationBasis === "approved-post-cutoff-receipts").approvalOpeningId).toBe(p.openingId);
  });
});
