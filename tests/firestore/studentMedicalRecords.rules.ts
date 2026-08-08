import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, doc, getDocs, query, runTransaction, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-acadea-medical-records";
const schoolId = "school-a";
const schoolYearId = "year-a";
const studentId = "student-a";
const userId = "user-a";
let environment: RulesTestEnvironment | undefined;

function testEnvironment() {
  if (!environment) throw new Error("L'environnement de test Firestore n'est pas initialisé.");
  return environment;
}

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
  await testEnvironment().withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "students", id), { id, schoolId: tenant, schoolYearId: year });
  });
}

async function seedMedicalRecord(tenant = schoolId) {
  await testEnvironment().withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "studentMedicalRecords", studentId), payload({ schoolId: tenant }));
  });
}

function medicalRecordsQuery(role?: string, tenant = schoolId) {
  const firestore = role ? authenticated(role, tenant) : testEnvironment().unauthenticatedContext().firestore();
  return getDocs(query(collection(firestore, "studentMedicalRecords"), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)));
}

function authenticated(role: string, tenant = schoolId, uid = userId) {
  return testEnvironment().authenticatedContext(uid, { role, schoolId: tenant }).firestore();
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
}, 30_000);

beforeEach(async () => {
  await testEnvironment().clearFirestore();
  await testEnvironment().withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "schoolYears", schoolYearId), { id: schoolYearId, schoolId, status: "active" });
  });
  await seedStudent();
});

afterAll(async () => environment?.cleanup(), 30_000);

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
    await testEnvironment().clearFirestore();
    await seedStudent(studentId, "school-b");
    await assertFails(createLikeFrontend("secretary"));
  });

  it("refuse un utilisateur non authentifié", async () => {
    await assertFails(setDoc(doc(testEnvironment().unauthenticatedContext().firestore(), "studentMedicalRecords", studentId), payload()));
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

  it("autorise l'actualisation des fiches pour l'Administrateur de la même école", async () => {
    await seedMedicalRecord();
    await assertSucceeds(medicalRecordsQuery("school_admin"));
  });

  it("autorise l'actualisation des fiches pour le Secrétaire de la même école", async () => {
    await seedMedicalRecord();
    await assertSucceeds(medicalRecordsQuery("secretary"));
  });

  it("refuse l'actualisation depuis une autre école", async () => {
    await seedMedicalRecord();
    await assertFails(medicalRecordsQuery("secretary", "school-b"));
  });

  it("refuse l'actualisation non authentifiée", async () => {
    await seedMedicalRecord();
    await assertFails(medicalRecordsQuery());
  });

  it("refuse l'actualisation à un rôle inconnu", async () => {
    await seedMedicalRecord();
    await assertFails(medicalRecordsQuery("teacher"));
  });
});
