import { describe, expect, it } from "vitest";
import { normalizeSchoolOptions } from "./schoolOptions";

describe("normalizeSchoolOptions", () => {
  it("conserve et nettoie le tableau actuel", () => {
    expect(normalizeSchoolOptions(["Latin-Philo", "  Scientifique  ", "Latin-Philo", null])).toEqual(["Latin-Philo", "Scientifique"]);
  });

  it.each([undefined, null])("retourne un tableau vide pour %s", (value) => {
    expect(normalizeSchoolOptions(value)).toEqual([]);
  });

  it("lit une ancienne structure contenant options", () => {
    expect(normalizeSchoolOptions({ options: ["Commerciale", "Pédagogie"] })).toEqual(["Commerciale", "Pédagogie"]);
  });

  it("lit une ancienne map option-vers-activation", () => {
    expect(normalizeSchoolOptions({ Scientifique: true, Littéraire: false })).toEqual(["Scientifique"]);
  });

  it("ignore un objet sans structure reconnue", () => {
    expect(normalizeSchoolOptions({ unexpected: 42 })).toEqual([]);
  });
});
