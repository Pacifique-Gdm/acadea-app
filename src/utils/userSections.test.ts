import { describe, expect, it } from "vitest";
import { filterByAllowedSections, isSectionAllowed, normalizeSectionIds, sectionsAvailableToUser, userSectionIds } from "./userSections";

it("normalise les variantes historiques vers CTEB sans doublon", () => {
  expect(normalizeSectionIds(["CETB", "CTEB", "cetb", "cteb"])).toEqual(["CTEB"]);
});

describe("périmètre multi-sections", () => {
  it("déduplique les sections et conserve le champ legacy", () => {
    expect(normalizeSectionIds(["Primaire", "Primaire", "Secondaire", "inconnue"])).toEqual(["Primaire", "Secondaire"]);
    expect(userSectionIds({ section: "CTEB" })).toEqual(["CTEB"]);
  });
  it("calcule l’union autorisée et exclut les autres sections", () => {
    const user = { sectionIds: ["Primaire", "Secondaire"] as Array<"Primaire" | "Secondaire"> };
    expect(isSectionAllowed(user, "Primaire")).toBe(true);
    expect(isSectionAllowed(user, "CTEB")).toBe(false);
    const resources: Array<{ section: "Primaire" | "CTEB" | "Secondaire" }> = [{ section: "Primaire" }, { section: "CTEB" }, { section: "Secondaire" }];
    expect(filterByAllowedSections(user, resources, (item) => item.section)).toHaveLength(2);
  });
  it("limite les choix à la configuration réelle de l’école et garde le fallback historique", () => {
    expect(sectionsAvailableToUser({ sectionIds: ["Primaire", "Secondaire"] }, { educationLevels: ["Primaire", "Secondaire"] })).toEqual(["Primaire", "Secondaire"]);
    expect(isSectionAllowed({}, "CTEB")).toBe(true);
  });
});
