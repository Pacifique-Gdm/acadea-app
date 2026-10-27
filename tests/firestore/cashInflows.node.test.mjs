import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

test("règles des autres entrées de caisse : lectures isolées et écriture serveur uniquement", async () => {
  const environment = await initializeTestEnvironment({ projectId: "demo-acadea-cash-inflows-node",
    firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const [uid, role, schoolId] of [["cashier-a", "cashier", "school-a"], ["admin-a", "school_admin", "school-a"],
        ["cashier-b", "cashier", "school-b"], ["teacher-a", "teacher", "school-a"]]) {
        await setDoc(doc(db, "users", uid), { role, schoolId, status: "active" });
      }
      await setDoc(doc(db, "schools", "school-a"), { status: "active" });
      await setDoc(doc(db, "schools", "school-b"), { status: "active" });
      await setDoc(doc(db, "cashInflows", "inflow-a"), { schoolId: "school-a", schoolYearId: "year-a", amount: 25, currency: "CDF" });
      await setDoc(doc(db, "cashInflows", "inflow-b"), { schoolId: "school-b", schoolYearId: "year-a", amount: 50, currency: "CDF" });
    });
    const auth = (uid, role, schoolId) => environment.authenticatedContext(uid, { role, schoolId }).firestore();
    const cashier = auth("cashier-a", "cashier", "school-a");
    const admin = auth("admin-a", "school_admin", "school-a");
    await assertSucceeds(getDoc(doc(cashier, "cashInflows", "inflow-a")));
    await assertSucceeds(getDoc(doc(admin, "cashInflows", "inflow-a")));
    await assertFails(getDoc(doc(cashier, "cashInflows", "inflow-b")));
    await assertFails(getDoc(doc(auth("cashier-b", "cashier", "school-b"), "cashInflows", "inflow-a")));
    await assertFails(getDoc(doc(auth("teacher-a", "teacher", "school-a"), "cashInflows", "inflow-a")));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "cashInflows", "inflow-a")));
    const bounded = await assertSucceeds(getDocs(query(collection(cashier, "cashInflows"), where("schoolId", "==", "school-a"), where("schoolYearId", "==", "year-a"))));
    assert.equal(bounded.size, 1);
    await assertFails(getDocs(collection(cashier, "cashInflows")));
    for (const db of [cashier, admin]) {
      await assertFails(setDoc(doc(db, "cashInflows", "forged"), { schoolId: "school-a", schoolYearId: "year-a", amount: 100 }));
      await assertFails(updateDoc(doc(db, "cashInflows", "inflow-a"), { amount: 100 }));
      await assertFails(deleteDoc(doc(db, "cashInflows", "inflow-a")));
    }
  } finally {
    await environment.cleanup();
  }
});
