import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Lot B (règle unique des sections) : B1 élèves sans section, B2 lecture directe des demandes d'indisponibilité.
let env: RulesTestEnvironment;
const school = "school-a", year = "year-a";
const context = (uid: string, role: string) => env.authenticatedContext(uid, { role, schoolId: school }).firestore();
const seed = (path: string, data: Record<string, unknown>) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), path), data));
const account = (uid: string, role: string, sections?: string[]) => seed(`users/${uid}`, {
  id: uid, role, schoolId: school, status: "active", active: true, ...(sections ? { sectionIds: sections } : {}),
});

describe("Lot B — règles de la règle unique des sections", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: "demo-lot-b-sections", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  }, 30000);
  beforeEach(async () => {
    await env.clearFirestore();
    await seed(`schools/${school}`, { id: school, status: "active", schoolType: "CTEB et Secondaire", activeSchoolYearId: year });
    await seed("students/sans-section", { id: "sans-section", schoolId: school, schoolYearId: year, nom: "Fictif" });
    await seed("students/secondaire", { id: "secondaire", schoolId: school, schoolYearId: year, section: "Secondaire", nom: "Fictif" });
    await seed("teacherAvailabilityRequests/r", { id: "r", schoolId: school, schoolYearId: year, teacherId: "t", userId: "u", status: "PENDING" });
  });
  afterAll(async () => { await env?.cleanup(); });

  describe("B1 — élève sans section", () => {
    for (const role of ["study_director", "discipline_director"]) {
      it(`${role} couvrant toutes les sections de l'école : lit l'élève sans section`, async () => {
        await account("couvre", role, ["CTEB", "Secondaire"]);
        await assertSucceeds(getDoc(doc(context("couvre", role), "students/sans-section")));
        await assertSucceeds(getDoc(doc(context("couvre", role), "students/secondaire")));
      });
      it(`${role} d'une partie des sections : ne lit pas l'élève sans section (inchangé)`, async () => {
        await account("partiel", role, ["Secondaire"]);
        await assertFails(getDoc(doc(context("partiel", role), "students/sans-section")));
        await assertSucceeds(getDoc(doc(context("partiel", role), "students/secondaire")));
      });
      it(`${role} sans section : lit tout (inchangé)`, async () => {
        await account("libre", role);
        await assertSucceeds(getDoc(doc(context("libre", role), "students/sans-section")));
      });
    }
    it("sections d'une autre école : jamais élargi", async () => {
      await seed("users/ailleurs", { id: "ailleurs", role: "study_director", schoolId: "school-b", status: "active", active: true, sectionIds: ["CTEB", "Secondaire"] });
      await assertFails(getDoc(doc(context("ailleurs", "study_director"), "students/sans-section")));
    });
  });

  describe("B2 — lecture directe des demandes d'indisponibilité", () => {
    it("compte sans section : lecture directe gardée", async () => {
      await account("libre", "study_director");
      await assertSucceeds(getDoc(doc(context("libre", "study_director"), "teacherAvailabilityRequests/r")));
    });
    it("compte avec sections (même couvrant toute l'école) : passe par le serveur", async () => {
      await account("partiel", "study_director", ["Secondaire"]);
      await account("couvre", "study_director", ["CTEB", "Secondaire"]);
      await assertFails(getDoc(doc(context("partiel", "study_director"), "teacherAvailabilityRequests/r")));
      await assertFails(getDoc(doc(context("couvre", "study_director"), "teacherAvailabilityRequests/r")));
    });
  });
});
