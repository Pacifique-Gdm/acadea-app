import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let env: RulesTestEnvironment;
const seed = (path: string, data: Record<string, unknown>) => env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const database = (role: "study_director" | "discipline_director", uid: string) => env.authenticatedContext(uid, { role, schoolId: "school-a" }).firestore();

beforeAll(async () => { env = await initializeTestEnvironment({ projectId: "demo-director-section-scope", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
beforeEach(async () => {
  await env.clearFirestore();
  await seed("users/studies", { schoolId: "school-a", role: "study_director", sectionIds: ["Primaire"] });
  await seed("users/discipline", { schoolId: "school-a", role: "discipline_director", sectionIds: ["Primaire"] });
  await seed("students/primary", { schoolId: "school-a", schoolYearId: "year-a", section: "Primaire" });
  await seed("students/secondary", { schoolId: "school-a", schoolYearId: "year-a", section: "Secondaire" });
  await seed("students/foreign", { schoolId: "school-b", schoolYearId: "year-a", section: "Primaire" });
});
afterAll(() => env.cleanup(), 30_000);

describe("périmètre section des directeurs", () => {
  for (const [role, uid] of [["study_director", "studies"], ["discipline_director", "discipline"]] as const) {
    it(`${role} autorise la même section`, async () => assertSucceeds(getDoc(doc(database(role, uid), "students", "primary"))));
    it(`${role} refuse une autre section`, async () => assertFails(getDoc(doc(database(role, uid), "students", "secondary"))));
    it(`${role} refuse une autre école`, async () => assertFails(getDoc(doc(database(role, uid), "students", "foreign"))));
  }

  it("autorise la query students bornée par école, année et section", async () => {
    const students = await assertSucceeds(getDocs(query(
      collection(database("discipline_director", "discipline"), "students"),
      where("schoolId", "==", "school-a"),
      where("schoolYearId", "==", "year-a"),
      where("section", "in", ["Primaire"]),
    )));
    expect(students.docs.map((item) => item.id)).toEqual(["primary"]);
  });

  it("refuse la query students non bornée par section", async () => {
    await assertFails(getDocs(query(
      collection(database("discipline_director", "discipline"), "students"),
      where("schoolId", "==", "school-a"),
      where("schoolYearId", "==", "year-a"),
    )));
  });
});
