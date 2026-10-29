import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const auth = (uid: string, role: string, schoolId?: string) => environment.authenticatedContext(uid,
  { role, ...(schoolId ? { schoolId } : {}) }).firestore();
const inflow = (schoolId: string, yearId: string) => ({ schoolId, schoolYearId: yearId, amount: 50,
  currency: "CDF", category: "Don", description: "Recette fictive", createdAt: "2026-10-27T12:00:00Z" });

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-acadea-cash-inflows",
  firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "schools", "school-a"), { status: "active" }),
      setDoc(doc(db, "schools", "school-b"), { status: "active" }),
      setDoc(doc(db, "users", "cashier-a"), { role: "cashier", schoolId: "school-a", status: "active" }),
      setDoc(doc(db, "users", "admin-a"), { role: "school_admin", schoolId: "school-a", status: "active" }),
      setDoc(doc(db, "users", "teacher-a"), { role: "teacher", schoolId: "school-a", status: "active" }),
      setDoc(doc(db, "users", "cashier-b"), { role: "cashier", schoolId: "school-b", status: "active" }),
      setDoc(doc(db, "cashInflows", "a"), inflow("school-a", "year-a")),
      setDoc(doc(db, "cashInflows", "b"), inflow("school-b", "year-a")),
      setDoc(doc(db, "cashInflows", "other-year"), inflow("school-a", "year-b")),
    ]);
  });
});
afterAll(async () => environment?.cleanup(), 30_000);

describe("autres entrées de caisse", () => {
  it("autorise les lectures du Caissier et de l'Administrateur dans leur école seulement", async () => {
    await assertSucceeds(getDoc(doc(auth("cashier-a", "cashier", "school-a"), "cashInflows", "a")));
    await assertSucceeds(getDoc(doc(auth("admin-a", "school_admin", "school-a"), "cashInflows", "a")));
    await assertFails(getDoc(doc(auth("cashier-a", "cashier", "school-a"), "cashInflows", "b")));
    await assertFails(getDoc(doc(auth("cashier-b", "cashier", "school-b"), "cashInflows", "a")));
    await assertFails(getDoc(doc(auth("teacher-a", "teacher", "school-a"), "cashInflows", "a")));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "cashInflows", "a")));
  });

  it("borne les requêtes à l'école et à l'année", async () => {
    const cashier = auth("cashier-a", "cashier", "school-a");
    await assertSucceeds(getDocs(query(collection(cashier, "cashInflows"), where("schoolId", "==", "school-a"), where("schoolYearId", "==", "year-a"))));
    await assertFails(getDocs(collection(cashier, "cashInflows")));
  });

  it("refuse toute écriture client, même au Caissier ou à l'Administrateur", async () => {
    for (const db of [auth("cashier-a", "cashier", "school-a"), auth("admin-a", "school_admin", "school-a")]) {
      await assertFails(setDoc(doc(db, "cashInflows", "new"), inflow("school-a", "year-a")));
      await assertFails(updateDoc(doc(db, "cashInflows", "a"), { amount: 100 }));
      await assertFails(deleteDoc(doc(db, "cashInflows", "a")));
    }
  });
});
