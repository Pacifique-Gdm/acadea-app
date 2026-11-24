import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { allocationBalanceId } from "./feeAllocationRuntime.js";
import { authorizeFinancialCaller, executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { CLASS_CHANGE_CASHIER_ONLY_MESSAGE, CLASS_CHANGE_SOCIAL_CASE_MESSAGE } from "../../src/utils/classChangeGuard.js";

/** Lot E du caissier : changement de classe d'un élève qui a payé. Chaque test échoue sur la 1.22.0 (action absente). */
const now = "2026-11-13T10:00:00.000Z", paidAt = "2026-11-13T13:00:00.000Z", changedAt = "2026-11-13T14:00:00.000Z";
const rubricId = "a".repeat(32);
const admin = { uid: "admin", role: "school_admin", schoolId: "school" };
const cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const ACTIVATE = "ACTIVER LA REPARTITION DE MON ETABLISSEMENT";
let counter = 0;
const key = (label) => `${label}-${String(++counter).padStart(6, "0")}`;
afterEach(() => vi.unstubAllEnvs());

function school(newFees = [{ id: "fee2", name: "Minerval", amount: 120 }]) {
  const db = completeAllocationFixture(); db.projectId = "acadea-staging";
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", ""); vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
  delete db.records.get("schools/school").fixtureId;
  for (const path of db.records.keys()) if (path.startsWith("feeAllocationTestScopes/")) db.records.delete(path);
  for (const fee of newFees) db.records.set(`feeTypes/${fee.id}`, { schoolId: "school", schoolYearId: "year", className: "2ème", createdAt: "2026-11-13T11:00:00.000Z", ...fee });
  return db;
}
async function activate(db) {
  const call = (action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action, requestId: key("request"), ...extra } });
  await call("publish-configuration", { versionId: "version" });
  await reconcileFixture(db, admin, now);
  await call("activate-without-history", { confirmation: ACTIVATE });
}
const pay = (db, amount, feeTypeId = "fee") => executeFinancialOperation({ db, caller: cashier, now: paidAt,
  body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId, amount, clientRequestId: key("payment") } });
const change = (db, caller = cashier, extra = {}) => executeFinancialOperation({ db, caller, now: changedAt, body: { action: "change-student-class",
  schoolYearId: "year", studentId: "student", className: "2ème", expectedUpdatedAt: db.records.get("students/student").updatedAt ?? db.records.get("students/student").createdAt,
  clientRequestId: key("class-change"), ...extra } });
const balance = (db, rubric) => db.records.get(`feeAllocationBalances/${allocationBalanceId("school", "year", "USD", rubric)}`) ?? { receivedMinor: 0 };
const movements = (db) => [...db.records].filter(([path]) => path.startsWith("feeAllocationMovements/")).map(([, value]) => value);
const payments = (db) => [...db.records].filter(([path]) => path.startsWith("payments/")).map(([, value]) => value);

describe("lot E — seul le caissier change la classe d'un élève qui a payé", () => {
  for (const role of ["secretary", "school_admin", "admin", "teacher", "parent", "super_admin"]) {
    it(`${role} : refusé par le serveur, avec le message demandé, rien n'est modifié`, async () => {
      expect(() => authorizeFinancialCaller({ uid: "x", role, schoolId: "school" }, "change-student-class")).toThrow(CLASS_CHANGE_CASHIER_ONLY_MESSAGE);
      const db = school();
      await pay(db, 60);
      await expect(change(db, { uid: "x", role, schoolId: "school" })).rejects.toMatchObject({ status: 403, message: CLASS_CHANGE_CASHIER_ONLY_MESSAGE });
      expect(db.records.get("students/student").className).toBe("1ère");
      expect(payments(db).map((payment) => payment.feeTypeId)).toEqual(["fee"]);
    });
  }

  it("caissier, sans répartition active : la classe change et le paiement passe sur le Minerval de la nouvelle classe", async () => {
    const db = school();
    await pay(db, 60);
    const result = await change(db);
    expect(db.records.get("students/student")).toMatchObject({ className: "2ème", updatedAt: changedAt });
    expect(payments(db)).toHaveLength(1);
    expect(payments(db)[0]).toMatchObject({ feeTypeId: "fee2", amount: 60, classChangeHistory: [{ fromFeeTypeId: "fee", fromAmount: 60, fromClassName: "1ère", toClassName: "2ème" }] });
    expect(result.classChange.moves).toHaveLength(1);
    expect(movements(db)).toEqual([]);
    const log = [...db.records].find(([path]) => path.startsWith("auditLogs/audit_stu_"))[1];
    expect(log).toMatchObject({ eventType: "student.class_changed", action: "Changement de classe (paiements rattachés)" });
  });
});

