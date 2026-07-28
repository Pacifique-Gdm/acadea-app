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

  it("écrit directement le document puis utilise un listener borné à l'école et l'année", () => {
    const source = readFileSync(new URL("./secretaryCorrespondence.ts", import.meta.url), "utf8");
    expect(source).not.toContain("runTransaction");
    expect(source).toContain("await setDoc(correspondenceRef");
    expect(source).toContain("correspondenceRef.id.slice(0, 8)");
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

  it("remplace une seule pièce jointe sans supprimer l'ancienne avant la mise à jour", () => {
    const source = readFileSync(new URL("./secretaryCorrespondence.ts", import.meta.url), "utf8");
    const persistIndex = source.indexOf('await setDoc(doc(db, "correspondences", current.id)');
    const oldDeleteIndex = source.indexOf("if (current.attachment?.path) await deleteObject");
    expect(persistIndex).toBeGreaterThan(-1);
    expect(oldDeleteIndex).toBeGreaterThan(persistIndex);
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
