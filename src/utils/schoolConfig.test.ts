import { describe, expect, it } from "vitest";
import {
  getSchoolEducationLevels,
  getSchoolClassChoices,
  schoolLevelFromConfig,
  schoolSectionLabels,
  toggleSchoolEducationLevel,
} from "./schoolConfig";
import { normalizeSchoolSection, normalizeSectionField } from "./schoolSections";

describe("configuration canonique CTEB", () => {
  it("ne réinjecte pas CTEB lorsqu'elle est absente de la source de vérité", () => {
    expect(
      getSchoolEducationLevels({
        educationLevels: ["Maternelle", "Primaire", "Secondaire"],
        schoolType: "Mixte",
      }),
    ).toEqual(["Maternelle", "Primaire", "Secondaire"]);
  });

  it("désactive et réactive CTEB comme les autres sections", () => {
    const initial = ["Maternelle", "Primaire", "CTEB", "Secondaire"];
    const disabled = toggleSchoolEducationLevel(initial, "CTEB");
    expect(disabled).toEqual(["Maternelle", "Primaire", "Secondaire"]);
    expect(toggleSchoolEducationLevel(disabled, "CTEB")).toEqual(initial);
  });

  it("canonise et déduplique toutes les variantes historiques", () => {
    expect(
      getSchoolEducationLevels({
        educationLevels: ["CETB", "CTEB", "cetb", "CTEB"],
        schoolType: "Mixte",
      }),
    ).toEqual(["CTEB"]);
    expect(schoolSectionLabels.CTEB).toBe("CTEB");
  });

  it("centralise la lecture legacy sans produire de nouvelle valeur legacy", () => {
    for (const legacy of ["cteb", "CETB", "cetb", "CTEB"])
      expect(normalizeSchoolSection(legacy)).toBe("CTEB");
    expect(
      normalizeSectionField({
        section: "cteb",
        sectionIds: ["CETB", "Primaire"],
      }),
    ).toMatchObject({ section: "CTEB", sectionIds: ["Primaire", "CTEB"] });
  });
  it("reconnaît CTEB et Secondaire sans réintroduire Maternelle ni Primaire", () => {
    const school = { schoolType: "CTEB et Secondaire" as const, educationLevels: ["CTEB", "Secondaire"] };
    expect(getSchoolEducationLevels(school)).toEqual(["CTEB", "Secondaire"]);
    expect(schoolLevelFromConfig(school)).toBe("CTEB et Secondaire");
    const classes = getSchoolClassChoices(school);
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.every((name) => !name.includes("Maternelle") && !name.includes("Primaire"))).toBe(true);
  });
});
