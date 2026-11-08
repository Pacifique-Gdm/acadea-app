import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { socialBeneficiaryLabel } from "./socialBeneficiary";

const source = readFileSync(new URL("./SocialSupportDrawer.tsx", import.meta.url), "utf8");

describe("bénéficiaire d'une décision sociale", () => {
  it("montre le nom et la classe en modification sans retirer la sélection du formulaire de création", () => {
    const section = source.slice(source.indexOf("<h3 className=\"font-bold\">1. Élève bénéficiaire</h3>"), source.indexOf("<h3 className=\"font-bold\">2. Frais concernés</h3>"));
    expect(section).toContain("{editing ? (");
    expect(section).toContain('data-testid="social-support-beneficiary"');
    expect(section).toContain("socialBeneficiaryLabel(student, editing)");
    expect(section).toContain("break-words");
    expect(section).toContain(") : (");
    expect(section).toContain("<SupportStudentPicker");
    expect(section.slice(section.indexOf("{editing ? ("), section.indexOf(") : ("))).not.toContain("SupportStudentPicker");
    expect(section).not.toContain("disabled={!!editing");
  });
  it("utilise la classe actuelle de l'élève autorisé, puis le contexte historique de la décision", () => {
    const decision = { studentName: "Jean Mbuyi", className: "4e Primaire" };
    expect(socialBeneficiaryLabel({ nom: "Jean", postnom: "Mbuyi", prenom: "", className: "5e Primaire" }, decision))
      .toBe("Jean Mbuyi — 5e Primaire");
    expect(socialBeneficiaryLabel(undefined, decision)).toBe("Jean Mbuyi — 4e Primaire");
  });
  it("n'invente aucune classe indisponible et conserve un nom long intact", () => {
    const name = "Jean-Baptiste Kalala Mbuyi Mavungu";
    expect(socialBeneficiaryLabel(undefined, { studentName: name, className: "" })).toBe(name);
    expect(socialBeneficiaryLabel(undefined, { studentName: name, className: "6e Secondaire" }))
      .toBe(`${name} — 6e Secondaire`);
  });
  it("préserve la confirmation exacte et l'identité de la décision envoyée au serveur", () => {
    expect(source).toContain('editConfirmation !== "JE CONFIRME LA MODIFICATION"');
    expect(source).toContain('decisionId: editing.id, expectedVersion: editing.version, confirmation: editConfirmation');
    expect(source).toContain("studentId,");
  });
});
