import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where } from "firebase/firestore";

let environment: RulesTestEnvironment;
const projectId = "acadea-financial-rules";

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const role of ["cashier", "school_admin", "admin", "secretary", "teacher"]) {
      await setDoc(doc(db, "users", `${role}-user`), { id: `${role}-user`, role, schoolId: "school-a", status: "active" });
    }
    await setDoc(doc(db, "payments", "payment-a"), { id: "payment-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 10, createdBy: "cashier-a", createdAt: "2026-08-07T12:00:00.000Z", receiptNumber: "REC-2026-0001" });
    await setDoc(doc(db, "payments", "payment-arrears"), { id: "payment-arrears", schoolId: "school-a", schoolYearId: "year-old", collectionSchoolYearId: "year-a", currentStudentId: "student-a", studentId: "student-old", feeTypeId: "fee-old", amount: 5 });
    await setDoc(doc(db, "expenses", "expense-a"), { id: "expense-a", schoolId: "school-a", schoolYearId: "year-a", amount: 10, category: "Fournitures", description: "Papier", createdBy: "cashier-a", createdAt: "2026-08-07T12:00:00.000Z" });
  });
});
afterAll(async () => environment.cleanup());

function db(role: string, schoolId = "school-a") {
  return environment.authenticatedContext(`${role}-user`, { role, schoolId }).firestore();
}

const newPayment = { id: "payment-new", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 10, createdBy: "cashier-user", createdAt: "2026-08-07T12:00:00.000Z", receiptNumber: "REC-2026-0002" };
const newExpense = { id: "expense-new", schoolId: "school-a", schoolYearId: "year-a", amount: 10, category: "Fournitures", description: "Papier", createdBy: "cashier-user", createdAt: "2026-08-07T12:00:00.000Z" };

describe("écritures financières réservées au serveur", () => {
  for (const role of ["cashier", "school_admin", "admin", "secretary", "teacher"]) {
    it(`refuse la création directe d'un paiement au rôle ${role}`, async () => {
      await assertFails(setDoc(doc(db(role), "payments", `payment-${role}`), { ...newPayment, id: `payment-${role}` }));
    });
    it(`refuse la création directe d'une dépense au rôle ${role}`, async () => {
      await assertFails(setDoc(doc(db(role), "expenses", `expense-${role}`), { ...newExpense, id: `expense-${role}` }));
    });
  }
  it("refuse les écritures non authentifiées", async () => {
    const unauthenticated = environment.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(unauthenticated, "payments", "payment-unauth"), newPayment));
    await assertFails(setDoc(doc(unauthenticated, "expenses", "expense-unauth"), newExpense));
  });
  it("refuse toute modification ou suppression directe", async () => {
    await assertFails(updateDoc(doc(db("school_admin"), "payments", "payment-a"), { amount: 20 }));
    await assertFails(deleteDoc(doc(db("school_admin"), "payments", "payment-a")));
    await assertFails(updateDoc(doc(db("school_admin"), "expenses", "expense-a"), { amount: 20 }));
    await assertFails(deleteDoc(doc(db("school_admin"), "expenses", "expense-a")));
  });
  it("conserve les lectures nécessaires dans la même école", async () => {
    await assertSucceeds(getDoc(doc(db("cashier"), "payments", "payment-a")));
    await assertSucceeds(getDoc(doc(db("school_admin"), "expenses", "expense-a")));
  });
  it("autorise la lecture des arriérés encaissés uniquement par école et année d'encaissement", async () => {
    const cashierDb = db("cashier");
    const result = await assertSucceeds(getDocs(query(collection(cashierDb, "payments"), where("schoolId", "==", "school-a"), where("collectionSchoolYearId", "==", "year-a"))));
    if (result.docs.length !== 1 || result.docs[0].id !== "payment-arrears") throw new Error("Lecture des arriérés inattendue.");
    await assertFails(getDocs(query(collection(db("cashier", "school-b"), "payments"), where("schoolId", "==", "school-a"), where("collectionSchoolYearId", "==", "year-a"))));
    await assertFails(setDoc(doc(cashierDb, "payments", "payment-arrears-client"), { ...newPayment, collectionSchoolYearId: "year-a" }));
  });
  it("refuse les lectures financières d'une autre école", async () => {
    await assertFails(getDoc(doc(db("cashier", "school-b"), "payments", "payment-a")));
    await assertFails(getDoc(doc(db("school_admin", "school-b"), "expenses", "expense-a")));
  });
  it("interdit les compteurs et clés d'idempotence au client", async () => {
    await assertFails(setDoc(doc(db("school_admin"), "financialCounters", "counter-a"), { lastReceiptNumber: 999 }));
    await assertFails(setDoc(doc(db("cashier"), "financialIdempotency", "request-a"), { result: {} }));
  });
});
