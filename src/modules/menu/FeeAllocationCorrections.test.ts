import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { counterChanged } from "../../services/feeAllocationChangeCounter";
import { FEE_ALLOCATION_MENU_DESCRIPTION } from "./FeeAllocationDrawer";
import { DRAFT_LOCKED_TEXT } from "./FeeAllocationActivation";
import { HAND_TYPED_INPUTS, RENAME_PHRASE } from "./FeeAllocationSharing";

// Version 1.15.2 : corrections demandées par le propriétaire après ses essais de la 1.14.0 en production.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const drawer = read("./FeeAllocationDrawer.tsx"), activation = read("./FeeAllocationActivation.tsx");
const sharing = read("./FeeAllocationSharing.tsx"), catalog = read("./RubricCatalogPanel.tsx"), social = read("./FeeAllocationSocialPart.tsx");
const students = read("../students/StudentsModule.tsx");

describe("1. mise à jour seulement s'il y a un changement", () => {
  it("plus de vérification en boucle : ni minuterie, ni « online », ni « visibilitychange »", () => {
    expect(drawer).not.toMatch(/setInterval|visibilitychange|addEventListener\(['"]online['"]/);
    expect(drawer).toContain("useAllocationChangeCounters(counterScopes");
  });
  it("le compteur ne recharge jamais au premier relevé, puis seulement quand il bouge", () => {
    const seen = new Map<string, number>();
    expect(counterChanged(seen, "a", 4)).toBe(false);
    expect(counterChanged(seen, "a", 4)).toBe(false);
    expect(counterChanged(seen, "a", 5)).toBe(true);
    expect(counterChanged(seen, "b", 5)).toBe(false);
  });
  it("aucun message pour une mise à jour normale : seulement au-delà de 2 secondes", () => {
    expect(drawer).toContain("setTimeout(() => setSlowCheck(true), 2000)");
    expect(drawer).toContain("{slowCheck && checking && !loading && <p role=\"status\"");
  });
});

describe("2. l'état d'activation finit toujours de charger", () => {
  it("reste affiché pendant une mise à jour ou une erreur passagère (plus de démontage)", () => {
    expect(drawer).toContain("workspaces.length === 1 && !loading && workspaces[0].canConfigure && <FeeAllocationActivation");
  });
  it("une erreur au premier chargement donne un message clair et « Réessayer »", () => {
    expect(activation).toContain("L'état de la répartition n'a pas pu être chargé.");
    expect(activation).toContain("onClick={() => setInitialRound(n => n + 1)}>Réessayer</button>");
  });
});

describe("3 à 11. présentation", () => {
  it("3. description sous le bouton du Menu", () => {
    expect(FEE_ALLOCATION_MENU_DESCRIPTION).toBe("Parts des frais par rubrique, encaissements et dépenses.");
    expect(drawer).toContain(">{FEE_ALLOCATION_MENU_DESCRIPTION}</span>");
    // Le nom du bouton reste « Répartition des frais » (la description est liée, pas ajoutée au nom).
    expect(drawer).toContain("aria-label=\"Répartition des frais\" aria-describedby=\"menu-repartition-description\"");
  });
  it("4. les 4 commandes sur une seule ligne à parts égales, téléphone compris", () => {
    expect(drawer).toContain("grid min-w-0 items-center gap-1 sm:gap-2 ${configurable ? 'grid-cols-4' : 'grid-cols-3'}");
    expect(drawer).not.toContain("grid-cols-2 items-center gap-2 ${configurable");
  });
  it("5. renommer : phrase tapée à la main, ni coller ni remplissage automatique", () => {
    expect(RENAME_PHRASE).toBe("RENOMMER CETTE RUBRIQUE");
    for (const type of ["insertFromPaste", "insertFromDrop", "insertReplacementText", "insertFromYank"]) expect(HAND_TYPED_INPUTS.has(type)).toBe(false);
    expect(HAND_TYPED_INPUTS.has("insertText")).toBe(true);
    expect(sharing).toContain("onPaste={(event) => event.preventDefault()}");
    expect(catalog).toContain("renameTyped !== RENAME_PHRASE}");
    expect(catalog).toContain("if (renameTyped !== RENAME_PHRASE) return;");
  });
  it("6. « Partager » ouvre un drawer à part, avec la croix", () => {
    expect(sharing).toMatch(/<AdminDrawer title=\{`Partager « \$\{rubric\.name\} »`\} closeLabel="Fermer le partage"/);
  });
  it("7. « Préparer la nouvelle version » caché pour un frais déjà réparti, avec une phrase", () => {
    expect(activation).toContain("draft && !draftLocked ? primary('prepare-version', 'Préparer la nouvelle version'");
    expect(activation).toContain("view?.status !== 'EN_PREPARATION' && workspace.configs.some(c => c.feeTypeId === draft.feeTypeId && c.currentVersionId)");
    expect(DRAFT_LOCKED_TEXT).toContain("déjà réparti");
  });
  it("8. textes justifiés dans le drawer et ses formulaires", () => {
    expect(drawer.match(/text-justify/g)?.length).toBeGreaterThanOrEqual(3);
    expect(social).toContain("<div className=\"text-justify\" data-justified>");
    expect(sharing).toContain("grid gap-1 text-justify text-sm");
  });
  it("9. « Actualiser » : bouton icône, à droite de la ligne du statut (21/11)", () => {
    expect(activation).not.toContain(">Actualiser</Action>");
    expect(activation).toContain("<RefreshCw aria-hidden");
    expect(activation).toContain("<span className=\"sr-only\">Actualiser</span>");
    expect(activation).toContain("</h3>{view && refreshButton}</div>");
  });
  it("10. « Annuler » et « Enregistrer la répartition » moitié-moitié", () => {
    expect(drawer).toContain("<div className=\"mt-4 grid w-full grid-cols-2 gap-2\" data-editor-actions>");
  });
  it("11. « Annuler » et « OK » de l'archivage moitié-moitié", () => {
    expect(students).toContain("<div className=\"grid w-full grid-cols-2 gap-2\" data-archive-actions>");
  });
});
