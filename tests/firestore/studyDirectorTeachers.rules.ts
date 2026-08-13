import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, query, setDoc, where } from "@firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let environment: RulesTestEnvironment;
const school = "school-a", year = "year-a", directorId = "director-a";
const context = (tenant = school) => environment.authenticatedContext(directorId, { role: "study_director", schoolId: tenant }).firestore();
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((admin) => setDoc(doc(admin.firestore(), path), data));

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-study-director-teachers", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30000);
beforeEach(async () => {
  await environment.clearFirestore();
  await seed(`users/${directorId}`, { id: directorId, role: "study_director", schoolId: school, sectionIds: ["Primaire", "CTEB"], status: "active" });
  for (const [id, section] of [["primary", "Primaire"], ["cteb", "CTEB"], ["secondary", "Secondaire"]]) await seed(`students/${id}`, { id, schoolId: school, schoolYearId: year, section });
  await seed("students/foreign-year", { id: "foreign-year", schoolId: "school-b", schoolYearId: "year-b", section: "Primaire" });
  await seed("teachers/teacher-a", { schoolId: school, schoolYearId: year, section: "Primaire" });
  await seed("classes/class-a", { schoolId: school, schoolYearId: year, section: "Primaire" });
  await seed("subjects/subject-a", { schoolId: school, schoolYearId: year, section: "Primaire" });
  await seed("pedagogicalAssignments/assignment-a", { schoolId: school, schoolYearId: year, teacherId: "teacher-a", classId: "class-a", subjectId: "subject-a" });
});
afterAll(() => environment.cleanup(), 30000);

describe("chargement Enseignants du Directeur des études", () => {
  it("autorise exactement la requête students avec les sections canoniques", async () => {
    const database = context();
    const result = await assertSucceeds(getDocs(query(collection(database, "students"), where("schoolId", "==", school), where("schoolYearId", "==", year), where("section", "in", ["Primaire", "CTEB"]))));
    expect(result.docs.map((item) => item.id).sort()).toEqual(["cteb", "primary"]);
  });

  it("refuse section non attribuée, autre école, autre année et anonyme", async () => {
    await assertFails(getDocs(query(collection(context(), "students"), where("schoolId", "==", school), where("schoolYearId", "==", year), where("section", "==", "Secondaire"))));
    await assertFails(getDocs(query(collection(context("school-b"), "students"), where("schoolId", "==", school), where("schoolYearId", "==", year), where("section", "==", "Primaire"))));
    await assertFails(getDocs(query(collection(context(), "students"), where("schoolId", "==", "school-b"), where("schoolYearId", "==", "year-b"), where("section", "==", "Primaire"))));
    await assertFails(getDocs(query(collection(environment.unauthenticatedContext().firestore(), "students"), where("schoolId", "==", school), where("schoolYearId", "==", year), where("section", "==", "Primaire"))));
  });

  it("autorise les autres lectures nécessaires sans écriture globale", async () => {
    const database = context();
    for (const name of ["teachers", "classes", "subjects", "pedagogicalAssignments"]) {
      await assertSucceeds(getDocs(query(collection(database, name), where("schoolId", "==", school), where("schoolYearId", "==", year))));
    }
  });
});
