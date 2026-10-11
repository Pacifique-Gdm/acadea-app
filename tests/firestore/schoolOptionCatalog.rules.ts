import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const catalog = "platformSettings/schoolOptionsCatalog";
const database = (uid: string, role: string) => environment.authenticatedContext(uid, { role, schoolId: "school-a" }).firestore();

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-school-option-catalog", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 60000);
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users/super"), { id: "super", role: "super_admin", status: "active" });
    await setDoc(doc(context.firestore(), "users/admin"), { id: "admin", role: "school_admin", schoolId: "school-a", status: "active" });
  });
});
afterAll(async () => environment?.cleanup(), 30000);

describe("catalogue global privé des options scolaires", () => {
  it("autorise uniquement le Super Administrateur actif à lire et ajouter", async () => {
    await assertSucceeds(setDoc(doc(database("super", "super_admin"), catalog), { options: ["Informatique"], updatedAt: "2026-10-11" }));
    await assertSucceeds(getDoc(doc(database("super", "super_admin"), catalog)));
    await assertFails(getDoc(doc(database("admin", "school_admin"), catalog)));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), catalog)));
    await assertFails(setDoc(doc(database("admin", "school_admin"), catalog), { options: ["Interdite"], updatedAt: "2026-10-11" }));
  });
  it("refuse champ imprévu et suppression", async () => {
    await assertFails(setDoc(doc(database("super", "super_admin"), catalog), { options: ["A"], updatedAt: "2026-10-11", secret: "x" }));
    await assertSucceeds(setDoc(doc(database("super", "super_admin"), catalog), { options: ["A"], updatedAt: "2026-10-11" }));
    await assertFails(deleteDoc(doc(database("super", "super_admin"), catalog)));
  });
});
