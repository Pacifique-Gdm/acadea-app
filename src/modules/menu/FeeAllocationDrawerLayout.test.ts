import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUTTON_ROW, REVOKE_PHRASE, SHARE_PHRASE } from "./FeeAllocationSharing";

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const drawer = read("FeeAllocationDrawer.tsx"), sharing = read("FeeAllocationSharing.tsx"), catalog = read("RubricCatalogPanel.tsx");

describe("drawer « Répartition des frais » (lot du 19/11)", () => {
  it("plus de ligne école · année · devise sous le titre", () => {
    expect(drawer).not.toContain('aria-label="Contexte de répartition"');
  });
  it("« Partager » et « PDF » remplacent « Afficher » et « Exporter PDF »", () => {
    expect(drawer).toContain(">PDF</Action>");
    expect(drawer).not.toContain("Exporter PDF");
    expect(sharing).toContain(">Partager</button>");
    expect(`${sharing}${catalog}`).not.toMatch(/>Afficher<|« Afficher »/);
  });
  it("onglets fixes en haut, chacun à la moitié de la largeur", () => {
    expect(drawer).toMatch(/role="tablist"[^>]*className="sticky top-0 [^"]*grid-cols-2/);
  });
  it("sur téléphone, les filtres tiennent sur deux colonnes, sans défilement horizontal", () => {
    expect(drawer).not.toContain("min-w-[640px]");
    expect(drawer).toContain("grid min-w-0 grid-cols-2 items-center gap-2");
  });
  it("phrases exactes pour partager et retirer ; bouton désactivé sinon", () => {
    expect(SHARE_PHRASE).toBe("PARTAGER AVEC CE PERSONNEL");
    expect(REVOKE_PHRASE).toBe("RETIRER CE PARTAGE");
    expect(sharing).toContain("disabled={busy || typed !== SHARE_PHRASE}");
    expect(sharing).toContain("disabled={busy || (!whole && !picked.length) || typed !== REVOKE_PHRASE}");
    expect(sharing).toContain("if (busy || typed !== SHARE_PHRASE) return;");
    expect(sharing).toContain("|| typed !== REVOKE_PHRASE) return;");
  });
  it("boutons à parts égales (moitié chacun à deux, pleine largeur seul)", () => {
    expect(BUTTON_ROW).toContain("auto-cols-fr grid-flow-col");
    expect(sharing.match(/\$\{BUTTON_ROW\}/g)).toHaveLength(2);
    expect(catalog.match(/className=\{BUTTON_ROW\}/g)).toHaveLength(2);
    expect(sharing).toContain('className="secondary-button w-full justify-center" aria-expanded={revoking === viewer.id}');
  });
});
