import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-acadea-secretary-documents";
const schoolId = "school-a";
const schoolYearId = "year-a";
let environment: RulesTestEnvironment | undefined;

function testEnvironment() {
  if (!environment) throw new Error("L'environnement Firestore n'est pas initialisé.");
  return environment;
}

function secretary(tenant = schoolId) {
  return testEnvironment().authenticatedContext("secretary-a", { role: "secretary", schoolId: tenant }).firestore();
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30_000);

beforeEach(async () => testEnvironment().clearFirestore());
afterAll(async () => environment?.cleanup(), 30_000);

describe("documents du Secrétaire", () => {
  it("autorise la création d'un élève et la gestion d'un parent dans son école uniquement", async () => {
    const firestore = secretary();
    await assertSucceeds(setDoc(doc(firestore, "students", "student-a"), { id: "student-a", schoolId, schoolYearId, status: "ACTIVE", nom: "Test" }));
    await assertSucceeds(setDoc(doc(firestore, "parents", "parent-a"), { id: "parent-a", schoolId, schoolYearId, fullName: "Parent", studentIds: ["student-a"], status: "active" }));
    await assertSucceeds(setDoc(doc(firestore, "parents", "parent-a"), { id: "parent-a", schoolId, schoolYearId, fullName: "Parent modifié", studentIds: ["student-a"], status: "active" }));
    await assertFails(setDoc(doc(firestore, "parents", "parent-b"), { id: "parent-b", schoolId: "school-b", schoolYearId, fullName: "Hors école", studentIds: [], status: "active" }));
  });
  it("réserve puis incrémente atomiquement un compteur de référence dans son école", async () => {
    const firestore = secretary();
    const counterRef = doc(firestore, "secretaryCounters", `${schoolId}_SEC_2026`);
    await assertSucceeds(runTransaction(firestore, async (transaction) => {
      await transaction.get(counterRef);
      transaction.set(counterRef, { schoolId, schoolYearId, kind: "correspondence", serviceCode: "SEC", year: 2026, value: 1, updatedAt: serverTimestamp() });
    }));
    await assertSucceeds(runTransaction(firestore, async (transaction) => {
      const current = await transaction.get(counterRef);
      transaction.set(counterRef, { ...current.data(), value: 2, updatedAt: serverTimestamp() });
    }));
  });

  it("refuse la création d'un compteur pour une autre école", async () => {
    await assertFails(setDoc(doc(secretary(), "secretaryCounters", "school-b_SEC_2026"), { schoolId: "school-b", schoolYearId, kind: "correspondence", serviceCode: "SEC", year: 2026, value: 1, updatedAt: serverTimestamp() }));
  });

  it("refuse les sauts de séquence", async () => {
    const firestore = secretary();
    const counterRef = doc(firestore, "secretaryCounters", `${schoolId}_SEC_2026`);
    await assertSucceeds(setDoc(counterRef, { schoolId, schoolYearId, kind: "correspondence", serviceCode: "SEC", year: 2026, value: 1, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(counterRef, { schoolId, schoolYearId, kind: "correspondence", serviceCode: "SEC", year: 2026, value: 3, updatedAt: serverTimestamp() }));
  });
});
