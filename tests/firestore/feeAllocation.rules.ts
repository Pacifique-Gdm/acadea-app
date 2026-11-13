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
    await setDoc(doc(db, "users", "allocation-cashier"), { id: "allocation-cashier", schoolId: "allocation-school", role: "cashier", status: "active" });
    await setDoc(doc(db, "users", "allocation-disabled"), { id: "allocation-disabled", schoolId: "allocation-school", role: "school_admin", status: "inactive" });
    await setDoc(doc(db, "feeTypes", "guarded-fee"), { id: "guarded-fee", schoolId: "allocation-school", schoolYearId: "allocation-year", className: "6ème Primaire", name: "Minerval", amount: 100 });
    await setDoc(doc(db, "feeAllocationFeeGuards", "guarded-fee"), { schoolId: "allocation-school", versionId: "published-version" });
  });
}, 30000);
afterAll(async () => environment?.cleanup(), 30000);

describe("répartition des frais : collections exclusivement serveur", () => {
  it("interdit aussi la lecture, l'altération et la suppression des pages de preuve d'ouverture", async () => {
    const proof = doc(admin(), "feeAllocationOpeningAudits", "opening", "evidencePages", "000000");
    await assertFails(getDoc(proof));
    await assertFails(setDoc(proof, { schoolId: "allocation-school", rows: [] }));
    await assertFails(updateDoc(proof, { rows: [] }));
    await assertFails(deleteDoc(proof));
    for (const collection of ['pages', 'versions']) {
      const page = doc(admin(), 'feeAllocationReconciliationRuns', 'run', collection, 'forged');
      await assertFails(getDoc(page)); await assertFails(setDoc(page, { schoolId: 'allocation-school', status: 'COMPLETE' }));
      await assertFails(updateDoc(page, { amountMinor: 100000 })); await assertFails(deleteDoc(page));
    }
  });
  it("refuse aux clients les brouillons, versions, états, soldes et mouvements", async () => {
    for (const name of ["feeAllocationStates", "feeAllocationConfigs", "feeAllocationVersions", "feeAllocationFeeGuards", "feeAllocationRequests", "feeAllocationOpeningAudits", "feeAllocationAnchors", "feeAllocationMovements", "feeAllocationBalances", "feeAllocationReconciliationRuns", 'feeAllocationHistoricalProofs', 'feeAllocationHistoricalDecisions', 'feeAllocationEvidenceClaims', 'feeAllocationEvidenceRevisions']) {
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
  it("refuse les écritures sensibles aux autres rôles et aux comptes désactivés", async () => {
    const cashier = environment.authenticatedContext("allocation-cashier", { role: "cashier", schoolId: "allocation-school" }).firestore();
    const disabled = environment.authenticatedContext("allocation-disabled", { role: "school_admin", schoolId: "allocation-school" }).firestore();
    const foreign = environment.authenticatedContext("allocation-admin", { role: "school_admin", schoolId: "foreign-school" }).firestore();
    for (const db of [cashier, disabled, foreign]) {
      await assertFails(setDoc(doc(db, "feeAllocationVersions", "forged-version"), { schoolId: "allocation-school", status: "published" }));
      await assertFails(setDoc(doc(db, "feeAllocationBalances", "forged-balance"), { schoolId: "allocation-school", availableMinor: 1_000_000 }));
      await assertFails(updateDoc(doc(db, "feeTypes", "guarded-fee"), { amount: 1 }));
    }
  }, 30000);
});
