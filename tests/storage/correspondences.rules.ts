import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const schoolId = "school-security-a";
const correspondenceId = "correspondence-security";
const archivedId = "correspondence-archived";
const path = (id: string) => `schools/${schoolId}/correspondences/${id}/document.pdf`;
const context = (uid: string, role: string, tenant = schoolId) => environment.authenticatedContext(uid, { role, schoolId: tenant });

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-acadea-security-s1-s4",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
}, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
  await environment.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    await Promise.all([
      setDoc(doc(db, "schools", schoolId), { status: "active" }),
      setDoc(doc(db, "correspondences", correspondenceId), { schoolId, status: "received" }),
      setDoc(doc(db, "correspondences", archivedId), { schoolId, status: "archived" }),
      setDoc(doc(db, "users", "secretary-a"), { role: "secretary", schoolId, status: "active", active: true }),
    ]);
    await admin.storage().ref(path(correspondenceId)).put(new Uint8Array([1]), { contentType: "application/pdf" });
    await admin.storage().ref(path(archivedId)).put(new Uint8Array([1]), { contentType: "application/pdf" });
  });
});
afterAll(async () => environment.cleanup(), 30_000);

describe("pièces jointes de correspondance", () => {
  it("refuse la lecture directe à tous les rôles, même pour les fichiers historiques", async () => {
    for (const id of [correspondenceId, archivedId]) {
      await assertFails(context("secretary-a", "secretary").storage().ref(path(id)).getDownloadURL());
      await assertFails(context("parent-a", "parent").storage().ref(path(id)).getDownloadURL());
      await assertFails(environment.unauthenticatedContext().storage().ref(path(id)).getDownloadURL());
    }
  });

  it("refuse création, écrasement et suppression directs, même au Secrétaire", async () => {
    const storage = context("secretary-a", "secretary").storage();
    await assertFails(storage.ref(`schools/${schoolId}/correspondences/${correspondenceId}/nouvelle.pdf`).put(new Uint8Array([2]), { contentType: "application/pdf" }));
    await assertFails(storage.ref(path(correspondenceId)).put(new Uint8Array([2]), { contentType: "application/pdf" }));
    await assertFails(storage.ref(path(correspondenceId)).delete());
    await assertFails(storage.ref(path(archivedId)).delete());
  });
});
