// Lots 5 et 6 : saisie des sous-rubriques par l'Administrateur.
import { describe, expect, it } from "vitest";
import { SUB_RUBRICS_PHRASE, functionLabel, subRubricAmountsChanged, subRubricPayload } from "./SubRubricsPanel";

describe("sous-rubriques : saisie", () => {
  it("convertit pourcentages et montants fixes, refuse plus de 100 % et une ligne incomplète", () => {
    expect(subRubricPayload([{ name: " Ouvrier ", mode: "fixed", value: "4", functions: ["service"] }, { id: "2222222222222222", name: "Enseignant", mode: "percent", value: "12,5", functions: [] }]))
      .toEqual({ subRubrics: [{ name: "Ouvrier", mode: "fixed", fixedMinor: 400, functions: ["service"] }, { id: "2222222222222222", name: "Enseignant", mode: "percent", basisPoints: 1250, functions: [] }] });
    expect(subRubricPayload([{ name: "A", mode: "percent", value: "60", functions: [] }, { name: "B", mode: "percent", value: "50", functions: [] }])).toEqual({ error: "Les pourcentages dépassent 100 %." });
    expect(subRubricPayload([{ name: "", mode: "percent", value: "10", functions: [] }])).toEqual({ error: "Donnez un nom à chaque sous-rubrique." });
    expect(subRubricPayload([{ name: "A", mode: "fixed", value: "abc", functions: [] }])).toEqual({ error: "Valeur invalide pour « A »." });
  });
  it("la phrase n'est demandée que si un pourcentage ou un montant change (ajout et retrait compris)", () => {
    const saved = [{ id: "1111111111111111", name: "Ouvrier", mode: "fixed" as const, fixedMinor: 400, functions: [] }];
    expect(subRubricAmountsChanged(saved, [{ id: "1111111111111111", mode: "fixed", fixedMinor: 400 }])).toBe(false);
    expect(subRubricAmountsChanged(saved, [{ id: "1111111111111111", mode: "fixed", fixedMinor: 500 }])).toBe(true);
    expect(subRubricAmountsChanged(saved, [])).toBe(true);
    expect(subRubricAmountsChanged(saved, [...saved, { mode: "percent", basisPoints: 100 }])).toBe(true);
    expect(SUB_RUBRICS_PHRASE).toBe("ENREGISTRER LES SOUS-RUBRIQUES");
  });
  it("nomme les fonctions concernées en français", () => {
    expect(functionLabel("service")).toBe("Personnel sans compte");
    expect(functionLabel("teacher")).not.toBe("teacher");
  });
});
