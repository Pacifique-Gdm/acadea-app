import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertPermanentDeletionAllowed, assertSecretaryDocumentAccess } from "./secretaryDocumentDeletion.js";

function codeOf(run: () => void) {
  try { run(); return "none"; }
  catch (error) { return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown"; }
}

describe("politique de suppression définitive Secrétaire", () => {
  it("autorise uniquement le brouillon archivé appartenant à l'appelant", () => {
    expect(() => assertPermanentDeletionAllowed({ currentStatus: "archived", ownerId: "secretary-a", actorId: "secretary-a", archivedFromStatus: "draft" })).not.toThrow();
  });

  it.each(["draft", "finalized", "sent", "validated", "signed"])("refuse un document non archivé (%s)", (currentStatus) => {
    expect(codeOf(() => assertPermanentDeletionAllowed({ currentStatus, ownerId: "secretary-a", actorId: "secretary-a", archivedFromStatus: "draft" }))).toContain("failed-precondition");
  });

  it("refuse un auteur différent, même dans la même école", () => {
    expect(codeOf(() => assertPermanentDeletionAllowed({ currentStatus: "archived", ownerId: "secretary-b", actorId: "secretary-a", archivedFromStatus: "draft" }))).toContain("permission-denied");
  });

  it.each(["finalized", "sent", "validated", "signed", undefined])("refuse une archive issue d'un statut protégé ou historique (%s)", (archivedFromStatus) => {
    expect(codeOf(() => assertPermanentDeletionAllowed({ currentStatus: "archived", ownerId: "secretary-a", actorId: "secretary-a", archivedFromStatus }))).toContain("failed-precondition");
  });

  it.each(["school_admin", "super_admin", "cashier", "unknown"])("refuse le rôle %s", (tokenRole) => {
    const base = { tokenSchoolId: "school-a", documentSchoolId: "school-a", profile: { role: "secretary", schoolId: "school-a", status: "active" } };
    expect(codeOf(() => assertSecretaryDocumentAccess({ ...base, tokenRole }))).toContain("permission-denied");
  });

  it("refuse un profil inactif", () => {
    const base = { tokenSchoolId: "school-a", documentSchoolId: "school-a", profile: { role: "secretary", schoolId: "school-a", status: "active" } };
    expect(codeOf(() => assertSecretaryDocumentAccess({ ...base, tokenRole: "secretary", profile: { ...base.profile, status: "inactive" } }))).toContain("permission-denied");
  });

  it("refuse l'autre école", () => {
    expect(codeOf(() => assertSecretaryDocumentAccess({ tokenRole: "secretary", tokenSchoolId: "school-a", profile: { role: "secretary", schoolId: "school-a", status: "active" }, documentSchoolId: "school-b" }))).toContain("permission-denied");
  });

  it("empêche une suppression en série dès qu'un document ne satisfait pas la politique", () => {
    const documents = [
      { currentStatus: "archived", ownerId: "secretary-a", actorId: "secretary-a", archivedFromStatus: "draft" },
      { currentStatus: "archived", ownerId: "secretary-b", actorId: "secretary-a", archivedFromStatus: "draft" },
      { currentStatus: "archived", ownerId: "secretary-a", actorId: "secretary-a", archivedFromStatus: "finalized" },
    ];
    expect(documents.map((document) => codeOf(() => assertPermanentDeletionAllowed(document)))).toEqual(["none", "permission-denied", "failed-precondition"]);
  });

  it("impose authentification, confirmation et audit atomique dans la Callable", () => {
    const source = readFileSync(new URL("./secretaryDocumentDeletion.ts", import.meta.url), "utf8");
    expect(source).toContain('throw new HttpsError("unauthenticated"');
    expect(source).toContain('request.data?.confirmation !== DELETE_CONFIRMATION');
    expect(source).toContain('batch.create(db.doc(`auditLogs/${auditId}`), audit)');
    expect(source).toContain('batch.commit()');
    for (const action of ["CORRESPONDENCE_ARCHIVED", "CORRESPONDENCE_RESTORED", "CORRESPONDENCE_DELETED", "REPORT_ARCHIVED", "REPORT_RESTORED", "REPORT_DELETED"]) expect(source).toContain(action);
  });
});
