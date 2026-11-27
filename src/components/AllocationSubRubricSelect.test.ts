// Lots 5 et 6 : 2e champ « Sous-rubrique » des sorties d'argent.
import { describe, expect, it } from "vitest";
import { proposedSubRubricId, subRubricBlocks, subRubricSpendCheck, subRubricSpendError, subRubricsOf } from "./AllocationSubRubricSelect";

const subRubrics = [
  { id: "1111111111111111", name: "Ouvrier", availableMinor: 500, functions: ["service"] },
  { id: "2222222222222222", name: "Enseignant", availableMinor: 3000, functions: ["teacher"] },
  { id: "UNALLOCATED", name: "Non affecté (Personnel)", availableMinor: 100, functions: [] },
];
const options = { required: true, currency: "USD", rubrics: [{ id: "personnel", name: "Personnel", availableMinor: 3600, subRubrics }, { id: "ecole", name: "École", availableMinor: 900 }] };

describe("sous-rubrique dans les sorties d'argent", () => {
  it("n'apparaît que si la répartition est active et si la rubrique a des sous-rubriques", () => {
    expect(subRubricsOf({ options: { required: false, rubrics: [] } }, "personnel")).toEqual([]);
    expect(subRubricsOf({ options }, "ecole")).toEqual([]);
    expect(subRubricSpendCheck({ options }, "ecole", "", 100)).toEqual({ kind: "none" });
    expect(subRubricsOf({ options }, "personnel").map((s) => s.name)).toEqual(["Ouvrier", "Enseignant", "Non affecté (Personnel)"]);
  });
  it("obligatoire, et bloquée au-delà de son solde", () => {
    expect(subRubricSpendCheck({ options }, "personnel", "", 100)).toEqual({ kind: "choose" });
    expect(subRubricSpendError(subRubricSpendCheck({ options }, "personnel", "", 100))).toBe("Choisissez la sous-rubrique.");
    const over = subRubricSpendCheck({ options }, "personnel", "1111111111111111", 600);
    expect(over).toMatchObject({ kind: "ready", over: true, availableMinor: 500 });
    expect(subRubricBlocks(over)).toBe(true);
    expect(subRubricSpendError(over, "USD")).toContain("Solde insuffisant sur « Ouvrier »");
    expect(subRubricBlocks(subRubricSpendCheck({ options }, "personnel", "UNALLOCATED", 100))).toBe(false);
  });
  it("paie : proposée selon la fonction du bénéficiaire, rien si aucune ne correspond", () => {
    expect(proposedSubRubricId(subRubrics, { jobTitle: "teacher", hasAccount: true })).toBe("2222222222222222");
    expect(proposedSubRubricId(subRubrics, { jobTitle: "Gardien", hasAccount: false })).toBe("1111111111111111");
    expect(proposedSubRubricId(subRubrics, { jobTitle: "secretary", hasAccount: true })).toBe("");
    expect(proposedSubRubricId(subRubrics, null)).toBe("");
  });
});
