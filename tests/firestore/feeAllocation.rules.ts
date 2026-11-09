import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const admin = () => environment.authenticatedContext("allocation-admin", { role: "school_admin", schoolId: "allocation-school" }).firestore();

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-fee-allocation-phase1", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "schools", "allocation-school"), { id: "allocation-school", status: "active", activeSchoolYearId: "allocation-year" });
    await setDoc(doc(db, "schoolYears", "allocation-year"), { id: "allocation-year", schoolId: "allocation-school", status: "active" });
    await setDoc(doc(db, "users", "allocation-admin"), { id: "allocation-admin", schoolId: "allocation-school", role: "school_admin", status: "active" });
    await setDoc(doc(db, "feeTypes", "guarded-fee"), { id: "guarded-fee", schoolId: "allocation-school", schoolYearId: "allocation-year", className: "6ème Primaire", name: "Minerval", amount: 100 });
    await setDoc(doc(db, "feeAllocationFeeGuards", "guarded-fee"), { schoolId: "allocation-school", versionId: "published-version" });
  });
}, 30000);
afterAll(async () => environment?.cleanup(), 30000);

describe("répartition des frais : collections exclusivement serveur", () => {
  it("refuse aux clients les brouillons, versions, états, soldes et mouvements", async () => {
    for (const name of ["feeAllocationStates", "feeAllocationConfigs", "feeAllocationVersions", "feeAllocationFeeGuards", "feeAllocationRequests", "feeAllocationOpeningAudits", "feeAllocationAnchors", "feeAllocationMovements", "feeAllocationBalances", "feeAllocationReconciliationRuns"]) {
      await assertFails(setDoc(doc(admin(), name, "forged"), { schoolId: "allocation-school", status: "ACTIVE" }));
      await assertFails(getDoc(doc(admin(), name, "forged")));
    }
  }, 30000);
  it("préserve la création et la modification des frais non protégés", async () => {
    const fee = doc(admin(), "feeTypes", "unguarded-fee");
    await assertSucceeds(setDoc(fee, { id: "unguarded-fee", schoolId: "allocation-school", schoolYearId: "allocation-year", className: "6ème Primaire", name: "Frais", amount: 100 }));
    await assertSucceeds(updateDoc(fee, { amount: 150 }));
  });
  it("interdit modification et suppression d'un tarif protégé sans supprimer l'historique", async () => {
    const fee = doc(admin(), "feeTypes", "guarded-fee");
    await assertFails(updateDoc(fee, { amount: 50 }));
    await assertFails(updateDoc(fee, { name: "Nouveau" }));
    await assertFails(deleteDoc(fee));
    await assertSucceeds(getDoc(fee));
  });
});
