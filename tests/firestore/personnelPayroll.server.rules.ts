import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPersonnelPayment } from "../../api/_lib/personnelPayroll.js";

const projectId = "demo-personnel-payroll";
const app = initializeApp({ projectId }, "personnel-payroll-emulator-test");
const db = getFirestore(app);
const caller = { uid: "cashier-a", role: "cashier", schoolId: "school-a" };
const base = { action: "create-personnel-payment", schoolYearId: "year-a", beneficiaryId: "worker-a", paidAt: "2026-10-09", amount: 50, recoveries: [], deduction: 0, deductionReason: "", cnss: 0, tax: 0, description: "" };

describe("paie — transactions Firestore réelles sur émulateur", () => {
  beforeAll(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Test de paie réservé à l'émulateur Firestore local.");
    await Promise.all([
      db.doc("schools/school-a").set({ status: "active", currency: "CDF" }),
      db.doc("schoolYears/year-a").set({ schoolId: "school-a", status: "active", currency: "CDF" }),
      db.doc("users/cashier-a").set({ role: "cashier", schoolId: "school-a", status: "active", name: "Caissier" }),
      db.doc("personnelProfiles/worker-a").set({ kind: "service", schoolId: "school-a", name: "Vigile", jobTitle: "Vigile" }),
    ]);
  }, 30_000);
  afterAll(async () => { await deleteApp(app); }, 30_000);

  it("une seule récupération peut solder la même avance malgré deux transactions simultanées", async () => {
    const advance = await createPersonnelPayment({ db, caller, body: { ...base, kind: "advance", clientRequestId: "emulator-advance-0001" }, now: "2026-10-09T10:00:00.000Z" });
    const recovery = [{ advanceId: advance.payment.id, amount: 50 }];
    const drafts = ["emulator-salary-0001", "emulator-bonus-00001"].map((clientRequestId, index) => createPersonnelPayment({ db, caller, body: { ...base, kind: index ? "bonus" : "salary", periodMonth: 9, periodYear: 2026, amount: 100, recoveries: recovery, clientRequestId }, now: "2026-10-09T10:01:00.000Z" }));
    const result = await Promise.allSettled(drafts);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((item) => item.status === "rejected")).toHaveLength(1);
    const snapshot = await db.doc(`personnelPayments/${advance.payment.id}`).get();
    expect(snapshot.data()?.recoveredAmount).toBe(50);
    expect(snapshot.data()?.recoveryHistory).toHaveLength(1);
    const expenses = await db.collection("expenses").where("schoolId", "==", "school-a").get();
    expect(expenses.docs).toHaveLength(2);
  }, 30_000);
});
