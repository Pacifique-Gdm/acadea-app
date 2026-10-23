import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const schoolId = "school-security-a";
const otherSchoolId = "school-security-b";
const correspondenceId = "correspondence-security";
const archivedId = "correspondence-archived";
const fileName = "document.pdf";
const path = (id: string) => `schools/${schoolId}/correspondences/${id}/${fileName}`;
const context = (uid: string, role: string, tenant = schoolId) => environment.authenticatedContext(uid, { role, schoolId: tenant, ...(role === "parent" ? { parentId: "parent-a" } : {}) });

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
      setDoc(doc(db, "schools", otherSchoolId), { status: "active" }),
      setDoc(doc(db, "correspondences", correspondenceId), { schoolId, status: "received" }),
      setDoc(doc(db, "correspondences", archivedId), { schoolId, status: "archived" }),
      ...[
        ["secretary-a", "secretary", schoolId],
        ["parent-a", "parent", schoolId],
        ["teacher-a", "teacher", schoolId],
        ["cashier-a", "cashier", schoolId],
        ["secretary-b", "secretary", otherSchoolId],
      ].map(([uid, role, tenant]) => setDoc(doc(db, "users", uid), { role, schoolId: tenant, status: "active", active: true, ...(role === "parent" ? { parentId: "parent-a" } : {}) })),
    ]);
    await admin.storage().ref(path(correspondenceId)).put(new Uint8Array([1]), { contentType: "application/pdf" });
    await admin.storage().ref(path(archivedId)).put(new Uint8Array([1]), { contentType: "application/pdf" });
  });
});
afterAll(async () => environment.cleanup(), 30_000);

describe("pièces jointes de correspondance", () => {
  it("autorise la lecture par le Secrétaire de la même école, active ou archivée", async () => {
    await assertSucceeds(context("secretary-a", "secretary").storage().ref(path(correspondenceId)).getDownloadURL());
    await assertSucceeds(context("secretary-a", "secretary").storage().ref(path(archivedId)).getDownloadURL());
  });
  it.each([["parent-a", "parent"], ["teacher-a", "teacher"], ["cashier-a", "cashier"]])("refuse la lecture au rôle %s", async (uid, role) => {
    await assertFails(context(uid, role).storage().ref(path(correspondenceId)).getDownloadURL());
  });
  it("refuse une autre école et un utilisateur non authentifié", async () => {
    await assertFails(context("secretary-b", "secretary", otherSchoolId).storage().ref(path(correspondenceId)).getDownloadURL());
    await assertFails(environment.unauthenticatedContext().storage().ref(path(correspondenceId)).getDownloadURL());
  });
  it("révoque l'ancien jeton après transfert sans bloquer la nouvelle école", async () => {
    await environment.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), "users", "secretary-a"), { role: "secretary", schoolId: otherSchoolId, status: "active", active: true });
      await setDoc(doc(admin.firestore(), "correspondences", "correspondence-b"), { schoolId: otherSchoolId, status: "received" });
      await admin.storage().ref(`schools/${otherSchoolId}/correspondences/correspondence-b/${fileName}`).put(new Uint8Array([1]), { contentType: "application/pdf" });
    });
    await assertFails(context("secretary-a", "secretary", schoolId).storage().ref(path(correspondenceId)).getDownloadURL());
    await assertSucceeds(context("secretary-a", "secretary", otherSchoolId).storage().ref(`schools/${otherSchoolId}/correspondences/correspondence-b/${fileName}`).getDownloadURL());
  });
  it("permet la création d'une nouvelle pièce active et interdit son écrasement", async () => {
    const reference = context("secretary-a", "secretary").storage().ref(`schools/${schoolId}/correspondences/${correspondenceId}/nouvelle.pdf`);
    await assertSucceeds(reference.put(new Uint8Array([1]), { contentType: "application/pdf" }));
    await assertFails(reference.put(new Uint8Array([2]), { contentType: "application/pdf" }));
  });
  it("interdit la création et l'écrasement d'une pièce archivée", async () => {
    const secretary = context("secretary-a", "secretary").storage();
    await assertFails(secretary.ref(`schools/${schoolId}/correspondences/${archivedId}/nouvelle.pdf`).put(new Uint8Array([2]), { contentType: "application/pdf" }));
    await assertFails(secretary.ref(path(archivedId)).put(new Uint8Array([2]), { contentType: "application/pdf" }));
    await assertFails(secretary.ref(path(archivedId)).delete());
    await assertSucceeds(secretary.ref(path(correspondenceId)).delete());
  });
});
