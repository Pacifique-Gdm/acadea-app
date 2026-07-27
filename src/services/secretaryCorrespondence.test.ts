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

  it("utilise une transaction pour la référence et un listener borné à l'école et l'année", () => {
    const source = readFileSync(new URL("./secretaryCorrespondence.ts", import.meta.url), "utf8");
    expect(source).toContain("runTransaction");
    expect(source).toContain('where("schoolId", "==", params.schoolId)');
    expect(source).toContain('where("schoolYearId", "==", params.schoolYearId)');
  });

  it("remplace une seule pièce jointe sans supprimer l'ancienne avant la mise à jour", () => {
    const source = readFileSync(new URL("./secretaryCorrespondence.ts", import.meta.url), "utf8");
    const persistIndex = source.indexOf('await setDoc(doc(db, "correspondences", current.id)');
    const oldDeleteIndex = source.indexOf("if (current.attachment?.path) await deleteObject");
    expect(persistIndex).toBeGreaterThan(-1);
    expect(oldDeleteIndex).toBeGreaterThan(persistIndex);
  });
});
