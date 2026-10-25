import { describe, expect, it } from "vitest";
import { personnelJobTitleLabel } from "./personnel";

describe("fonctions du personnel dans le paiement", () => {
  it.each([
    ["teacher", "Enseignant"], ["school_admin", "Administrateur scolaire"],
    ["cashier", "Caissier"], ["secretary", "Secrétaire"],
    ["study_director", "Directeur des études"], ["director_of_studies", "Directeur des études"],
    ["discipline_director", "Directeur de Discipline"],
  ])("traduit %s", (role, expected) => expect(personnelJobTitleLabel(role, true)).toBe(expected));

  it("ne traduit pas un métier libre du personnel de service", () => {
    expect(personnelJobTitleLabel("Agent d'entretien", false)).toBe("Agent d'entretien");
  });
});
