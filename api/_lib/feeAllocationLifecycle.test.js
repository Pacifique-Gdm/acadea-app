import { afterEach, describe, expect, it, vi } from "vitest";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { allocationStateId, allocationBalanceId, readAllocationTestScope } from "./feeAllocationRuntime.js";
import { feeAllocationConfigId } from "./feeAllocationPhase1.js";
import { validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { createPersonnelPayment } from "./personnelPayroll.js";
import { reconcileFixture, markFixtureFinancialChange } from './feeAllocationTestHelpers.js';

const now = "2026-11-13T10:00:00.000Z", later = "2026-11-13T11:00:00.000Z";
const rubricId = "a".repeat(32), fixtureId = `e2e-allocation-${"b".repeat(32)}`;
const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
afterEach(() => vi.unstubAllEnvs());
export function completeAllocationFixture() {
  vi.stubEnv("ACADEA_E2E_LOCAL_EMULATORS", "YES"); vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080"); vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
  for (const key of ["VERCEL", "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SERVICE_ACCOUNT_JSON"]) vi.stubEnv(key, "");
  const configId = feeAllocationConfigId("school", "year", "fee"), rubrics = [{ id: rubricId, name: "Fonctionnement", mode: "percent", basisPoints: 8000 }];
  const records = new Map(Object.entries({
    "schools/school": { id: "school", name: "Fixture", fixtureId, status: "active", activeSchoolYearId: "year", currency: "USD" },
    "schoolYears/year": { id: "year", schoolId: "school", name: "2026-2027", status: "active", currency: "USD" },
    "users/admin": { ...admin, active: true }, "users/cashier": { ...cashier, active: true },
    "users/teacher": { schoolId: "school", role: "teacher", active: true, name: "Fictif" },
    [`feeAllocationTestScopes/${fixtureId}`]: { projectId: "demo-acadea", fixtureId, schoolIds: ["school"], status: "active", createdAt: "2026-11-13T00:00:00.000Z", expiresAt: "2026-11-14T00:00:00.000Z" },
    "feeTypes/fee": { id: "fee", schoolId: "school", schoolYearId: "year", name: "Minerval", amount: 100, className: "1ère", createdAt: later },
    "students/student": { id: "student", schoolId: "school", schoolYearId: "year", className: "1ère", status: "ACTIVE", createdAt: later },
    [`feeAllocationConfigs/${configId}`]: { id: configId, schoolId: "school", schoolYearId: "year", feeTypeId: "fee", draftRevision: 1 },
    "feeAllocationVersions/version": { id: "version", configId, schoolId: "school", schoolYearId: "year", feeTypeId: "fee", className: "1ère", currency: "USD", version: 1, feeAmountMinor: 10000, status: "prepared", effectiveFrom: null, rubrics, shares: validateFeeAllocationRubrics(rubrics, 10000).shares },
  }));
  const snapshot = path => ({ id: path.split("/").at(-1), exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const query = (collection, filters = [], limit = Infinity, after = "") => ({ where: (k, op, v) => { expect(op).toBe("=="); return query(collection, [...filters, [k, v]], limit, after); },
    orderBy: () => query(collection, filters, limit, after), startAfter: doc => query(collection, filters, limit, typeof doc === 'string' ? doc : doc.id),
    limit: n => query(collection, filters, n, after), get: async () => ({ docs: [...records].filter(([p, d]) => p.startsWith(`${collection}/`) && p.split("/").length === collection.split('/').length + 1 && p.split("/").at(-1) > after && filters.every(([k, v]) => d[k] === v)).sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit).map(([p]) => snapshot(p)) }) });
  const db = { projectId: "demo-acadea", records, doc: path => ({ path, id: path.split("/").at(-1), get: async () => snapshot(path) }), collection: query,
    runTransaction: async fn => {
      let writing = false; const changes = [];
      const write = (op, ref, data) => { writing = true; if (op === "create" && records.has(ref.path)) throw Error("already exists"); changes.push([op, ref.path, data]); };
      const result = await fn({ get: async ref => { if (writing) throw Error("read after write"); return ref.path ? snapshot(ref.path) : ref.get(); },
        create: (r, d) => write("create", r, d), update: (r, d) => write("update", r, d), set: (r, d, options) => write(options?.merge ? "update" : "set", r, d), delete: r => write("delete", r) });
      if (db.interrupt) throw Error("interruption");
      changes.forEach(([op, p, d]) => op === "delete" ? records.delete(p) : records.set(p, op === "update" ? { ...records.get(p), ...d } : d));
      return result;
    } };
  return db;
}
const action = async (db, actionName, extra = {}, caller = admin) => {
  if (actionName === 'prepare-opening') await reconcileFixture(db, caller, now);
  return manageFeeAllocationLifecycle({ db, caller, now, body: { action: actionName, requestId: `request-${actionName}-001`, ...extra } });
};
async function activate(db) {
  await action(db, "publish-configuration", { versionId: "version" });
  const opening = await action(db, "prepare-opening", { cashCountMinor: 0, lines: [{ rubricId, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await action(db, "approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  return action(db, "activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
}
const pay = (db, extra = {}) => executeFinancialOperation({ db, caller: cashier, now: later, body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 100, clientRequestId: "payment-request-001", ...extra } });
const spend = (db, extra = {}) => executeFinancialOperation({ db, caller: cashier, now: later, body: { action: "create-expense", schoolYearId: "year", amount: 20, category: "Fournitures", description: "Papier", beneficiary: "Fictif", paymentMethod: "Espèces", allocationRubricId: rubricId, clientRequestId: "expense-request-001", ...extra } });
const balance = db => db.records.get(`feeAllocationBalances/${allocationBalanceId("school", "year", "USD", rubricId)}`);
const movements = db => [...db.records].filter(([p]) => p.startsWith("feeAllocationMovements/"));

describe("activation isolée, ouverture prouvée et dépenses", () => {
  it("accepte les clés de maps réordonnées par Firestore, jamais un montant altéré", async () => {
    const db = completeAllocationFixture();
    const version = db.records.get("feeAllocationVersions/version");
    version.shares = version.shares.map(({ rubricId, amountMinor }) => ({ amountMinor, rubricId }));
    await expect(action(db, "publish-configuration", { versionId: "version" })).resolves.toMatchObject({ versionId: "version" });
    const invalid = completeAllocationFixture();
    invalid.records.get("feeAllocationVersions/version").shares[0].amountMinor += 1;
    await expect(action(invalid, "publish-configuration", { versionId: "version" })).rejects.toThrow("incohérente");
  });
  it("publication, rapprochement, activation idempotente, encaissement et dépense atomiques", async () => {
    const db = completeAllocationFixture(); const result = await activate(db);
    expect((await action(db, "activate", { openingId: result.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" })).idempotent).toBe(true);
    expect(movements(db)).toHaveLength(1);
    await pay(db); const expense = await spend(db);
    expect(balance(db)).toMatchObject({ openingMinor: 0, receivedMinor: 8000, spentMinor: 2000, availableMinor: 6000 });
    expect((await spend(db)).idempotent).toBe(true); expect(movements(db)).toHaveLength(3);
    await executeFinancialOperation({ db, caller: admin, now: later, body: { action: "update-expense", transactionId: expense.expense.id, amount: 10, category: "Fournitures", description: "Correction", reason: "Test", clientRequestId: "expense-correct-001" } });
    expect(balance(db).availableMinor).toBe(7000);
    await executeFinancialOperation({ db, caller: admin, now: later, body: { action: "delete-expense", transactionId: expense.expense.id, reason: "Test", clientRequestId: "expense-delete-001" } });
    expect(balance(db).availableMinor).toBe(8000); expect(movements(db)).toHaveLength(5);
  });
  it("salaire et prime imputent seulement le net via la dépense liée, une fois", async () => {
    const db = completeAllocationFixture(); await activate(db); await pay(db);
    const body = { action: "create-personnel-payment", schoolYearId: "year", beneficiaryId: "teacher", kind: "salary", periodMonth: 11, periodYear: 2026, paidAt: "2026-11-13", amount: 30, deduction: 5, deductionReason: "Fictif", cnss: 2, tax: 3, recoveries: [], description: "Test", allocationRubricId: rubricId, clientRequestId: "salary-request-001" };
    await createPersonnelPayment({ db, caller: cashier, body, now: later });
    expect((await createPersonnelPayment({ db, caller: cashier, body, now: later })).idempotent).toBe(true);
    expect(balance(db).spentMinor).toBe(2000);
    await createPersonnelPayment({ db, caller: cashier, body: { ...body, kind: "bonus", amount: 15, deduction: 0, cnss: 0, tax: 0, clientRequestId: "bonus-request-001" }, now: later });
    expect(balance(db).spentMinor).toBe(3500); expect(movements(db)).toHaveLength(4);
  });
  it("refuse rubrique étrangère, absence de rubrique, solde insuffisant et pause sans écritures", async () => {
    const db = completeAllocationFixture(); await activate(db); await pay(db);
    for (const extra of [{ allocationRubricId: "b".repeat(32) }, { allocationRubricId: undefined }, { amount: 90 }]) {
      const before = structuredClone([...db.records]); await expect(spend(db, extra)).rejects.toThrow(); expect([...db.records]).toEqual(before);
    }
    await action(db, "pause", { reason: "Test de suspension" });
    await expect(spend(db)).rejects.toMatchObject({ code: "allocation-paused" });
    await expect(pay(db, { clientRequestId: "new-payment-request-001", amount: 1 })).rejects.toThrow();
    await action(db, "resume", { reason: "Test de reprise" }); await spend(db);
  });
  it("ne crée aucune écriture partielle en cas d'interruption", async () => {
    const db = completeAllocationFixture(); await activate(db); await pay(db); const before = structuredClone([...db.records]); db.interrupt = true;
    await expect(spend(db)).rejects.toThrow("interruption"); expect([...db.records]).toEqual(before);
  });
  it("refuse activation Production, école réelle, périmètre expiré et rôle non administrateur", async () => {
    const db = completeAllocationFixture();
    await expect(action(db, "publish-configuration", { versionId: "version" }, cashier)).rejects.toMatchObject({ status: 403 });
    db.projectId = "acadea-production"; await expect(action(db, "publish-configuration", { versionId: "version" })).rejects.toMatchObject({ code: "permission-denied" });
    db.projectId = "demo-acadea"; db.records.get(`feeAllocationTestScopes/${fixtureId}`).expiresAt = "2026-11-12";
    await expect(readAllocationTestScope(db, null, "school", now)).rejects.toThrow();
    delete db.records.get("schools/school").fixtureId; expect(await readAllocationTestScope(db, null, "school", now)).toBeNull();
  });
  it("ne crédite pas de don, exige l'explication du solde et détecte les pièces modifiées", async () => {
    const db = completeAllocationFixture(); await action(db, "publish-configuration", { versionId: "version" });
    db.records.set("payments/old", { schoolId: "school", schoolYearId: "year", currency: "USD", amount: 25, createdAt: "2026-11-01", provenance: "financial-api", clientRequestIdHash: "proof" });
    db.records.set("cashInflows/donation", { schoolId: "school", schoolYearId: "year", currency: "USD", amount: 50, createdAt: "2026-11-01", provenance: 'financial-api', clientRequestIdHash: 'donation-proof' });
    await expect(action(db, "prepare-opening", { cashCountMinor: 7500, lines: [{ rubricId, amountMinor: 7500 }], confirmation: "RAPPROCHER LA CAISSE" })).rejects.toThrow();
    const p = await action(db, "prepare-opening", { cashCountMinor: 7500, lines: [{ rubricId, amountMinor: 2500 }], confirmation: "RAPPROCHER LA CAISSE" });
    db.records.get("payments/old").amount = 30;
    markFixtureFinancialChange(db);
    await expect(action(db, "approve-opening", { openingId: p.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" })).rejects.toThrow("refaire le rapprochement");
  });
  it("garde les anciennes propositions indécidables, sans paiement ni affectation", async () => {
    const db = completeAllocationFixture(); await activate(db); const before = structuredClone([...db.records]);
    await expect(pay(db, { expectedFeeAmount: 100, expectedCurrency: "USD" })).rejects.toThrow("coupure");
    expect([...db.records]).toEqual(before);
    await expect(pay(db, { expectedFeeAmount: 100, expectedCurrency: "USD", proposedAt: "2026-11-12T12:00:00.000Z" })).rejects.toThrow("coupure");
    await pay(db, { expectedFeeAmount: 100, expectedCurrency: "USD", proposedAt: later });
  });
  it("compare la coupure à l'instant réel, pas à l'ordre textuel d'un fuseau horaire", async () => {
    const db = completeAllocationFixture(); await activate(db); const before = structuredClone([...db.records]);
    await expect(pay(db, { expectedFeeAmount: 100, expectedCurrency: "USD", proposedAt: "2026-11-13T10:30:00+02:00" })).rejects.toThrow("coupure");
    expect([...db.records]).toEqual(before);
  });
  it("garde le circuit historique sans rubrique ni nouvelle écriture si inactif", async () => {
    const db = completeAllocationFixture(); await pay(db); await spend(db, { allocationRubricId: undefined }); expect(movements(db)).toHaveLength(0);
    expect([...db.records.keys()].some(k => k.startsWith("feeAllocationBalances/"))).toBe(false);
  });
  it("exige sur Staging un registre serveur valide, pas seulement un marqueur d'école", async () => {
    const db = completeAllocationFixture(); db.projectId = "acadea-staging";
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", ""); vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
    db.records.get(`feeAllocationTestScopes/${fixtureId}`).projectId = "acadea-staging";
    expect(await readAllocationTestScope(db, null, "school", now)).toBeTruthy();
    db.records.delete(`feeAllocationTestScopes/${fixtureId}`);
    await expect(readAllocationTestScope(db, null, "school", now)).rejects.toMatchObject({ code: "test-scope-required" });
  });
  it("rapproche toutes les pièces au-delà de 200 et archive la preuve en pages", async () => {
    const db = completeAllocationFixture(); await action(db, "publish-configuration", { versionId: "version" });
    for (let i = 0; i < 1201; i++) db.records.set(`payments/old-${i}`, { schoolId: "school", schoolYearId: "year", currency: "USD", amount: 1, createdAt: "2026-11-01", provenance: "financial-api", clientRequestIdHash: String(i) });
    const result = await action(db, "prepare-opening", { cashCountMinor: 120100, lines: [{ rubricId, amountMinor: 120100 }], confirmation: "RAPPROCHER LA CAISSE" });
    const proof = db.records.get(`feeAllocationOpeningAudits/${result.openingId}`);
    expect(proof).toMatchObject({ evidenceCount: 1201, evidencePages: 16, schoolAvailableMinor: 120100 });
    expect(proof.evidence).toBeUndefined();
    await action(db, "approve-opening", { openingId: result.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
    await action(db, "activate", { openingId: result.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
    expect(balance(db).availableMinor).toBe(120100);
  });
});
