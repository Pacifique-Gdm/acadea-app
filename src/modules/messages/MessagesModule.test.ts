import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MessagesModule.tsx", import.meta.url), "utf8");

describe("messagerie des modules administratifs", () => {
  it("conserve un seul formulaire principal et supprime le formulaire Secretaire separe", () => {
    expect(source).toContain('<FormPanel title="Envoyer un message">');
    expect(source).not.toMatch(/FormPanel title="[ÉE]crire au Secr/);
    expect(source.match(/<FormPanel title=/g)).toHaveLength(1);
  });

  it("integre Administratifs au selecteur existant et conserve la selection multiple", () => {
    expect(source).toContain('<option value="administrative">Administratifs</option>');
    expect(source).toContain("administrativeRecipients.map");
    expect(source).toContain('type="checkbox"');
    expect(source).toContain("selectedAdministrativeIds");
    expect(source).toContain("sendSchoolMessage");
  });

  it("preserve les categories Parents et les flux existants", () => {
    expect(source).toContain('<option value="parents">Parents d\'élèves</option>');
    expect(source).toContain("persistMessageWithConversation");
    expect(source).toContain("selectedDisciplineParentIds");
    expect(source).toContain("selectedAdminParentIds");
  });
});
