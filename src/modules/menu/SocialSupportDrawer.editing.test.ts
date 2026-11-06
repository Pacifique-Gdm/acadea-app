import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./SocialSupportDrawer.tsx", import.meta.url), "utf8");

describe("bénéficiaire d'une décision sociale", () => {
  it("montre seulement le nom en modification sans retirer la sélection du formulaire de création", () => {
    const section = source.slice(source.indexOf("<h3 className=\"font-bold\">1. Élève bénéficiaire</h3>"), source.indexOf("<h3 className=\"font-bold\">2. Frais concernés</h3>"));
    expect(section).toContain("{editing ? (");
    expect(section).toContain('data-testid="social-support-beneficiary"');
    expect(section).toContain("editing.studentName");
    expect(section).toContain(") : (");
    expect(section).toContain("<SupportStudentPicker");
    expect(section).not.toContain("disabled={!!editing");
  });
  it("préserve la confirmation exacte et l'identité de la décision envoyée au serveur", () => {
    expect(source).toContain('editConfirmation !== "JE CONFIRME LA MODIFICATION"');
    expect(source).toContain('decisionId: editing.id, expectedVersion: editing.version, confirmation: editConfirmation');
    expect(source).toContain("studentId,");
  });
});
