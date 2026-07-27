import { describe, expect, it } from "vitest";
import { validateOtherSanctionDescriptions } from "./disciplineValidation";

describe("validation des descriptions de sanction", () => {
  it("refuse le motif Autre sans description", () => {
    expect(validateOtherSanctionDescriptions("Autre", "", "Avertissement", "").reasonError).toContain("obligatoire");
  });

  it("refuse la sanction Autre sans description", () => {
    expect(validateOtherSanctionDescriptions("Retard", "", "Autre", "").sanctionError).toContain("obligatoire");
  });

  it("accepte les descriptions obligatoires présentes", () => {
    expect(validateOtherSanctionDescriptions("Autre", "Motif détaillé", "Autre", "Sanction détaillée")).toEqual({ reasonError: "", sanctionError: "" });
  });
});
