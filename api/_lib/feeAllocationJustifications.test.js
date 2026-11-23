import { describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageAllocationReconciliation } from "./feeAllocationReconciliation.js";
import { readJustifications, readSchoolAdminJustifications, justificationPhotoSigner } from "./feeAllocationJustifications.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";

/** Lot « 3 étapes » : une justification (motif, photo) se consulte plus tard, seulement par l'Administrateur
 * de l'école (ici) et le Super administrateur (`manage-school`, action « school-justifications »). */
const now = "2026-11-13T10:00:00.000Z";
const admin = { uid: "admin", role: "school_admin", schoolId: "school" };
const photoPath = "fee-allocation-proofs/school/admin/recu-papier-0012.jpg";
const signPhoto = async (path) => `https://lien-signe.invalid/${path}`;

async function justifiedSchool() {
  const db = completeAllocationFixture(); db.projectId = "acadea-staging";
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", ""); vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
  delete db.records.get("schools/school").fixtureId;
  for (const key of db.records.keys()) if (key.startsWith("feeAllocationTestScopes/")) db.records.delete(key);
  db.records.set("users/admin", { ...db.records.get("users/admin"), name: "Directrice fictive" });
  db.records.set("payments/legacy", { id: "legacy", schoolId: "school", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 30, currency: "USD", createdAt: "2026-10-01T08:00:00.000Z", receiptNumber: "R-12" });
  await manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action: "publish-configuration", requestId: "justif-publish-0001", versionId: "version" } });
  await reconcileFixture(db, admin, now);
  await manageAllocationReconciliation({ db, caller: admin, now, fileExists: async () => true, body: { action: "justify-history", requestId: "justif-declare-0001",
    collection: "payments", sourceId: "legacy", evidenceType: "declaration", reason: "Ancien cahier de caisse, reçu papier n° 12.", photoPath } });
  return db;
}

describe("consultation des justifications", () => {
  it("l'Administrateur de l'école voit le motif, l'écriture, l'auteur et la photo (lien de 10 minutes)", async () => {
    const db = await justifiedSchool();
    const result = await readSchoolAdminJustifications({ db, caller: admin, body: { action: "get-justifications" }, signPhoto });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ decision: "accepted", kind: "declaration", reason: "Ancien cahier de caisse, reçu papier n° 12.", nature: "Paiement scolaire",
      amount: 30, currency: "USD", receiptNumber: "R-12", actorName: "Directrice fictive", hasPhoto: true, photoUrl: `https://lien-signe.invalid/${photoPath}` });
    expect(result.photoUrlMinutes).toBe(10);
  });

  it("reste consultable après l'activation", async () => {
    const db = await justifiedSchool();
    await reconcileFixture(db, admin, now);
    const opening = await manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action: "validate-opening", requestId: "justif-validate-0001", cashCountMinor: 3000,
      lines: [{ rubricId: "a".repeat(32), amountMinor: 3000 }], confirmation: "VALIDER LE SOLDE DE DEPART" } });
    await manageFeeAllocationLifecycle({ db, caller: admin, now, body: { action: "activate", requestId: "justif-activate-0001", openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION DE MON ETABLISSEMENT" } });
    expect((await readSchoolAdminJustifications({ db, caller: admin, body: { action: "get-justifications" }, signPhoto })).rows).toHaveLength(1);
  });

  it.each([
    ["caissier", { uid: "cashier", role: "cashier", schoolId: "school" }],
    ["coordination", { uid: "coord", role: "coordination_admin", schoolId: "school" }],
    ["sous-coordination", { uid: "subcoord", role: "sub_coordination_admin", schoolId: "school" }],
    ["enseignant (personnel)", { uid: "teacher", role: "teacher", schoolId: "school" }],
    ["secrétaire", { uid: "secretary", role: "secretary", schoolId: "school" }],
  ])("refuse le rôle %s", async (_label, caller) => {
    const db = await justifiedSchool();
    await expect(readSchoolAdminJustifications({ db, caller, body: { action: "get-justifications" }, signPhoto })).rejects.toMatchObject({ status: 403 });
  });

  it("refuse un Administrateur dont le profil n'est plus actif ou d'une autre école", async () => {
    const db = await justifiedSchool();
    db.records.set("users/admin", { ...db.records.get("users/admin"), status: "inactive" });
    await expect(readSchoolAdminJustifications({ db, caller: admin, body: { action: "get-justifications" }, signPhoto })).rejects.toMatchObject({ status: 403 });
    const other = await justifiedSchool();
    await expect(readSchoolAdminJustifications({ db: other, caller: { ...admin, schoolId: "foreign" }, body: { action: "get-justifications" }, signPhoto })).rejects.toThrow();
  });

  it("ne montre jamais la photo d'une autre école, et le lien n'est signé que pour le dossier des justifications", async () => {
    const db = await justifiedSchool();
    const rows = (await readJustifications({ db, schoolId: "school", schoolYearId: "year", signPhoto })).rows;
    expect(rows).toHaveLength(1);
    expect((await readJustifications({ db, schoolId: "autre-ecole", schoolYearId: "year", signPhoto })).rows).toHaveLength(0);
    const bucket = { file: (path) => ({ getSignedUrl: async () => [`signé:${path}`] }) };
    await expect(justificationPhotoSigner(bucket)("schools/school/student-photos/x/y.jpg")).rejects.toThrow("invalide");
    await expect(justificationPhotoSigner(bucket)(photoPath)).resolves.toBe(`signé:${photoPath}`);
  });
});
