// Lot 27a — tests de non-régression écrits AVANT toute modification (décision du propriétaire, 16/11/2026).
// Ils figent le comportement actuel des formulaires « Enregistrer une dépense » et « Paiement du personnel »,
// répartition activée ET non activée. Ils doivent rester verts après le lot 27, sauf les cas marqués
// « DÉCISION » (pause supprimée, paiement d'élève jamais bloqué), qui seront adaptés explicitement.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle, getAllocationSpendOptions } from "./feeAllocationLifecycle.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { createPersonnelPayment, updatePersonnelPayment } from "./personnelPayroll.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const rubricId = "a".repeat(32);
const at = "2026-11-13T10:00:00.000Z";
let sequence = 0;
afterEach(() => vi.unstubAllEnvs());

const lifecycle = (db, action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `non-regression-${++sequence}-request`, ...extra } });
async function activeSchool() {
  const db = completeAllocationFixture();
  await lifecycle(db, "publish-configuration", { versionId: "version" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle(db, "prepare-opening", { cashCountMinor: 0, lines: [{ rubricId, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle(db, "approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle(db, "activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  return db;
}
const pay = (db, amount, key) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: {
  action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount, clientRequestId: key } });
const spend = (db, amount, key, extra = {}) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: {
  action: "create-expense", schoolYearId: "year", amount, category: "Fournitures", description: "Achat test", beneficiary: "Fournisseur",
  paymentMethod: "Espèces", reference: "", clientRequestId: key, ...extra } });
const salary = (db, amount, key, extra = {}) => createPersonnelPayment({ db, caller: cashier, now: "2026-11-13T12:30:00.000Z", body: {
  action: "create-personnel-payment", schoolYearId: "year", beneficiaryId: "teacher", kind: "salary", periodMonth: 11, periodYear: 2026, paidAt: "2026-11-13",
  amount, recoveries: [], deduction: 0, deductionReason: "", cnss: 0, tax: 0, description: "", clientRequestId: key, ...extra } });
const balance = (db, id) => [...db.records].find(([p, v]) => p.startsWith("feeAllocationBalances/") && v.rubricId === id)?.[1];
const records = (db, prefix) => [...db.records].filter(([p]) => p.startsWith(prefix)).map(([, v]) => v);
const expenseMovements = (db) => records(db, "feeAllocationMovements/").filter((m) => m.sourceType === "expense");

describe("lot 27a — non-régression : répartition NON activée", () => {
  it("1. dépense sans rubrique acceptée, la caisse baisse ; une rubrique envoyée est refusée", async () => {
    const db = completeAllocationFixture();
    await pay(db, 80, "non-active-payment-0001");
    const result = await spend(db, 30, "non-active-expense-0001");
    expect(result.expense).toMatchObject({ amount: 30 });
    expect(result.expense).not.toHaveProperty("allocationRubricId");
    expect(expenseMovements(db)).toHaveLength(0);
    await expect(spend(db, 10, "non-active-expense-0002", { allocationRubricId: rubricId })).rejects.toThrow("Aucune répartition active");
    expect(records(db, "expenses/")).toHaveLength(1);
  });
  it("2. paiement du personnel sans rubrique accepté ; sa dépense liée vaut le net payé", async () => {
    const db = completeAllocationFixture();
    await pay(db, 80, "non-active-payment-0002");
    const result = await salary(db, 50, "non-active-salary-0001", { deduction: 5, deductionReason: "Retenue test", cnss: 2, tax: 3 });
    const expense = records(db, "expenses/").find((e) => e.personnelPaymentId === result.payment.id);
    expect(expense).toMatchObject({ amount: 40, provenance: "personnel-payroll" });
    expect(expense).not.toHaveProperty("allocationRubricId");
  });
  it("8a. la liste des rubriques n'est pas demandée : champ absent du formulaire", async () => {
    const db = completeAllocationFixture();
    expect(await getAllocationSpendOptions({ db, caller: cashier, body: { schoolId: "school", schoolYearId: "year" }, now: at })).toMatchObject({ required: false, rubrics: [] });
  });
});

describe("lot 27a — non-régression : répartition ACTIVÉE", () => {
  it("3. dépense sans rubrique refusée ; « Non affecté » ou rubrique active acceptée, solde et mouvement justes", async () => {
    const db = await activeSchool();
    await pay(db, 80, "active-payment-0001");
    await expect(spend(db, 10, "active-expense-0001")).rejects.toThrow("rubrique");
    const before = balance(db, rubricId);
    await spend(db, 20, "active-expense-0002", { allocationRubricId: rubricId });
    expect(balance(db, rubricId).spentMinor).toBe(before.spentMinor + 2000);
    expect(balance(db, rubricId).availableMinor).toBe(before.availableMinor - 2000);
    await spend(db, 5, "active-expense-0003", { allocationRubricId: "UNALLOCATED" });
    expect(balance(db, "UNALLOCATED").spentMinor).toBe(500);
    expect(expenseMovements(db).map((m) => m.amountMinor).sort((a, b) => a - b)).toEqual([-2000, -500]);
  });
  it("4. rubrique masquée ou inconnue refusée", async () => {
    const db = await activeSchool();
    await pay(db, 80, "active-payment-0002");
    await expect(spend(db, 5, "active-expense-0004", { allocationRubricId: "f".repeat(32) })).rejects.toThrow("rubrique active");
    expect(records(db, "expenses/")).toHaveLength(0);
  });
  it("5. dépense supérieure au disponible de la rubrique refusée ; caisse et dépenses inchangées", async () => {
    const db = await activeSchool();
    await pay(db, 80, "active-payment-0003");
    const available = balance(db, rubricId).availableMinor;
    await expect(spend(db, available / 100 + 1, "active-expense-0005", { allocationRubricId: rubricId })).rejects.toThrow("insuffisant");
    expect(records(db, "expenses/")).toHaveLength(0);
    expect(balance(db, rubricId).availableMinor).toBe(available);
  });
  it("6. correction : solde ajusté ; changement de rubrique refusé ; suppression : rubrique recréditée", async () => {
    const db = await activeSchool();
    await pay(db, 80, "active-payment-0004");
    const start = balance(db, rubricId).availableMinor;
    const { expense } = await spend(db, 20, "active-expense-0006", { allocationRubricId: rubricId });
    await executeFinancialOperation({ db, caller: admin, now: "2026-11-13T13:00:00.000Z", body: { action: "update-expense", transactionId: expense.id, amount: 15, category: "Fournitures", description: "Achat test", reason: "Correction test", clientRequestId: "active-expense-correct-0001" } });
    expect(balance(db, rubricId).availableMinor).toBe(start - 1500);
    await expect(executeFinancialOperation({ db, caller: admin, now: "2026-11-13T13:10:00.000Z", body: { action: "update-expense", transactionId: expense.id, amount: 15, category: "Fournitures", description: "Achat test", allocationRubricId: "UNALLOCATED", reason: "Réaffectation", clientRequestId: "active-expense-correct-0002" } })).rejects.toThrow();
    await executeFinancialOperation({ db, caller: admin, now: "2026-11-13T13:20:00.000Z", body: { action: "delete-expense", transactionId: expense.id, reason: "Suppression test", clientRequestId: "active-expense-delete-0001" } });
    expect(balance(db, rubricId).availableMinor).toBe(start);
  });
  it("7. paiement du personnel imputé au net payé ; correction ajustée", async () => {
    const db = await activeSchool();
    await pay(db, 100, "active-payment-0005");
    const start = balance(db, rubricId).availableMinor;
    const result = await salary(db, 30, "active-salary-0001", { allocationRubricId: rubricId, deduction: 5, deductionReason: "Retenue test" });
    expect(balance(db, rubricId).availableMinor).toBe(start - 2500);
    await updatePersonnelPayment({ db, caller: admin, now: "2026-11-13T14:00:00.000Z", body: { action: "update-personnel-payment", paymentId: result.payment.id,
      amount: 20, deduction: 5, deductionReason: "Retenue test", cnss: 0, tax: 0, description: "", paidAt: "2026-11-13", periodMonth: 11, periodYear: 2026, reason: "Correction test", confirmation: "MODIFIER CE SALAIRE", expectedUpdatedAt: result.payment.updatedAt ?? result.payment.createdAt, clientRequestId: "active-salary-correct-0001" } });
    expect(balance(db, rubricId).availableMinor).toBe(start - 1500);
  });
  it("8b. liste des rubriques : rubriques non masquées + « Non affecté »", async () => {
    const db = await activeSchool();
    const options = await getAllocationSpendOptions({ db, caller: cashier, body: { schoolId: "school", schoolYearId: "year" }, now: at });
    expect(options.required).toBe(true);
    expect(options.rubrics.map((r) => r.id)).toEqual([rubricId, "UNALLOCATED"]);
    expect(options.rubrics.at(-1).name).toBe("Non affecté");
  });
});

describe("lot 27a — non-régression : rapports", () => {
  it("9. les rapports et listes de dépenses n'affichent pas la rubrique", () => {
    for (const file of ["../../src/modules/reports/ReportsModule.tsx", "../../src/utils/reportPdf.ts", "../../src/utils/dashboardStats.ts"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toContain("allocationRubricId");
    }
  });
});

describe("lot 27a — comportements que les DÉCISIONS du propriétaire vont changer", () => {
  it("10. DÉCISION (pause supprimée) : aujourd'hui, une dépense est refusée pendant la pause", async () => {
    const db = await activeSchool();
    await pay(db, 80, "paused-payment-0001");
    await lifecycle(db, "pause", { reason: "Pause de test pour figer le comportement actuel." });
    await expect(spend(db, 5, "paused-expense-0001", { allocationRubricId: rubricId })).rejects.toThrow("pause");
  });
  it("11. DÉCISION (paiement jamais bloqué) : aujourd'hui, un paiement d'élève est refusé pendant la pause", async () => {
    const db = await activeSchool();
    await lifecycle(db, "pause", { reason: "Pause de test pour figer le comportement actuel." });
    await expect(pay(db, 10, "paused-payment-0002")).rejects.toThrow("pause");
  });
});
