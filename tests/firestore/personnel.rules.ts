import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "@firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const schoolId = "school-a";
const internalRoles = ["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"];

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
}

describe("lecture sécurisée des Personnels", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-personnel", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  }, 30_000);
  beforeEach(async () => {
    await environment.clearFirestore();
    for (const role of internalRoles) await seed(`users/${role}-a`, { id: `${role}-a`, role, schoolId, status: "active", active: true });
    await seed("users/parent-a", { id: "parent-a", role: "parent", schoolId, status: "active", parentId: "parent-profile" });
    await seed("users/teacher-b", { id: "teacher-b", role: "teacher", schoolId: "school-b", status: "active" });
  });
  afterAll(async () => environment.cleanup(), 30_000);

  it("autorise à l’Administrateur la requête explicite des rôles internes de son école", async () => {
    const database = environment.authenticatedContext("school_admin-a", { role: "school_admin", schoolId }).firestore();
    await assertSucceeds(getDocs(query(collection(database, "users"), where("schoolId", "==", schoolId), where("role", "in", internalRoles))));
    await assertSucceeds(getDoc(doc(database, "users", "cashier-a")));
  });

  it("refuse Parent, une autre école et une requête non tenantée", async () => {
    const database = environment.authenticatedContext("school_admin-a", { role: "school_admin", schoolId }).firestore();
    await assertFails(getDoc(doc(database, "users", "parent-a")));
    await assertFails(getDoc(doc(database, "users", "teacher-b")));
    await assertFails(getDocs(query(collection(database, "users"), where("role", "in", internalRoles))));
  });

  it("interdit toute mutation directe des champs d’archivage, quel que soit le rôle", async () => {
    for (const [uid, claims] of [
      ["school_admin-a", { role: "school_admin", schoolId }],
      ["study_director-a", { role: "study_director", schoolId }],
      ["secretary-a", { role: "secretary", schoolId }],
    ] as const) {
      const database = environment.authenticatedContext(uid, claims).firestore();
      await assertFails(setDoc(doc(database, "users", "teacher-a"), { status: "inactive", active: false, archivedAt: "2026-08-10", archivedBy: uid }, { merge: true }));
    }
    const selfDatabase = environment.authenticatedContext("teacher-a", { role: "teacher", schoolId }).firestore();
    await assertFails(setDoc(doc(selfDatabase, "users", "teacher-a"), { active: false }, { merge: true }));
  });
});
