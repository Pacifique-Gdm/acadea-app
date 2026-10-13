import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createPersonnelPayment } from "../../api/_lib/personnelPayroll.js";
import { executeFinancialOperation } from "../../api/_lib/financialTransactions.js";

const projectId = "demo-acadea-cash-concurrency";
const testKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const app = initializeApp({ projectId, credential: cert({ projectId, clientEmail: "emulator@demo-acadea-cash-concurrency.iam.gserviceaccount.com", privateKey: testKey }) }, "cash-concurrency-test");
const db = getFirestore(app);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Le test de concurrence exige l'émulateur Firestore local.");
});
afterAll(async () => { await db.terminate(); await deleteApp(app); });

async function seed(schoolId: string, received: number) {
  const schoolYearId = `${schoolId}-year`;
  await Promise.all([
    db.doc(`schools/${schoolId}`).set({ status: "active", currency: "CDF" }),
    db.doc(`schoolYears/${schoolYearId}`).set({ schoolId, status: "active", currency: "CDF" }),
    db.doc(`users/${schoolId}-cashier`).set({ schoolId, role: "cashier", status: "active", name: "Caissier fictif" }),
    db.doc(`personnelProfiles/${schoolId}-worker`).set({ schoolId, kind: "service", status: "active", name: "Personnel fictif", jobTitle: "Service" }),
    db.doc(`payments/${schoolId}-seed`).set({ schoolId, schoolYearId, currency: "CDF", amount: received }),
  ]);
  return { schoolId, schoolYearId, caller: { uid: `${schoolId}-cashier`, role: "cashier", schoolId } };
}

function payroll(context: Awaited<ReturnType<typeof seed>>, amount: number, clientRequestId: string) {
  return createPersonnelPayment({ db, caller: context.caller, body: {
    action: "create-personnel-payment", schoolYearId: context.schoolYearId, beneficiaryId: `${context.schoolId}-worker`, kind: "salary",
    periodMonth: 10, periodYear: 2026, paidAt: "2026-10-13", amount, recoveries: [], deduction: 0, deductionReason: "", cnss: 0, tax: 0,
    description: "Test local", clientRequestId,
  } });
}

describe("caisse — transactions Firestore réelles sur émulateur", () => {
  it("un seul de deux salaires concurrents consomme 500000 FC", async () => {
    const context = await seed("cash-parallel", 500000);
    const results = await Promise.allSettled([payroll(context, 350000, "emulator-parallel-01"), payroll(context, 350000, "emulator-parallel-02")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [payments, expenses] = await Promise.all([
      db.collection("personnelPayments").where("schoolId", "==", context.schoolId).get(),
      db.collection("expenses").where("schoolId", "==", context.schoolId).get(),
    ]);
    expect(payments.size).toBe(1);
    expect(expenses.size).toBe(1);
    expect(expenses.docs[0].data().amount).toBe(350000);
  }, 30000);

  it("une dépense ordinaire et un salaire concurrents partagent le même verrou", async () => {
    const context = await seed("cash-mixed", 500000);
    const results = await Promise.allSettled([
      payroll(context, 350000, "emulator-mixed-pay-01"),
      executeFinancialOperation({ db, caller: context.caller, body: { action: "create-expense", schoolYearId: context.schoolYearId, amount: 300000,
        category: "Fournitures", description: "Dépense fictive", beneficiary: "Test", paymentMethod: "Espèces", clientRequestId: "emulator-mixed-exp-01" } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const expenses = await db.collection("expenses").where("schoolId", "==", context.schoolId).get();
    expect(expenses.size).toBe(1);
    expect(expenses.docs[0].data().amount).toBeLessThanOrEqual(350000);
  }, 30000);
});
