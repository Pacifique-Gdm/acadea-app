import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALLOCATION_SETUP_BANNER } from "../../components/AllocationRubricSelect";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const activation = read("./FeeAllocationActivation.tsx");

/** Lot « 3 étapes » : l'écran d'activation suit les 3 étapes validées par l'utilisateur le 23/11. */
describe("écran d'activation en 3 étapes", () => {
  it("affiche les 3 étapes et l'écran unique « Activer » d'une école sans écriture", () => {
    for (const text of ["Étape 1 sur 3 — Vérifier et justifier", "Étape 2 sur 3 — Valider le solde de départ", "Étape 3 sur 3 — Activer", "Dernière étape — Activer", "data-empty-history", "'activate-without-history'"]) expect(activation).toContain(text);
    expect(activation).not.toContain("Préparer le solde de départ</button>");
  });
  it("une seule phrase pour valider le solde, et un bouton « Annuler ce solde » avec sa phrase", () => {
    expect(activation).toContain('export const VALIDATE_OPENING_PHRASE = "VALIDER LE SOLDE DE DEPART"');
    expect(activation).toContain('export const CANCEL_OPENING_PHRASE = "ANNULER LE SOLDE DE DEPART"');
    expect(activation).toContain(">Annuler ce solde</button>");
    expect(activation).toContain("mutate(\"validate-opening\"");
  });
  it("justification par motif écrit avec photo facultative (point 1)", () => {
    for (const text of ["Motif écrit", "data-declaration-reason", "Photo de la pièce (facultative)", "evidenceType: 'declaration'"]) expect(activation).toContain(text);
  });
  it("« Non affecté » calculé automatiquement avec un champ de justification (point 6), écart de caisse et déficit avec motif (points 2 et 4)", () => {
    for (const text of ["Non affecté (le reste, calculé automatiquement)", "data-unallocated-reason", "data-cash-gap", "data-deficit"]) expect(activation).toContain(text);
  });
  it("les phrases se tapent : coller et glisser sont bloqués", () => {
    expect(activation).toContain("onPaste={block} onDrop={block}");
  });
  it("le caissier voit un bandeau pendant la mise en route (point 5)", () => {
    expect(read("../control/ControlModule.tsx")).toContain("data-allocation-setup-banner>{ALLOCATION_SETUP_BANNER}");
    expect(ALLOCATION_SETUP_BANNER).toContain("répartis à l'activation");
  });
});
