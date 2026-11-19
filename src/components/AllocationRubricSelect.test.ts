import { describe, expect, it } from "vitest";
import { formatRubricAmount, rubricSpendCheck } from "./AllocationRubricSelect";

const options = { required: true, currency: "USD", rubrics: [{ id: "ecole", name: "Part de l'école", availableMinor: 22600 }, { id: "UNALLOCATED", name: "Non affecté", availableMinor: 0 }] };

describe("dépense avec répartition des frais active", () => {
  it("sans répartition active : aucune rubrique demandée", () => {
    expect(rubricSpendCheck({ options: { required: false, rubrics: [] }, error: "" }, "", 5000)).toEqual({ kind: "not-required" });
  });
  it("rubrique obligatoire : à choisir avant tout ; chargement en cours bloqué", () => {
    expect(rubricSpendCheck({ options, error: "" }, "", 5000)).toEqual({ kind: "choose" });
    expect(rubricSpendCheck({ options: undefined, error: "" }, "ecole", 5000)).toEqual({ kind: "loading" });
  });
  it("montants de la rubrique choisie ; au-delà du disponible, opération refusée", () => {
    expect(rubricSpendCheck({ options, error: "" }, "ecole", 22600)).toMatchObject({ kind: "ready", availableMinor: 22600, over: false });
    expect(rubricSpendCheck({ options, error: "" }, "ecole", 22601)).toMatchObject({ kind: "ready", over: true });
    expect(rubricSpendCheck({ options, error: "" }, "UNALLOCATED", 1)).toMatchObject({ kind: "ready", over: true });
  });
  it("message lisible : 226,00 USD", () => {
    expect(formatRubricAmount(22600, "USD").replace(/\s/g, " ")).toBe("226,00 USD");
  });
});
