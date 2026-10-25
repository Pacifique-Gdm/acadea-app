import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_CORRESPONDENCE_ATTACHMENT_BYTES, validateCorrespondenceAttachment } from "./secretaryCorrespondence";

describe("correspondances du Secrétaire", () => {
  it("valide simultanément extension, MIME et taille", () => {
    expect(validateCorrespondenceAttachment({ name: "courrier.pdf", type: "application/pdf", size: 1024 })).toBe("");
    expect(validateCorrespondenceAttachment({ name: "script.exe", type: "application/pdf", size: 1024 })).not.toBe("");
    expect(validateCorrespondenceAttachment({ name: "courrier.pdf", type: "text/javascript", size: 1024 })).not.toBe("");
    expect(validateCorrespondenceAttachment({ name: "courrier.pdf", type: "application/pdf", size: MAX_CORRESPONDENCE_ATTACHMENT_BYTES + 1 })).not.toBe("");
  });

  it("réserve atomiquement la référence sortante puis utilise un listener borné à l'école et l'année", () => {
    const source = readFileSync(new URL("./secretaryCorrespondence.ts", import.meta.url), "utf8");
    expect(source).toContain("await runTransaction(db");
    expect(source).toContain("transaction.set(counterRef");
    expect(source).toContain("transaction.set(correspondenceRef");
    expect(source).toContain("generateOutgoingCorrespondenceReference");
    expect(source).toContain('where("schoolId", "==", params.schoolId)');
    expect(source).toContain('where("schoolYearId", "==", params.schoolYearId)');
    expect(source).toContain("createdAt: serverTimestamp()");
    expect(source).toContain("withoutUndefined(params.input)");
  });

  it("normalise les anciens horodatages texte et les nouveaux Timestamp", () => {
    const source = readFileSync(new URL("./secretaryCorrespondence.ts", import.meta.url), "utf8");
    expect(source).toContain('typeof value === "string"');
    expect(source).toContain('"toDate" in value');
  });

  it("délègue les pièces jointes à la fonction authentifiée sans URL de téléchargement persistante", () => {
    const source = readFileSync(new URL("./secretaryCorrespondence.ts", import.meta.url), "utf8");
    const serverSource = readFileSync(new URL("../../functions/src/audit/secretaryCorrespondenceFile.ts", import.meta.url), "utf8");
    const archivedGuard = source.indexOf('if (current.status === "archived") throw new Error("Cette correspondance est en lecture seule.");', source.indexOf("export async function replaceCorrespondenceAttachment"));
    expect(archivedGuard).toBeGreaterThan(-1);
    expect(source).toContain('FILE_FUNCTION = "secretaryCorrespondenceFile"');
    expect(source).toContain('action: "upload", correspondenceId: current.id');
    expect(source).toContain('action: "download", correspondenceId: current.id');
    expect(source).not.toContain("getDownloadURL");
    expect(source).not.toContain("uploadBytes");
    expect(serverSource.indexOf("await db.runTransaction")).toBeGreaterThan(serverSource.indexOf("await storageFile.save"));
    expect(serverSource.indexOf("if (oldPath && oldPath !== path)")).toBeGreaterThan(serverSource.indexOf("await db.runTransaction"));
  });

  it("supprime atomiquement la référence de pièce jointe lors du passage en courrier sortant", () => {
    const source = readFileSync(new URL("./secretaryCorrespondence.ts", import.meta.url), "utf8");
    expect(source).toContain('patch.direction === "outgoing"');
    expect(source).toContain("attachment: null");
    const firestoreDelete = source.indexOf("attachment: null");
    const storageDelete = source.indexOf("current.attachment.path", firestoreDelete);
    expect(storageDelete).toBeGreaterThan(firestoreDelete);
  });
});
