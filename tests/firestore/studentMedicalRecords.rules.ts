import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, doc, runTransaction, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-acadea-medical-records";
const schoolId = "school-a";
const schoolYearId = "year-a";
const studentId = "student-a";
const userId = "user-a";
let environment: RulesTestEnvironment;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: studentId,
    studentId,
    schoolId,
    schoolYearId,
    createdBy: userId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    bloodGroup: "A+",
    emergencyContactName: "Contact test",
    emergencyContactPhone: "+243000000000",
    emergencyContactRelationship: "Parent",
    ...overrides,
  };
}

async function seedStudent(id = studentId, tenant = schoolId, year = schoolYearId) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "students", id), { id, schoolId: tenant, schoolYearId: year });
  });
}

function authenticated(role: string, tenant = schoolId, uid = userId) {
  return environment.authenticatedContext(uid, { role, schoolId: tenant }).firestore();
}

async function createLikeFrontend(role: string, overrides: Record<string, unknown> = {}, tenant = schoolId) {
  const firestore = authenticated(role, tenant);
  const recordRef = doc(firestore, "studentMedicalRecords", studentId);
  return runTransaction(firestore, async (transaction) => {
    await transaction.get(recordRef);
    transaction.set(recordRef, payload(overrides), { merge: true });
  });
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seedStudent();
});

afterAll(async () => environment.cleanup());

describe("studentMedicalRecords", () => {
  it("autorise l'Administrateur de la même école avec le payload frontend réel", async () => {
    await assertSucceeds(createLikeFrontend("school_admin"));
  });

  it("autorise l'ancien claim Administrateur normalisé par le frontend", async () => {
    await assertSucceeds(createLikeFrontend("admin"));
  });

  it("autorise le Secrétaire de la même école avec le payload frontend réel", async () => {
    await assertSucceeds(createLikeFrontend("secretary"));
  });

  it("refuse un élève d'une autre école", async () => {
    await environment.clearFirestore();
    await seedStudent(studentId, "school-b");
    await assertFails(createLikeFrontend("secretary"));
  });

  it("refuse un utilisateur non authentifié", async () => {
    await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), "studentMedicalRecords", studentId), payload()));
  });

  it("refuse un rôle inconnu", async () => {
    await assertFails(createLikeFrontend("teacher"));
  });

  it("refuse un schoolId manquant ou falsifié", async () => {
    await assertFails(createLikeFrontend("secretary", { schoolId: "school-b" }));
  });

  it("refuse un createdBy différent de l'utilisateur authentifié", async () => {
    await assertFails(createLikeFrontend("secretary", { createdBy: "other-user" }));
  });

  it("refuse un createdAt absent", async () => {
    const data = payload();
    delete (data as Partial<typeof data>).createdAt;
    const firestore = authenticated("secretary");
    await assertFails(setDoc(doc(firestore, "studentMedicalRecords", studentId), data));
  });
});
