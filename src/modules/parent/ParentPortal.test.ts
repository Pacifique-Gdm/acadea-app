import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/parent/ParentPortal.tsx", "utf8");

describe("portail Parent", () => {
  it("ouvre directement l'historique enfant et conserve un retour accessible a droite", () => {
    expect(source).toContain("setSelectedParentChildId(student.id)");
    expect(source).toContain('aria-label="Retour aux enfants"');
    expect(source).toContain("justify-between");
  });

  it("utilise un annuaire dynamique multiselection sans destinataires statiques", () => {
    expect(source).toContain("loadSchoolMessageRecipients()");
    expect(source).toContain('type="checkbox"');
    expect(source).toContain("messageRecipientIds");
    expect(source).not.toContain('<option value="admin">');
  });

  it("expose les fiches medicales en consultation et retire le bloc Notifications Acadea du compte", () => {
    expect(source).toContain('title="Fiche m');
    expect(source).toContain("medicalRecordSections.map");
    expect(source).toContain("subscribeToParentMedicalRecords");
    expect(source).not.toMatch(/title="Notifications Acad/);
  });
});
