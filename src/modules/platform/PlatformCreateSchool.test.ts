import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { educationLevelsForSchoolLevel } from "../../utils/schoolConfig";

describe("Super Administrateur — création école par niveau", () => {
  const source = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");

  it("réutilise le modèle de niveau de la fiche école", () => {
    expect(source).toContain("Niveau de l'école");
    expect(source).not.toContain("Sections disponibles");
    expect(source).toContain("schoolLevelChoices.map");
    expect(source).toContain("educationLevelsForSchoolLevel(schoolLevel)");
    expect(source).toContain("schoolType: schoolLevel");
    expect(source).toContain("educationLevels: schoolSections");
  });

  it("affiche les options uniquement lorsqu'un niveau inclut le secondaire", () => {
    expect(source).toContain('const hasSecondarySection = schoolSections.includes("Secondaire")');
    expect(source).toContain("{hasSecondarySection && (");
    expect(source).toContain('if (!educationLevelsForSchoolLevel(level).includes("Secondaire"))');
    expect(source).toContain("setSelectedSchoolOptions([])");
    expect(source).toContain('setCustomSchoolOption("")');
  });

  it.each([
    ["Maternelle", false],
    ["Primaire", false],
    ["CTEB", false],
    ["Secondaire", true],
    ["Primaire uniquement", false],
    ["CTEB uniquement", false],
    ["Secondaire uniquement", true],
  ] as const)("mappe %s et la visibilité des options", (level, optionsVisible) => {
    const educationLevels = educationLevelsForSchoolLevel(level);
    expect(educationLevels.includes("Secondaire")).toBe(optionsVisible);
  });
});
