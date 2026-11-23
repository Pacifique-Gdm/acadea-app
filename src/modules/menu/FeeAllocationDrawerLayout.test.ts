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
  it("sur téléphone, les commandes tiennent sur une ligne, sans défilement horizontal (1.15.2)", () => {
    expect(drawer).not.toContain("min-w-[640px]");
    expect(drawer).toContain("configurable ? 'grid-cols-4' : 'grid-cols-3'");
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
  it("formulaire « Ajouter une répartition » : libellés courts et champ « Nouvelle rubrique » assez large (21/11)", () => {
    expect(drawer).not.toMatch(/Enregistrer la répartition|Ajouter à la liste|Nom de la nouvelle rubrique/);
    expect(drawer).toContain(': "Enregistrer"}</Action>');
    expect(drawer).toContain("onClick={() => void createNamed(index)}>Ajouter</button>");
    expect(drawer).toContain('placeholder="Nouvelle rubrique" aria-label="Nouvelle rubrique"');
    expect(drawer).toContain('className="input min-w-[11rem] flex-1"');
    expect(drawer).toContain("sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)] sm:items-start");
  });
  it("icône « Actualiser » à l'extrémité droite de la ligne du statut, plus sous le statut (21/11)", () => {
    const activation = read("FeeAllocationActivation.tsx");
    expect(activation).toMatch(/justify-between[^>]*data-allocation-status-row><h3[^]*?<\/h3>\{view && refreshButton\}<\/div>/);
    expect(activation).not.toContain("{node}{refreshButton}");
  });
});
