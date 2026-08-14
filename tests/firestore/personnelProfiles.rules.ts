import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const profile = { id: "teacher-a", personnelId: "teacher-a", schoolId: "school-a", matricule: "PER-000001", birthDate: "1990-01-01", createdAt: "2024-01-01", createdBy: "admin-a", updatedAt: "2026-01-01", updatedBy: "admin-a" };
const context = (uid: string, role: string, schoolId = "school-a") => environment.authenticatedContext(uid, { role, schoolId }).firestore();

describe("profils administratifs du personnel", () => {
  beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-personnel-profiles", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
  beforeEach(async () => { await environment.clearFirestore(); await environment.withSecurityRulesDisabled(async (admin) => { await setDoc(doc(admin.firestore(), "personnelProfiles", "teacher-a"), profile); await setDoc(doc(admin.firestore(), "personnelProfiles", "teacher-b"), { ...profile, id: "teacher-b", personnelId: "teacher-b", schoolId: "school-b" }); await setDoc(doc(admin.firestore(), "users", "teacher-a"), { id: "teacher-a", role: "teacher", schoolId: "school-a", name: "Test" }); }); });
  afterAll(async () => environment.cleanup(), 30_000);

  it("autorise uniquement l’Administrateur de la même école à lire", async () => {
    await assertSucceeds(getDoc(doc(context("admin-a", "school_admin"), "personnelProfiles", "teacher-a")));
    await assertFails(getDoc(doc(context("admin-a", "school_admin"), "personnelProfiles", "teacher-b")));
  });
  it("refuse utilisateur ordinaire, personnel lui-même et non authentifié", async () => {
    await assertFails(getDoc(doc(context("secretary-a", "secretary"), "personnelProfiles", "teacher-a")));
    await assertFails(getDoc(doc(context("teacher-a", "teacher"), "personnelProfiles", "teacher-a")));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "personnelProfiles", "teacher-a")));
  });
  it("refuse toutes les écritures directes et toute altération école/propriétaire", async () => {
    const database = context("admin-a", "school_admin");
    await assertFails(setDoc(doc(database, "personnelProfiles", "new"), { ...profile, id: "new", personnelId: "new" }));
    await assertFails(updateDoc(doc(database, "personnelProfiles", "teacher-a"), { observations: "x" }));
    await assertFails(updateDoc(doc(database, "personnelProfiles", "teacher-a"), { schoolId: "school-b" }));
    await assertFails(updateDoc(doc(database, "personnelProfiles", "teacher-a"), { personnelId: "other", id: "other" }));
  });
  it("ne change pas les protections users existantes", async () => {
    await assertFails(updateDoc(doc(context("admin-a", "school_admin"), "users", "teacher-a"), { role: "school_admin" }));
    await assertFails(updateDoc(doc(context("teacher-a", "teacher"), "users", "teacher-a"), { schoolId: "school-b" }));
  });
});
