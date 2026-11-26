import { describe, expect, it } from "vitest";
import type { School } from "../types";
import { canManageSections, resolveSectionAuthority } from "./sectionAuthority";

const school = (educationLevels: string[], schoolType?: string) => ({ educationLevels, schoolType } as Pick<School, "educationLevels" | "schoolType">);
const complete = school(["Maternelle", "Primaire", "CTEB", "Secondaire"]);

describe("périmètre de réglage par section (règle unique)", () => {
  it("un compte sans section agit pour toute l'école, comme avant", () => {
    const authority = resolveSectionAuthority({}, complete);
    expect(authority).toEqual({ wholeSchool: true, sections: ["Maternelle", "Primaire", "CTEB", "Secondaire"], schoolSections: ["Maternelle", "Primaire", "CTEB", "Secondaire"] });
    expect(canManageSections(authority, [])).toBe(true);
    expect(canManageSections(authority, ["Primaire"])).toBe(true);
  });

  it("un compte dont les sections couvrent toutes celles de l'école agit pour toute l'école", () => {
    const authority = resolveSectionAuthority({ sectionIds: ["Secondaire", "CTEB"] }, school(["CTEB et Secondaire"]));
    expect(authority.wholeSchool).toBe(true);
    expect(authority.sections).toEqual(["CTEB", "Secondaire"]);
    expect(canManageSections(authority, null)).toBe(true);
  });

  it("une école d'une seule section : son responsable agit pour toute l'école", () => {
    expect(resolveSectionAuthority({ section: "Primaire" }, school([], "Primaire uniquement")).wholeSchool).toBe(true);
  });

  it("un compte d'une partie des sections agit seulement sur ses sections", () => {
    const authority = resolveSectionAuthority({ sectionIds: ["Primaire"] }, complete);
    expect(authority.wholeSchool).toBe(false);
    expect(authority.sections).toEqual(["Primaire"]);
    expect(canManageSections(authority, ["Primaire"])).toBe(true);
    expect(canManageSections(authority, ["Secondaire"])).toBe(false);
    expect(canManageSections(authority, ["Primaire", "Secondaire"])).toBe(false);
    // Élément « toute l'école » : lecture seule.
    expect(canManageSections(authority, [])).toBe(false);
    expect(canManageSections(authority, undefined)).toBe(false);
  });

  it("lit sectionIds en priorité, sinon section, et ignore une section absente de l'école", () => {
    expect(resolveSectionAuthority({ sectionIds: [], section: "CTEB" }, complete).sections).toEqual(["CTEB"]);
    expect(resolveSectionAuthority({ sectionIds: ["Primaire"], section: "CTEB" }, complete).sections).toEqual(["Primaire"]);
    const outside = resolveSectionAuthority({ section: "Maternelle" }, school(["Secondaire"]));
    expect(outside).toMatchObject({ wholeSchool: false, sections: [] });
  });

  it("le paramètre prévu pour R6 ne change encore rien", () => {
    const user = { sectionIds: ["Primaire" as const] };
    expect(resolveSectionAuthority(user, complete, { sectionSettingsManagers: { Primaire: "autre" } })).toEqual(resolveSectionAuthority(user, complete));
  });
});
