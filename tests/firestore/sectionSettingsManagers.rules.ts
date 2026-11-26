import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Lot R6 : responsable des réglages de la section (lecture par l'école, écriture par le serveur seulement).
let environment: RulesTestEnvironment;
const schoolA = "school-r6-a", schoolB = "school-r6-b";
const database = (uid: string, role: string, schoolId = schoolA) => environment.authenticatedContext(uid, { role, schoolId }).firestore();
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const managers = { schoolId: schoolA, managers: { Secondaire: { userId: "prefect-a" } } };

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-section-managers", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30000);
beforeEach(async () => {
  await environment.clearFirestore();
  await seed("users/admin-a", { id: "admin-a", role: "school_admin", schoolId: schoolA, status: "active" });
  await seed("users/prefect-a", { id: "prefect-a", role: "study_director", studyFunction: "prefect_of_studies", schoolId: schoolA, sectionIds: ["Secondaire"], status: "active" });
  await seed("users/director-a", { id: "director-a", role: "study_director", schoolId: schoolA, sectionIds: ["Secondaire"], status: "active" });
  await seed("users/discipline-a", { id: "discipline-a", role: "discipline_director", schoolId: schoolA, status: "active" });
  await seed("users/admin-b", { id: "admin-b", role: "school_admin", schoolId: schoolB, status: "active" });
  await seed(`schools/${schoolA}`, { id: schoolA, name: "École A", status: "active" });
  await seed(`schools/${schoolB}`, { id: schoolB, name: "École B", status: "active" });
  await seed(`sectionSettingsManagers/${schoolA}`, managers);
});
afterAll(async () => environment?.cleanup(), 30000);

describe("responsable des réglages de la section", () => {
  it("se lit par les comptes de l'école", async () => {
    await assertSucceeds(getDoc(doc(database("admin-a", "school_admin"), "sectionSettingsManagers", schoolA)));
    await assertSucceeds(getDoc(doc(database("prefect-a", "study_director"), "sectionSettingsManagers", schoolA)));
    await assertSucceeds(getDoc(doc(database("director-a", "study_director"), "sectionSettingsManagers", schoolA)));
    await assertSucceeds(getDoc(doc(database("discipline-a", "discipline_director"), "sectionSettingsManagers", schoolA)));
  });
  it("jamais par une autre école ni sans connexion", async () => {
    await assertFails(getDoc(doc(database("admin-b", "school_admin", schoolB), "sectionSettingsManagers", schoolA)));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "sectionSettingsManagers", schoolA)));
  });
  it("aucune écriture depuis l'application, même par l'administrateur ou un compte d'études", async () => {
    await assertFails(setDoc(doc(database("admin-a", "school_admin"), "sectionSettingsManagers", schoolA), { schoolId: schoolA, managers: { Secondaire: { userId: "director-a" } } }));
    await assertFails(setDoc(doc(database("director-a", "study_director"), "sectionSettingsManagers", schoolA), { schoolId: schoolA, managers: { Secondaire: { userId: "director-a" } } }));
    await assertFails(setDoc(doc(database("prefect-a", "study_director"), "sectionSettingsManagers", schoolA), { schoolId: schoolA, managers: {} }));
    await assertFails(deleteDoc(doc(database("admin-a", "school_admin"), "sectionSettingsManagers", schoolA)));
    await assertFails(setDoc(doc(database("admin-b", "school_admin", schoolB), "sectionSettingsManagers", schoolB), { schoolId: schoolB, managers: {} }));
  });
});
