import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-acadea-valves-attachments";
const schoolId = "school-a";
const schoolYearId = "year-a";
const publicationId = "valve-a";
const fileId = "123e4567-e89b-42d3-a456-426614174000";
const path = `valves/${schoolId}/${schoolYearId}/${publicationId}/${fileId}.pdf`;
const url = `https://firebasestorage.googleapis.com/v0/b/acadea-staging.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=test`;
let environment: RulesTestEnvironment;

const publication = (attachments?: unknown[]) => ({ id: publicationId, schoolId, schoolYearId, title: "Information", body: "Texte", authorId: "secretary-a", ...(attachments ? { attachments } : {}) });
const attachment = (overrides: Record<string, unknown> = {}) => ({ name: "document.pdf", type: "application/pdf", size: 1024, path, url, ...overrides });

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), "schoolYears", schoolYearId), { id: schoolYearId, schoolId, status: "active" }));
});
afterAll(async () => environment.cleanup(), 30_000);

describe("références des pièces jointes Valves", () => {
  const firestore = () => environment.authenticatedContext("secretary-a", { role: "secretary", schoolId }).firestore();

  it("autorise uniquement une référence Firebase Storage canonique du tenant", async () => {
    await assertSucceeds(setDoc(doc(firestore(), "valves", publicationId), publication([attachment()])));
    await assertFails(setDoc(doc(firestore(), "valves", "valve-cross-school"), { ...publication([attachment({ path: path.replace(schoolId, "school-b") })]), id: "valve-cross-school" }));
  });

  it.each([
    ["URL externe", { path, url: "https://example.org/document.pdf" }],
    ["URL javascript", { path, url: "javascript:alert(1)" }],
    ["data URL", { path, url: "data:application/pdf;base64,AA==" }],
    ["chemin forgé", { path: path.replace(schoolId, "school-b"), url }],
  ])("refuse %s dans une nouvelle écriture", async (_label, overrides) => {
    await assertFails(setDoc(doc(firestore(), "valves", publicationId), publication([attachment(overrides)])));
  });

  it("refuse les anciens champs URL dans une nouvelle écriture mais préserve un document historique inchangé", async () => {
    await assertFails(setDoc(doc(firestore(), "valves", publicationId), { ...publication(), attachmentUrl: "https://example.org/legacy.pdf" }));
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), "valves", publicationId), { ...publication(), attachmentUrl: "https://example.org/legacy.pdf" }));
    await assertSucceeds(updateDoc(doc(firestore(), "valves", publicationId), { title: "Information mise à jour" }));
    await assertFails(updateDoc(doc(firestore(), "valves", publicationId), { attachmentUrl: "https://evil.example/file.pdf" }));
  });
});
