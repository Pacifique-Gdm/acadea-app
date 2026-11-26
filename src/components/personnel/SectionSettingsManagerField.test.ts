import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppUser, School } from "../../types";
import { SectionSettingsManagerField } from "./SectionSettingsManagerField";
import { eligibleManagerSections, sectionManagerId, sectionNeedsManager, toAuthorityManagers } from "../../utils/sectionSettingsManagers";
import { readSectionSettingsManagers } from "../../services/sectionSettingsManagers";

// Lot R6 : case « Responsable des réglages de la section » (fiche du personnel).
const school = { id: "school-a", educationLevels: ["Secondaire"] } as unknown as School;
const admin = { id: "admin", role: "school_admin", schoolId: school.id, name: "Admin" } as AppUser;
const prefect = { id: "prefect", role: "study_director", studyFunction: "prefect_of_studies", schoolId: school.id, sectionIds: ["Secondaire"], name: "Jean Kasa" } as unknown as AppUser;
const director = { id: "director", role: "study_director", schoolId: school.id, sectionIds: ["Secondaire"], name: "Marie Lunda" } as unknown as AppUser;
const primary = { id: "primary", role: "study_director", studyFunction: "primary_director", schoolId: school.id, sectionIds: ["Primaire"], name: "Paul" } as unknown as AppUser;
const render = (props: Partial<Parameters<typeof SectionSettingsManagerField>[0]>) => renderToStaticMarkup(createElement(SectionSettingsManagerField, { admin, school, target: director, personnel: [prefect, director, primary], managersOverride: {}, ...props }));

describe("lot R6 : case dans la fiche du personnel", () => {
  it("apparaît pour l'administrateur quand le Secondaire a un Préfet ET un Directeur", () => {
    const html = render({});
    expect(html).toContain("Responsable des réglages de la section Secondaire");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("checked");
  });
  it("cochée pour le responsable, et « Actuellement : » chez l'autre", () => {
    expect(render({ managersOverride: { Secondaire: { userId: "director" } } })).toContain('checked=""');
    const html = render({ target: prefect, managersOverride: { Secondaire: { userId: "director" } } });
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Actuellement : Marie Lunda, Directeur des études");
  });
  it("n'apparaît pas sans Préfet, pour une autre section ou pour un autre rôle que l'administrateur", () => {
    expect(render({ personnel: [director, primary] })).toBe("");
    expect(render({ target: primary })).toBe("");
    expect(render({ admin: { ...director } })).toBe("");
    expect(render({ admin: { ...admin, schoolId: "school-b" } })).toBe("");
    expect(render({ personnel: [{ ...prefect, status: "inactive" } as AppUser, director] })).toBe("");
  });
});

describe("lot R6 : règle et lecture du document", () => {
  it("règle identique au serveur", () => {
    expect(sectionNeedsManager([prefect, director], school.id, "Secondaire")).toBe(true);
    expect(sectionNeedsManager([prefect, director], school.id, "Primaire")).toBe(false);
    expect(eligibleManagerSections([prefect, director], school.id, prefect)).toEqual(["Secondaire"]);
    expect(sectionManagerId({ Secondaire: { userId: "prefect" } }, "Secondaire")).toBe("prefect");
    expect(sectionManagerId({ Secondaire: { userId: "prefect" } }, "Primaire")).toBeUndefined();
    expect(sectionManagerId(undefined, null)).toBeUndefined();
    expect(toAuthorityManagers({ Secondaire: { userId: "prefect" }, CTEB: { userId: "" } })).toEqual({ Secondaire: "prefect" });
  });
  it("ignore un document d'une autre école ou mal formé", () => {
    expect(readSectionSettingsManagers({ schoolId: "school-a", managers: { Secondaire: { userId: "prefect", updatedAt: "t" }, Primaire: { userId: "x" }, CTEB: { userId: 3 } } }, "school-a")).toEqual({ Secondaire: { userId: "prefect", updatedAt: "t" } });
    expect(readSectionSettingsManagers({ schoolId: "school-b", managers: { Secondaire: { userId: "prefect" } } }, "school-a")).toEqual({});
    expect(readSectionSettingsManagers(undefined, "school-a")).toEqual({});
  });
});
