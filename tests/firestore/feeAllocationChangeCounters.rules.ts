import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Version 1.15.2 : compteur de changements de la Répartition des frais (lecture seule, tenu par le serveur).
let environment: RulesTestEnvironment;
const schoolA = "school-counter-a", schoolB = "school-counter-b";
const counterA = `${schoolA}__year-a`;
const database = (uid: string, role: string, schoolId = schoolA) => environment.authenticatedContext(uid, { role, schoolId }).firestore();
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-allocation-counters", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30000);
beforeEach(async () => {
  await environment.clearFirestore();
  await seed("users/admin-a", { id: "admin-a", role: "school_admin", schoolId: schoolA, status: "active" });
  await seed("users/cashier-a", { id: "cashier-a", role: "cashier", schoolId: schoolA, status: "active" });
  await seed("users/admin-b", { id: "admin-b", role: "school_admin", schoolId: schoolB, status: "active" });
  await seed(`schools/${schoolA}`, { id: schoolA, name: "École A", status: "active" });
  await seed(`schools/${schoolB}`, { id: schoolB, name: "École B", status: "active" });
  await seed(`feeAllocationChangeCounters/${counterA}`, { schoolId: schoolA, schoolYearId: "year-a", count: 3, changedAt: "2026-11-19T00:00:00.000Z" });
});
afterAll(async () => environment?.cleanup(), 30000);

describe("compteur de changements de la répartition", () => {
  it("se lit par les comptes de l'école, même avant le premier changement", async () => {
    await assertSucceeds(getDoc(doc(database("admin-a", "school_admin"), "feeAllocationChangeCounters", counterA)));
    await assertSucceeds(getDoc(doc(database("cashier-a", "cashier"), "feeAllocationChangeCounters", counterA)));
    await assertSucceeds(getDoc(doc(database("admin-a", "school_admin"), "feeAllocationChangeCounters", `${schoolA}__year-new`)));
  });
  it("jamais par une autre école ni sans connexion", async () => {
    await assertFails(getDoc(doc(database("admin-b", "school_admin", schoolB), "feeAllocationChangeCounters", counterA)));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "feeAllocationChangeCounters", counterA)));
  });
  it("aucune écriture depuis l'application", async () => {
    await assertFails(setDoc(doc(database("admin-a", "school_admin"), "feeAllocationChangeCounters", counterA), { schoolId: schoolA, schoolYearId: "year-a", count: 4 }));
    await assertFails(setDoc(doc(database("admin-a", "school_admin"), "feeAllocationChangeCounters", `${schoolA}__year-b`), { schoolId: schoolA, count: 1 }));
  });
});
