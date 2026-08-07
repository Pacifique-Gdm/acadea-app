import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-acadea-valves-storage";
const schoolId = "school-a";
const yearId = "year-a";
const publicationId = "valve-a";
const fileId = "123e4567-e89b-12d3-a456-426614174000";
let environment: RulesTestEnvironment | undefined;

function testEnvironment() {
  if (!environment) throw new Error("L'environnement Storage de test n'est pas initialise.");
  return environment;
}

function context(role?: string, tenant = schoolId) {
  return role
    ? testEnvironment().authenticatedContext("user-a", { role, schoolId: tenant })
    : testEnvironment().unauthenticatedContext();
}

function metadata(type: string, overrides: Record<string, string> = {}) {
  return {
    contentType: type,
    customMetadata: { schoolId, schoolYearId: yearId, publicationId, originalName: "document.pdf", ...overrides },
  };
}

function put(role: string | undefined, fileName: string, type: string, size = 1024, tenant = schoolId) {
  const storage = context(role, tenant).storage();
  return storage.ref(`valves/${schoolId}/${yearId}/${publicationId}/${fileName}`).put(new Uint8Array(size), metadata(type));
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
}, 30_000);

beforeEach(async () => testEnvironment().clearStorage());
afterAll(async () => environment?.cleanup(), 30_000);

describe("pieces jointes Valves", () => {
  it("autorise Administrateur meme ecole avec un PDF valide", async () => {
    await assertSucceeds(put("school_admin", `${fileId}.pdf`, "application/pdf"));
  });

  it("autorise Secretaire meme ecole avec une image valide", async () => {
    await assertSucceeds(put("secretary", `${fileId}.png`, "image/png"));
  });

  it("autorise le claim Administrateur historique reconnu par le projet", async () => {
    await assertSucceeds(put("admin", `${fileId}.pdf`, "application/pdf"));
  });

  it("refuse non authentifie, role inconnu, autre ecole et chemin hors tenant", async () => {
    await assertFails(put(undefined, `${fileId}.pdf`, "application/pdf"));
    await assertFails(put("parent", `${fileId}.pdf`, "application/pdf"));
    await assertFails(put("secretary", `${fileId}.pdf`, "application/pdf", 1024, "school-b"));
    const otherPath = context("secretary").storage().ref(`valves/school-b/${yearId}/${publicationId}/${fileId}.pdf`);
    await assertFails(otherPath.put(new Uint8Array(1024), metadata("application/pdf", { schoolId: "school-b" })));
  });

  it("refuse un fichier superieur a 10 Mo", async () => {
    await assertFails(put("secretary", `${fileId}.pdf`, "application/pdf", 10 * 1024 * 1024 + 1));
  });

  it.each([
    ["html", "text/html"],
    ["svg", "image/svg+xml"],
    ["js", "application/javascript"],
    ["exe", "application/x-msdownload"],
  ])("refuse le contenu %s", async (extension, type) => {
    await assertFails(put("secretary", `${fileId}.${extension}`, type));
  });

  it("refuse un MIME incoherent et un nom utilisateur comme objet Storage", async () => {
    await assertFails(put("secretary", `${fileId}.pdf`, "image/png"));
    await assertFails(put("secretary", "rapport.pdf", "application/pdf"));
  });

  it("conserve la lecture d'un ancien fichier du meme tenant sans autoriser l'autre ecole", async () => {
    const legacyPath = `valves/${schoolId}/${yearId}/${publicationId}/ancien-document.txt`;
    await testEnvironment().withSecurityRulesDisabled(async (adminContext) => {
      await adminContext.storage().ref(legacyPath).putString("archive", "raw", { contentType: "text/plain" });
    });
    await assertSucceeds(context("secretary").storage().ref(legacyPath).getDownloadURL());
    await assertFails(context("secretary", "school-b").storage().ref(legacyPath).getDownloadURL());
  });
});
