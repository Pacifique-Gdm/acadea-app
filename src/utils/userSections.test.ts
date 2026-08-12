import { describe, expect, it } from "vitest";
import { filterByAllowedSections, isSectionAllowed, normalizeSectionIds, sectionsAvailableToUser, userSectionIds } from "./userSections";

describe("périmètre multi-sections", () => {
  it("déduplique les sections et conserve le champ legacy", () => {
    expect(normalizeSectionIds(["primaire", "primaire", "secondaire", "inconnue"])).toEqual(["primaire", "secondaire"]);
    expect(userSectionIds({ section: "cteb" })).toEqual(["cteb"]);
  });
  it("calcule l’union autorisée et exclut les autres sections", () => {
    const user = { sectionIds: ["primaire", "secondaire"] as Array<"primaire" | "secondaire"> };
    expect(isSectionAllowed(user, "primaire")).toBe(true);
    expect(isSectionAllowed(user, "cteb")).toBe(false);
    const resources: Array<{ section: "primaire" | "cteb" | "secondaire" }> = [{ section: "primaire" }, { section: "cteb" }, { section: "secondaire" }];
    expect(filterByAllowedSections(user, resources, (item) => item.section)).toHaveLength(2);
  });
  it("limite les choix à la configuration réelle de l’école et garde le fallback historique", () => {
    expect(sectionsAvailableToUser({ sectionIds: ["primaire", "secondaire"] }, { educationLevels: ["Primaire", "Secondaire"] })).toEqual(["primaire", "secondaire"]);
    expect(isSectionAllowed({}, "cteb")).toBe(true);
  });
});
