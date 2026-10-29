import { describe, expect, it } from "vitest";
import { validateSchoolInformationPatch, validateSchoolOptionRename } from "./manage-school.js";

describe("mise à jour du fuseau scolaire côté serveur", () => {
  it("accepte un fuseau IANA explicite et la suppression facultative", () => {
    expect(validateSchoolInformationPatch({ timeZone: " Africa/Kinshasa " })).toEqual({ patch: { timeZone: "Africa/Kinshasa" } });
    expect(validateSchoolInformationPatch({ timeZone: "" })).toEqual({ patch: { timeZone: "" } });
  });
  it("refuse les valeurs non IANA sans modifier d'autres champs", () => {
    expect(validateSchoolInformationPatch({ timeZone: "Kinshasa" }).error).toBeTruthy();
    expect(validateSchoolInformationPatch({ timeZone: 123 }).error).toBeTruthy();
  });
});

describe("renommage d'option scolaire", () => {
  const school = { schoolOptions: ["Sciences", "Littéraire"], schoolOptionDisplayNames: { Sciences: "Sciences expérimentales" } };
  const request = { option: "Sciences", newName: "Sciences appliquées", confirmation: "CHANGER LE NOM DE CETTE OPTION" };
  it("conserve l'identité historique et prépare seulement un nouveau libellé", () => {
    expect(validateSchoolOptionRename(school, request)).toEqual({ option: "Sciences", oldName: "Sciences expérimentales", newName: "Sciences appliquées", labels: { Sciences: "Sciences appliquées" } });
    expect(school.schoolOptions).toEqual(["Sciences", "Littéraire"]);
  });
  it("refuse absence ou différence de confirmation, option étrangère et doublon", () => {
    for (const confirmation of [undefined, "", "CHANGER LE NOM DE CETTE OPTION "]) expect(validateSchoolOptionRename(school, { ...request, confirmation }).error).toBeTruthy();
    expect(validateSchoolOptionRename(school, { ...request, option: "Autre" }).error).toBeTruthy();
    expect(validateSchoolOptionRename(school, { ...request, newName: "litteraire" }).error).toBeTruthy();
    expect(validateSchoolOptionRename(school, { ...request, newName: "<script>" }).error).toBeTruthy();
  });
});
