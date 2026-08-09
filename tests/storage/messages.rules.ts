import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { doc, setDoc } from "firebase/firestore";

let environment: RulesTestEnvironment;
const schoolId = "school-a";
const yearId = "year-a";
const senderId = "secretary-a";
const draftId = "draft-a";
const fileId = "123e4567-e89b-42d3-a456-426614174000";

function context(uid = senderId, role = "secretary", tenant = schoolId) {
  return environment.authenticatedContext(uid, { role, schoolId: tenant });
}

function upload(name: string, type: string, size = 1024, overrides: Record<string, string> = {}, uid = senderId, role = "secretary", tenant = schoolId) {
  return context(uid, role, tenant).storage().ref(`message-uploads/${schoolId}/${senderId}/${draftId}/${name}`).put(new Uint8Array(size), { contentType: type, customMetadata: { schoolId, schoolYearId: yearId, senderId, draftId, originalName: "document.pdf", ...overrides } });
}

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "acadea-staging", firestore: { rules: readFileSync("firestore.rules", "utf8") }, storage: { rules: readFileSync("storage.rules", "utf8") } }); }, 30_000);
beforeEach(async () => { await environment.clearFirestore(); await environment.clearStorage(); await environment.withSecurityRulesDisabled(async (admin) => setDoc(doc(admin.firestore(), "schools", schoolId), { status: "active" })); });
afterAll(async () => environment.cleanup(), 30_000);

describe("pièces jointes de messagerie", () => {
  it("autorise un upload temporaire canonique par son expéditeur", async () => { await assertSucceeds(upload(`${fileId}.pdf`, "application/pdf")); });
  it("autorise le chemin PNG réellement généré pour un Secrétaire de la même école", async () => {
    await assertSucceeds(upload("93d1175f-f5e9-408d-ae52-664fa8ec652a.png", "image/png"));
  });
  it.each([
    ["pdf", "application/pdf"],
    ["jpg", "image/jpeg"],
    ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ])("autorise le format %s", async (extension, type) => { await assertSucceeds(upload(`${fileId}.${extension}`, type)); });
  it("refuse un autre utilisateur, une autre école et un chemin forgé", async () => {
    const metadata = { contentType: "application/pdf", customMetadata: { schoolId, schoolYearId: yearId, senderId, draftId, originalName: "document.pdf" } };
    await assertFails(context("secretary-b").storage().ref(`message-uploads/${schoolId}/${senderId}/${draftId}/${fileId}.pdf`).put(new Uint8Array(10), metadata));
    await assertFails(context(senderId, "secretary", "school-b").storage().ref(`message-uploads/${schoolId}/${senderId}/${draftId}/${fileId}.pdf`).put(new Uint8Array(10), metadata));
    await assertFails(upload("document.pdf", "application/pdf"));
  });
  it("refuse un rôle non autorisé", async () => { await assertFails(upload(`${fileId}.pdf`, "application/pdf", 1024, {}, senderId, "parent")); });
  it("refuse un upload non authentifié", async () => {
    const metadata = { contentType: "application/pdf", customMetadata: { schoolId, schoolYearId: yearId, senderId, draftId, originalName: "document.pdf" } };
    await assertFails(environment.unauthenticatedContext().storage().ref(`message-uploads/${schoolId}/${senderId}/${draftId}/${fileId}.pdf`).put(new Uint8Array(10), metadata));
  });
  it.each([["html", "text/html"], ["svg", "image/svg+xml"], ["js", "application/javascript"], ["pdf", "image/png"]])("refuse %s/%s", async (extension, type) => { await assertFails(upload(`${fileId}.${extension}`, type)); });
  it.each([0, 10 * 1024 * 1024 + 1])("refuse une taille invalide (%s octets)", async (size) => { await assertFails(upload(`${fileId}.pdf`, "application/pdf", size)); });
  it("interdit toute lecture temporaire et autorise seulement le propriétaire à supprimer", async () => {
    const reference = context().storage().ref(`message-uploads/${schoolId}/${senderId}/${draftId}/${fileId}.pdf`);
    await assertSucceeds(upload(`${fileId}.pdf`, "application/pdf"));
    await assertFails(reference.getDownloadURL());
    await assertFails(context("secretary-b").storage().ref(reference.fullPath).delete());
    await assertFails(context(senderId, "secretary", "school-b").storage().ref(reference.fullPath).delete());
    await assertSucceeds(reference.delete());
  });
});
