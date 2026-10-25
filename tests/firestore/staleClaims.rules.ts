import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const context = (role: string, schoolId: string) => environment.authenticatedContext("secretary-transfer", { role, schoolId }).firestore();

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-acadea-stale-claims",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
}, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    await Promise.all([
      setDoc(doc(db, "schools", "school-a"), { status: "active" }),
      setDoc(doc(db, "schools", "school-b"), { status: "active" }),
      setDoc(doc(db, "users", "secretary-transfer"), { role: "secretary", schoolId: "school-b", status: "active", active: true }),
    ]);
  });
});
afterAll(async () => environment.cleanup(), 30_000);

describe("claims périmés après transfert", () => {
  it("refuse l'ancien établissement tout en acceptant le nouveau", async () => {
    await assertFails(getDoc(doc(context("secretary", "school-a"), "schools", "school-a")));
    await assertSucceeds(getDoc(doc(context("secretary", "school-b"), "schools", "school-b")));
  });
  it("refuse un ancien rôle après mise à jour du profil", async () => {
    await environment.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), "users", "secretary-transfer"), { role: "teacher", schoolId: "school-b", status: "active", active: true });
    });
    await assertFails(getDoc(doc(context("secretary", "school-b"), "schools", "school-b")));
    await assertSucceeds(getDoc(doc(context("teacher", "school-b"), "schools", "school-b")));
  });
  it("refuse une session désormais inactive", async () => {
    await environment.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), "users", "secretary-transfer"), { role: "secretary", schoolId: "school-b", status: "inactive", active: false });
    });
    await assertFails(getDoc(doc(context("secretary", "school-b"), "schools", "school-b")));
  });
});
