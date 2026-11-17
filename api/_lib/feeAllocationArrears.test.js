// Lot 27c-3a — identifiant des lignes d'arriérés.
import { describe, expect, it } from "vitest";
import { arrearsRubricKey, assertFeeAllocationMovement, parseArrearsRubricKey } from "./feeAllocationMath.js";

describe("lot 27c-3a — lignes d'arriérés", () => {
  it("l'identifiant garde l'année d'origine et la rubrique de cette année", () => {
    expect(arrearsRubricKey("year-2025", "UNALLOCATED")).toBe("ARR__year-2025__UNALLOCATED");
    expect(parseArrearsRubricKey("ARR__year_2025__" + "a".repeat(32))).toEqual({ originSchoolYearId: "year_2025", rubricId: "a".repeat(32) });
    expect(parseArrearsRubricKey("ARR__x__autre")).toBeNull();
    expect(parseArrearsRubricKey("UNALLOCATED")).toBeNull();
  });
  it("un mouvement peut viser une ligne d'arriéré ; un identifiant inventé reste refusé", () => {
    const movement = (rubricId) => ({ sourceType: "expense", sourceId: "e", sourceRevision: "r", amountMinor: -500, lines: [{ rubricId, amountMinor: -500 }] });
    expect(() => assertFeeAllocationMovement(movement("ARR__old__UNALLOCATED"))).not.toThrow();
    expect(() => assertFeeAllocationMovement(movement("ARR__old__n'importe"))).toThrow();
  });
});

import { afterEach, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle, getAllocationSpendOptions } from "./feeAllocationLifecycle.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { createPersonnelPayment } from "./personnelPayroll.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { readFeeAllocationLedger } from "./feeAllocationLedger.js";
import { allocationBalanceId } from "./feeAllocationRuntime.js";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", key = "ARR__old__UNALLOCATED";
let sequence = 0;
afterEach(() => vi.unstubAllEnvs());
async function activeSchoolWithArrears() {
  const db = completeAllocationFixture();
  const lifecycle = (action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `arrears-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId: "a".repeat(32), amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 80, clientRequestId: `arrears-pay-${sequence}` } });
  // Solde d'une ligne d'arriéré tel que l'écrit la répartition d'un encaissement d'arriéré (30 USD).
  db.records.set(`feeAllocationBalances/${allocationBalanceId("school", "year", "USD", key)}`, { schoolId: "school", collectionSchoolYearId: "year", currency: "USD", rubricId: key,
    arrearsOf: { originSchoolYearId: "old", originYearName: "2025-2026", rubricId: "UNALLOCATED", rubricName: "Non affecté" },
    receivedMinor: 3000, openingMinor: 0, spentMinor: 0, reservedMinor: 0, availableMinor: 3000, operational: true, updatedAt: at });
  return db;
}
const spend = (db, amount, requestKey, rubric) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: {
  action: "create-expense", schoolYearId: "year", amount, category: "Fournitures", description: "Achat", beneficiary: "Fournisseur", paymentMethod: "Espèces", reference: "", clientRequestId: requestKey, allocationRubricId: rubric } });
const arrearsBalance = (db) => db.records.get(`feeAllocationBalances/${allocationBalanceId("school", "year", "USD", key)}`);

describe("lot 27c-3a — le Caissier peut imputer une dépense sur une ligne d'arriéré", () => {
  it("proposée avec son disponible, après les rubriques de l'année", async () => {
    const db = await activeSchoolWithArrears();
    const options = await getAllocationSpendOptions({ db, caller: cashier, body: { schoolId: "school", schoolYearId: "year" }, now: at });
    expect(options.rubrics.at(-1)).toMatchObject({ id: key, name: "Non affecté (arriéré 2025-2026)", availableMinor: 3000, arrears: true });
  });
  it("dépense et paiement du personnel acceptés dans la limite du disponible ; au-delà, refusés", async () => {
    const db = await activeSchoolWithArrears();
    await spend(db, 20, "arrears-expense-0001", key);
    expect(arrearsBalance(db)).toMatchObject({ spentMinor: 2000, availableMinor: 1000 });
    await expect(spend(db, 20, "arrears-expense-0002", key)).rejects.toThrow("insuffisant");
    await createPersonnelPayment({ db, caller: cashier, now: "2026-11-13T12:30:00.000Z", body: { action: "create-personnel-payment", schoolYearId: "year", beneficiaryId: "teacher", kind: "salary",
      periodMonth: 11, periodYear: 2026, paidAt: "2026-11-13", amount: 5, recoveries: [], deduction: 0, deductionReason: "", cnss: 0, tax: 0, description: "", clientRequestId: "arrears-salary-0001", allocationRubricId: key } });
    expect(arrearsBalance(db).availableMinor).toBe(500);
  });
  it("une ligne d'arriéré inexistante est refusée", async () => {
    const db = await activeSchoolWithArrears();
    await expect(spend(db, 5, "arrears-expense-0003", "ARR__autre__UNALLOCATED")).rejects.toThrow("insuffisant");
  });
  it("le registre présente la ligne d'arriéré avec son année d'origine", async () => {
    const db = await activeSchoolWithArrears();
    const ledger = await readFeeAllocationLedger({ db, schoolId: "school", schoolYearId: "year", currency: "USD", now: "2026-11-13T12:00:00.000Z" });
    expect(ledger.rubrics.at(-1)).toEqual({ id: key, name: "Non affecté (arriéré 2025-2026)", arrearsYearName: "2025-2026", originSchoolYearId: "old" });
  });
});