describe("lot E — répartition active : écritures inverses, rien n'est réécrit ni effacé", () => {
  it("retire le paiement des rubriques de l'ancien frais et le remet sur le nouveau ; totaux avant et après", async () => {
    const db = school();
    await activate(db);
    await pay(db, 100);
    const receipt = movements(db).find((movement) => movement.type === "receipt");
    expect([balance(db, rubricId).receivedMinor, balance(db, "UNALLOCATED").receivedMinor]).toEqual([8000, 2000]);
    await change(db);
    // Le Minerval de 2ème n'a pas encore de rubriques : tout va dans « Non affecté ».
    expect([balance(db, rubricId).receivedMinor, balance(db, "UNALLOCATED").receivedMinor]).toEqual([0, 10000]);
    const all = movements(db);
    expect(all.find((movement) => movement.id === receipt.id)).toEqual(receipt); // l'écriture d'origine ne change pas
    const out = all.find((movement) => movement.type === "reassignment-out"), into = all.find((movement) => movement.type === "reassignment-in");
    expect(out).toMatchObject({ amountMinor: -10000, feeTypeId: "fee", reversesMovementId: receipt.id });
    expect(out.lines).toEqual(expect.arrayContaining([{ rubricId, amountMinor: -8000 }, { rubricId: "UNALLOCATED", amountMinor: -2000 }]));
    expect(into).toMatchObject({ amountMinor: 10000, feeTypeId: "fee2", reattachesMovementId: out.id, lines: [{ rubricId: "UNALLOCATED", amountMinor: 10000 }] });
    expect(out.classChangeId).toBe(into.classChangeId);
    // Le paiement reste corrigeable ensuite (sa trace de répartition suit le nouveau frais).
    const payment = payments(db)[0];
    await executeFinancialOperation({ db, caller: admin, now: "2026-11-13T15:00:00.000Z", body: { action: "update-payment", transactionId: payment.id, amount: 90,
      reason: "Erreur de saisie", confirmation: "MODIFIER CE PAIEMENT", expectedUpdatedAt: payment.updatedAt, clientRequestId: key("update") } });
    expect(balance(db, "UNALLOCATED").receivedMinor).toBe(9000);
  });

  it("coupe un paiement en deux : même reçu, même date ; chaque part est répartie sur son frais", async () => {
    const db = school([{ id: "fee2", name: "Minerval", amount: 60 }, { id: "exa2", name: "Examen", amount: 40, createdAt: "2026-11-13T11:30:00.000Z" }]);
    await activate(db);
    await pay(db, 100);
    const original = payments(db)[0];
    await change(db);
    const [first, second] = [payments(db).find((payment) => payment.id === original.id), payments(db).find((payment) => payment.id !== original.id)];
    expect(first).toMatchObject({ feeTypeId: "fee2", amount: 60 });
    expect(second).toMatchObject({ feeTypeId: "exa2", amount: 40, splitFromPaymentId: original.id, receiptNumber: original.receiptNumber, createdAt: original.createdAt, paidAt: original.paidAt });
    expect(movements(db).filter((movement) => movement.type === "reassignment-in").map((movement) => movement.amountMinor).sort()).toEqual([4000, 6000]);
    expect(balance(db, "UNALLOCATED").receivedMinor).toBe(10000);
  });

  it("refuse si une rubrique a déjà dépensé cet argent ; rien n'est enregistré", async () => {
    const db = school();
    await activate(db);
    await pay(db, 100);
    await executeFinancialOperation({ db, caller: cashier, now: paidAt, body: { action: "create-expense", schoolYearId: "year", amount: 50, category: "Fournitures",
      description: "Papier", beneficiary: "Fictif", paymentMethod: "Espèces", allocationRubricId: rubricId, clientRequestId: key("expense") } });
    const before = structuredClone([...db.records]);
    await expect(change(db)).rejects.toMatchObject({ code: "allocation-already-spent", message: expect.stringContaining("« Fonctionnement » a déjà dépensé") });
    expect([...db.records]).toEqual(before);
  });
});

