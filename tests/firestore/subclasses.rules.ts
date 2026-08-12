import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, writeBatch } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const school = "school-a"; const year = "year-a";
const context = (role: string, tenant = school) => environment.authenticatedContext(`${role}-a`, { role, schoolId: tenant }).firestore();
async function seed(path: string, data: Record<string, unknown>) { await environment.withSecurityRulesDisabled(async (admin) => setDoc(doc(admin.firestore(), path), data)); }
const child = (overrides: Record<string, unknown> = {}) => ({ id: "sub-a", schoolId: school, schoolYearId: year, name: "7ème CTEB - scientifique - A", parentClassId: "parent", classOptionKey: "parent::scientifique", subClassLabel: "A", active: true, createdBy: "secretary-a", createdAt: "2026-08-10", updatedAt: "2026-08-10", ...overrides });

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-acadea-subclasses", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
beforeEach(async () => { await environment.clearFirestore(); await seed(`schools/${school}`, { id: school, status: "active" }); await seed("schools/school-b", { id: "school-b", status: "active" }); await seed(`schoolYears/${year}`, { id: year, schoolId: school, status: "active" }); await seed("schoolYears/year-b", { id: "year-b", schoolId: "school-b", status: "active" }); await seed("classes/parent", { id: "parent", schoolId: school, schoolYearId: year, name: "7ème CTEB", active: true }); await seed("classes/foreign", { id: "foreign", schoolId: "school-b", schoolYearId: "year-b", name: "8ème", active: true }); });
afterAll(async () => environment?.cleanup(), 30_000);

describe("classes et sous-classes structurées", () => {
  it("autorise une sous-classe Secrétaire du même tenant et de la même année", async () => assertSucceeds(setDoc(doc(context("secretary"), "classes", "sub-a"), child())));
  it("refuse un parent d’une autre école ou année", async () => assertFails(setDoc(doc(context("secretary"), "classes", "sub-a"), child({ parentClassId: "foreign" }))));
  it("refuse les rôles non autorisés", async () => assertFails(setDoc(doc(context("cashier"), "classes", "sub-a"), child({ createdBy: "cashier-a" }))));
  it("refuse une sous-classe rattachée à une autre sous-classe", async () => { await seed("classes/sub-parent", child({ id: "sub-parent" })); await assertFails(setDoc(doc(context("secretary"), "classes", "sub-a"), child({ parentClassId: "sub-parent" }))); });
  it("refuse une identité de créateur falsifiée", async () => assertFails(setDoc(doc(context("secretary"), "classes", "sub-a"), child({ createdBy: "other" }))));
  it("refuse une identité d'option qui ne correspond pas à la classe parente", async () => assertFails(setDoc(doc(context("secretary"), "classes", "sub-a"), child({ classOptionKey: "other::scientifique" }))));
  it("autorise la matérialisation atomique d'une classe legacy et de deux sous-classes", async () => {
    const firestore = context("secretary");
    const batch = writeBatch(firestore);
    batch.set(doc(firestore, "classes", "legacy-parent"), { id: "legacy-parent", schoolId: school, schoolYearId: year, name: "Classe historique", active: true, createdBy: "secretary-a", createdAt: "2026-08-10", updatedAt: "2026-08-10" });
    batch.set(doc(firestore, "classes", "legacy-a"), child({ id: "legacy-a", parentClassId: "legacy-parent", classOptionKey: "legacy-parent::scientifique", name: "Classe historique - A" }));
    batch.set(doc(firestore, "classes", "legacy-b"), child({ id: "legacy-b", parentClassId: "legacy-parent", classOptionKey: "legacy-parent::scientifique", name: "Classe historique - B", subClassLabel: "B" }));
    await assertSucceeds(batch.commit());
  });
  it("refuse la matérialisation d'une classe legacy d'une autre école", async () => assertFails(setDoc(doc(context("secretary"), "classes", "foreign-legacy"), { id: "foreign-legacy", schoolId: "school-b", schoolYearId: "year-b", name: "Classe étrangère", active: true, createdBy: "secretary-a", createdAt: "2026-08-10", updatedAt: "2026-08-10" })));
  it("autorise l'élève seulement avec la sous-classe de l'option sélectionnée", async () => {
    await seed("classes/sub-a", child());
    const student = { id: "student-a", schoolId: school, schoolYearId: year, status: "ACTIVE", classId: "parent", subClassId: "sub-a", classOptionKey: "parent::scientifique" };
    await assertSucceeds(setDoc(doc(context("secretary"), "students", "student-a"), student));
    await assertFails(setDoc(doc(context("secretary"), "students", "student-b"), { ...student, id: "student-b", classOptionKey: "parent::litteraire" }));
  });
});
