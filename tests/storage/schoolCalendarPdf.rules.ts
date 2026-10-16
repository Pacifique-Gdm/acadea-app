import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const schoolId = "school-a", yearId = "year-a", uuid = "123e4567-e89b-12d3-a456-426614174000";
const path = `school-calendars/${schoolId}/${yearId}/${uuid}.pdf`;
let environment: RulesTestEnvironment;
const context = (role?: string, tenant = schoolId) => role ? environment.authenticatedContext("director", { role, schoolId: tenant }) : environment.unauthenticatedContext();
const metadata = (extra: Record<string, string> = {}) => ({ contentType: "application/pdf", customMetadata: { schoolId, schoolYearId: yearId, uploadedBy: "director", originalName: "calendrier.pdf", ...extra } });
const upload = (role?: string, tenant = schoolId, size = 1024, target = path) => context(role, tenant).storage().ref(target).put(new Uint8Array(size), metadata());

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "acadea-staging", firestore: { rules: readFileSync("firestore.rules", "utf8") }, storage: { rules: readFileSync("storage.rules", "utf8") } });
}, 60_000);
beforeEach(async () => {
  await environment.clearStorage();
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), `schools/${schoolId}`), { status: "active", activeSchoolYearId: yearId });
    await setDoc(doc(admin.firestore(), `schoolYears/${yearId}`), { schoolId, status: "active" });
  });
}, 60_000);
afterAll(async () => environment?.cleanup(), 30_000);

describe("PDF source du calendrier", () => {
  it("autorise seulement le Directeur du bon établissement à écrire et consulter", async () => {
    await assertFails(upload());
    await assertFails(upload("teacher"));
    await assertFails(upload("study_director", "school-b"));
    await assertSucceeds(upload("study_director"));
    await assertSucceeds(context("study_director").storage().ref(path).getDownloadURL());
    await assertFails(context("study_director", "school-b").storage().ref(path).getDownloadURL());
    await assertFails(context("teacher").storage().ref(path).getDownloadURL());
    await assertFails(context("study_director").storage().ref("school-calendars/school-a/year-a").listAll());
    await assertFails(upload("study_director"));
  }, 60_000);
  it("refuse type, métadonnées, taille et année non active", async () => {
    await assertFails(context("study_director").storage().ref(path).put(new Uint8Array(1024), { ...metadata(), contentType: "text/html" }));
    await assertFails(context("study_director").storage().ref(path).put(new Uint8Array(1024), metadata({ schoolId: "school-b" })));
    await assertFails(upload("study_director", schoolId, 10 * 1024 * 1024 + 1));
    await environment.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), `schools/${schoolId}`), { status: "active", activeSchoolYearId: "other-year" });
    });
    await assertFails(upload("study_director"));
  }, 60_000);
  it("permet le nettoyage d'un upload orphelin, mais jamais la suppression d'un PDF référencé", async () => {
    const orphanPath = `school-calendars/${schoolId}/${yearId}/123e4567-e89b-12d3-a456-426614174002.pdf`;
    await assertSucceeds(upload("study_director", schoolId, 1024, orphanPath));
    await assertSucceeds(context("study_director").storage().ref(orphanPath).delete());
    await expect(context("study_director").storage().ref(orphanPath).getMetadata()).rejects.toMatchObject({ code: "storage/object-not-found" });
    const referencedPath = `school-calendars/${schoolId}/${yearId}/123e4567-e89b-12d3-a456-426614174001.pdf`;
    await assertSucceeds(upload("study_director", schoolId, 1024, referencedPath));
    await environment.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), `schoolCalendars/${yearId}`), { schoolId, schoolYearId: yearId, status: "draft", sourcePdf: { path: referencedPath } });
    });
    await assertFails(context("study_director").storage().ref(referencedPath).delete());
  }, 60_000);
});
