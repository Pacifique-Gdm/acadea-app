import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const schoolId = "school-a";
const schoolYearId = "year-a";

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), path), data));
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-acadea-parent-medical", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30_000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed("students/student-a", { id: "student-a", schoolId, schoolYearId, parentId: "parent-a" });
  await seed("students/student-b", { id: "student-b", schoolId, schoolYearId, parentId: "parent-b" });
  await seed("students/student-a-2", { id: "student-a-2", schoolId, schoolYearId, parentId: "parent-a" });
  await seed("students/student-empty", { id: "student-empty", schoolId, schoolYearId, parentId: "parent-a" });
  await seed("studentMedicalRecords/student-a", { id: "student-a", studentId: "student-a", schoolId, schoolYearId, allergies: "Aucune" });
  await seed("studentMedicalRecords/student-a-2", { id: "student-a-2", studentId: "student-a-2", schoolId, schoolYearId, allergies: "Aucune" });
  await seed("studentMedicalRecords/student-b", { id: "student-b", studentId: "student-b", schoolId, schoolYearId, allergies: "Aucune" });
});

afterAll(async () => environment?.cleanup(), 30_000);

describe("lecture Parent des fiches medicales", () => {
  it("autorise uniquement la fiche de l'enfant lie", async () => {
    const parent = environment.authenticatedContext("parent-user-a", { role: "parent", schoolId, parentId: "parent-a" }).firestore();
    await assertSucceeds(getDoc(doc(parent, "studentMedicalRecords", "student-a")));
    await assertSucceeds(getDoc(doc(parent, "studentMedicalRecords", "student-a-2")));
    await assertSucceeds(getDoc(doc(parent, "studentMedicalRecords", "student-empty")));
    await assertFails(getDoc(doc(parent, "studentMedicalRecords", "student-b")));
  });

  it("refuse une autre ecole et toutes les ecritures Parent", async () => {
    const external = environment.authenticatedContext("parent-user-x", { role: "parent", schoolId: "school-b", parentId: "parent-a" }).firestore();
    await assertFails(getDoc(doc(external, "studentMedicalRecords", "student-a")));
    const parent = environment.authenticatedContext("parent-user-a", { role: "parent", schoolId, parentId: "parent-a" }).firestore();
    await assertFails(setDoc(doc(parent, "studentMedicalRecords", "student-empty"), { id: "student-empty", studentId: "student-empty", schoolId, schoolYearId }));
    await assertFails(updateDoc(doc(parent, "studentMedicalRecords", "student-a"), { allergies: "Modification interdite" }));
    await assertFails(deleteDoc(doc(parent, "studentMedicalRecords", "student-a")));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "studentMedicalRecords", "student-a")));
  });
});
