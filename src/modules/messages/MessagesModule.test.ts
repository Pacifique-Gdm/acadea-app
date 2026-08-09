import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MessagesModule.tsx", import.meta.url), "utf8");
const selectorSource = readFileSync(new URL("./AdministrativeRecipientSelector.tsx", import.meta.url), "utf8");

describe("messagerie des modules administratifs", () => {
  it("conserve un seul formulaire principal et supprime le formulaire Secretaire separe", () => {
    expect(source).toContain('<FormPanel title="Envoyer un message">');
    expect(source).not.toMatch(/FormPanel title="[ÉE]crire au Secr/);
    expect(source.match(/<FormPanel title=/g)).toHaveLength(1);
  });

  it("integre Administratifs au selecteur existant et conserve la selection multiple", () => {
    expect(source).toContain('<option value="administrative">Administratifs</option>');
    expect(source).toContain("AdministrativeRecipientSelector");
    expect(selectorSource).toContain("searchResults.map");
    expect(selectorSource).toContain('type="checkbox"');
    expect(source).toContain("selectedAdministrativeIds");
    expect(source).toContain("sendSchoolMessage");
  });

  it("affiche le second filtre et ne rend les resultats qu'apres une recherche en mode selection", () => {
    expect(selectorSource).toContain('<option value="all">Tous les administratifs</option>');
    expect(selectorSource).toContain('<option value="selection">Sélection administratif</option>');
    expect(selectorSource).toContain('mode === "all"');
    expect(selectorSource).toContain("search.trim()");
    expect(selectorSource).toContain("Recherchez un administratif par nom ou fonction.");
    expect(selectorSource).toContain('aria-label={`Retirer ${recipient.name}`}');
  });

  it("preserve les categories Parents et les flux existants", () => {
    expect(source).toContain('<option value="parents">Parents d\'élèves</option>');
    expect(source).toContain("persistMessageWithConversation");
    expect(source).toContain("selectedDisciplineParentIds");
    expect(source).toContain("selectedAdminParentIds");
  });
});
