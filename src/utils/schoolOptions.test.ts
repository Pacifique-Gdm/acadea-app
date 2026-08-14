import { describe, expect, it } from "vitest";
import { canonicalSchoolOption, mergeSchoolOptions, normalizeSchoolOptions, reconcileSchoolOptions } from "./schoolOptions";

describe("schoolOptions", () => {
  it("normalise le tableau actuel et l'alias historique", () => {
    expect(normalizeSchoolOptions(["Latin-Philo", "  Scientifique  ", "Latin-Philo", null])).toEqual(["Latin-Philo", "Sciences"]);
  });

  it.each([undefined, null])("retourne un tableau vide pour %s", (value) => {
    expect(normalizeSchoolOptions(value)).toEqual([]);
  });

  it("lit les anciennes structures Firestore", () => {
    expect(normalizeSchoolOptions({ options: ["Commerciale", "Pédagogie"] })).toEqual(["Commerciale", "Pédagogie"]);
    expect(normalizeSchoolOptions({ Scientifique: true, Littéraire: false })).toEqual(["Sciences"]);
    expect(normalizeSchoolOptions({ unexpected: 42 })).toEqual([]);
  });

  it.each(["Scientifique", "scientifique", "SCIENCES", "Science", "Section scientifique"])("canonicalise %s en Sciences", (value) => {
    expect(canonicalSchoolOption(value)).toBe("Sciences");
  });

  it("déduplique la casse, les accents et l'alias Sciences", () => {
    expect(normalizeSchoolOptions([" Pédagogie ", "pedagogie", "Scientifique", "Sciences"])).toEqual(["Pédagogie", "Sciences"]);
  });

  it("fusionne deux ajouts concurrents sans écrasement", () => {
    expect(mergeSchoolOptions(["Option A", "Option B"], ["Option C"])).toEqual(["Option A", "Option B", "Option C"]);
  });

  it("réconcilie un formulaire avec un ajout concurrent", () => {
    expect(reconcileSchoolOptions(["Initiale", "Ajout secrétaire"], ["Initiale"], ["Initiale", "Ajout admin"])).toEqual([
      "Initiale", "Ajout secrétaire", "Ajout admin",
    ]);
  });
});
