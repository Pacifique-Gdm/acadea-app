import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const uuid = "123e4567-e89b-42d3-a456-426614174000";
const context = (uid = "admin-a", role = "school_admin", schoolId = "school-a") => environment.authenticatedContext(uid, { role, schoolId });
const upload = (type: string, extension: string, size = 1024, tenant = "school-a", role = "school_admin") => context("admin-a", role, tenant).storage().ref(`personnel-photos/school-a/teacher-a/${uuid}.${extension}`).put(new Uint8Array(size), { contentType: type, customMetadata: { schoolId: "school-a", personnelId: "teacher-a" } });

describe("photos du personnel", () => {
  beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT || "demo-personnel-photos", firestore: { rules: readFileSync("firestore.rules", "utf8") }, storage: { rules: readFileSync("storage.rules", "utf8") } }); }, 30_000);
  beforeEach(async () => { await environment.clearFirestore(); await environment.clearStorage(); await environment.withSecurityRulesDisabled((admin) => setDoc(doc(admin.firestore(), "schools", "school-a"), { status: "active" })); });
  afterAll(async () => environment.cleanup(), 30_000);

  it.each([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]])("autorise %s same-school", async (type, extension) => { await assertSucceeds(upload(type, extension)); });
  it("autorise la lecture same-school selon la politique Administrateur", async () => { await assertSucceeds(upload("image/jpeg", "jpg")); await assertSucceeds(context().storage().ref(`personnel-photos/school-a/teacher-a/${uuid}.jpg`).getDownloadURL()); });
  it("refuse cross-school, rôle ordinaire et non authentifié", async () => {
    await assertFails(upload("image/jpeg", "jpg", 1024, "school-b"));
    await assertFails(upload("image/jpeg", "jpg", 1024, "school-a", "secretary"));
    await assertFails(environment.unauthenticatedContext().storage().ref(`personnel-photos/school-a/teacher-a/${uuid}.jpg`).put(new Uint8Array(10), { contentType: "image/jpeg", customMetadata: { schoolId: "school-a", personnelId: "teacher-a" } }));
  });
  it("refuse MIME interdit et taille supérieure à 5 Mo", async () => { await assertFails(upload("text/html", "jpg")); await assertFails(upload("image/jpeg", "jpg", 5 * 1024 * 1024 + 1)); });
});