describe("lot E — refus clairs, rien n'est enregistré", () => {
  it("trop-perçu (en attendant le remboursement du lot F)", async () => {
    const db = school([{ id: "fee2", name: "Minerval", amount: 50 }]);
    await pay(db, 60);
    const before = structuredClone([...db.records]);
    await expect(change(db)).rejects.toMatchObject({ code: "class-change-overpaid", message: expect.stringContaining("trop-perçu de 10,00 $") });
    expect([...db.records]).toEqual(before);
  });

  it("élève avec une réduction ou une prise en charge", async () => {
    const db = school();
    await pay(db, 60);
    db.records.set("students/student", { ...db.records.get("students/student"), financialSupport: { d1: { schoolYearId: "year", lines: { fee: { reductionMinor: 1000 } } } } });
    await expect(change(db)).rejects.toMatchObject({ message: CLASS_CHANGE_SOCIAL_CASE_MESSAGE });
    expect(db.records.get("students/student").className).toBe("1ère");
  });

  it("fiche modifiée depuis son ouverture, et double clic sans doublon", async () => {
    const db = school();
    await pay(db, 60);
    await expect(change(db, cashier, { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" })).rejects.toMatchObject({ status: 409 });
    const body = { action: "change-student-class", schoolYearId: "year", studentId: "student", className: "2ème", expectedUpdatedAt: db.records.get("students/student").createdAt, clientRequestId: key("double") };
    await executeFinancialOperation({ db, caller: cashier, now: changedAt, body });
    const again = await executeFinancialOperation({ db, caller: cashier, now: changedAt, body });
    expect(again.idempotent).toBe(true);
    expect(payments(db)).toHaveLength(1);
  });
});

const refund = (amount, extra = {}) => ({ refund: { amount, method: "cash", confirmation: "REMBOURSER", ...extra } });
const expenses = (db) => [...db.records].filter(([path]) => path.startsWith("expenses/")).map(([, value]) => value);

describe("lot F — remboursement en espèces du trop-perçu par le caissier", () => {
  it("sans répartition : la part rattachée passe sur le nouveau frais, le reste est remboursé (reçu RMB, 2 parts liées)", async () => {
    const db = school([{ id: "fee2", name: "Minerval", amount: 50 }]);
    await pay(db, 60);
    const original = payments(db)[0];
    const result = await change(db, cashier, refund(10));
    expect(db.records.get("students/student").className).toBe("2ème");
    const kept = db.records.get(`payments/${original.id}`), moved = payments(db).find((payment) => payment.id !== original.id);
    expect(kept).toMatchObject({ feeTypeId: "fee", amount: 10, refundedAmount: 10, refundedByClassChangeId: result.classChange.id, receiptNumber: original.receiptNumber });
    expect(moved).toMatchObject({ feeTypeId: "fee2", amount: 50, splitFromPaymentId: original.id, receiptNumber: original.receiptNumber });
    expect(expenses(db)).toEqual([expect.objectContaining({ category: "Remboursement élève", amount: 10, paymentMethod: "Espèces", refundMethod: "cash",
      receiptNumber: "RMB-2026-0001", studentId: "student", refundOfPaymentIds: [original.id] })]);
    expect(result.classChange.refund).toMatchObject({ receiptNumber: "RMB-2026-0001", amount: 10 });
    // Un nouveau changement de classe ne rattache jamais la part déjà remboursée.
    db.records.set("feeTypes/fee3", { id: "fee3", schoolId: "school", schoolYearId: "year", className: "3ème", name: "Minerval", amount: 50, createdAt: "2026-11-13T11:00:00.000Z" });
    const again = await change(db, cashier, { className: "3ème" });
    expect(again.classChange.moves.map((move) => move.paymentId)).toEqual([moved.id]);
  });

  it("refuse sans la phrase « REMBOURSER », avec un autre montant ou un autre mode ; rien n'est enregistré", async () => {
    const db = school([{ id: "fee2", name: "Minerval", amount: 50 }]);
    await pay(db, 60);
    const before = structuredClone([...db.records]);
    await expect(change(db, cashier, refund(10, { confirmation: "OUI" }))).rejects.toMatchObject({ code: "class-change-overpaid", message: expect.stringContaining("REMBOURSER") });
    await expect(change(db, cashier, refund(9))).rejects.toMatchObject({ code: "class-change-overpaid" });
    await expect(change(db, cashier, refund(10, { method: "mobile-money" }))).rejects.toMatchObject({ code: "class-change-overpaid" });
    expect([...db.records]).toEqual(before);
  });

  it("caisse insuffisante : refus total avec le montant manquant", async () => {
    const db = school([{ id: "fee2", name: "Minerval", amount: 50 }]);
    await pay(db, 60);
    await executeFinancialOperation({ db, caller: cashier, now: paidAt, body: { action: "create-expense", schoolYearId: "year", amount: 55, category: "Fournitures",
      description: "Papier", beneficiary: "Fictif", paymentMethod: "Espèces", clientRequestId: key("expense") } });
    const before = structuredClone([...db.records]);
    await expect(change(db, cashier, refund(10))).rejects.toMatchObject({ code: "insufficient-funds", message: expect.stringContaining("il manque 5,00 $") });
    expect([...db.records]).toEqual(before);
  });

  it("répartition active : seule la part rattachée quitte l'ancien frais ; le remboursement est pris dans « Non affecté »", async () => {
    const db = school([{ id: "fee2", name: "Minerval", amount: 60 }]);
    await activate(db);
    await pay(db, 100);
    expect([balance(db, rubricId).receivedMinor, balance(db, "UNALLOCATED").receivedMinor]).toEqual([8000, 2000]);
    await change(db, cashier, refund(40));
    // Ancien frais : 100 → 40 (part remboursée gardée) ; Fonctionnement 80 → 32, Non affecté 20 → 8, puis + 60 (Minerval 2ème).
    expect(balance(db, rubricId)).toMatchObject({ receivedMinor: 3200, spentMinor: 0, availableMinor: 3200 });
    expect(balance(db, "UNALLOCATED")).toMatchObject({ receivedMinor: 6800, spentMinor: 4000, availableMinor: 2800 });
    const types = movements(db).map((movement) => movement.type).filter((type) => type !== "opening").sort();
    expect(types).toEqual(["expense", "reassignment-in", "reassignment-out", "receipt"]);
    expect(movements(db).find((movement) => movement.type === "expense").lines).toEqual([{ rubricId: "UNALLOCATED", amountMinor: -4000 }]);
  });

  it("répartition active : « Non affecté » insuffisant → refus total avec le montant manquant", async () => {
    const db = school([{ id: "fee2", name: "Minerval", amount: 10 }]);
    await activate(db);
    await pay(db, 100);
    const before = structuredClone([...db.records]);
    await expect(change(db, cashier, refund(90))).rejects.toMatchObject({ code: "refund-unallocated-insufficient", message: expect.stringContaining("il manque 62,00 $") });
    expect([...db.records]).toEqual(before);
  });
});
