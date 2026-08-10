import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "@firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const schoolId = "school-a";

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
}

describe("identité Enseignant pour la Direction des études", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-teacher-identity", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  }, 30_000);
  beforeEach(async () => {
    await environment.clearFirestore();
    await seed("users/teacher-a", { id: "teacher-a", name: "Enseignant A", email: "teacher-a@example.test", role: "teacher", schoolId, status: "active" });
    await seed("users/teacher-inactive", { id: "teacher-inactive", name: "Enseignant inactif", email: "inactive@example.test", role: "teacher", schoolId, status: "inactive" });
    await seed("users/cashier-a", { id: "cashier-a", name: "Caissier", email: "cashier@example.test", role: "cashier", schoolId, status: "active" });
    await seed("users/teacher-b", { id: "teacher-b", name: "Autre école", email: "teacher-b@example.test", role: "teacher", schoolId: "school-b", status: "active" });
  });
  afterAll(async () => environment.cleanup(), 30_000);

  it("autorise uniquement la requête tenantée des enseignants actifs", async () => {
    const database = environment.authenticatedContext("director-a", { role: "study_director", schoolId }).firestore();
    await assertSucceeds(getDocs(query(collection(database, "users"), where("schoolId", "==", schoolId), where("role", "==", "teacher"), where("status", "==", "active"))));
    await assertFails(getDocs(query(collection(database, "users"), where("schoolId", "==", schoolId))));
    await assertFails(getDoc(doc(database, "users", "cashier-a")));
    await assertFails(getDoc(doc(database, "users", "teacher-b")));
  });

  it("interdit au Directeur des études de créer ou modifier un compte", async () => {
    const database = environment.authenticatedContext("director-a", { role: "study_director", schoolId }).firestore();
    await assertFails(setDoc(doc(database, "users", "teacher-new"), { id: "teacher-new", role: "teacher", schoolId, status: "active" }));
    await assertFails(setDoc(doc(database, "users", "teacher-a"), { role: "teacher", schoolId, status: "inactive" }, { merge: true }));
    await assertFails(setDoc(doc(database, "teachers", "teacher-new"), { id: "teacher-new", userId: "teacher-new", schoolId, schoolYearId: "year-a", status: "active" }));
  });

  it("permet à l'Administrateur de lister uniquement les enseignants de son école", async () => {
    const database = environment.authenticatedContext("admin-a", { role: "school_admin", schoolId }).firestore();
    await assertSucceeds(getDocs(query(collection(database, "users"), where("schoolId", "==", schoolId), where("role", "==", "teacher"))));
    await assertFails(getDocs(query(collection(database, "users"), where("schoolId", "==", schoolId))));
    await assertSucceeds(getDoc(doc(database, "users", "cashier-a")));
    await assertFails(getDoc(doc(database, "users", "teacher-b")));
  });
});
