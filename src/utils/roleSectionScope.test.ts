import { describe, expect, it } from "vitest";
import { filterByAllowedSections, isSectionAllowed } from "./userSections";
import { getStudentSection } from "./studentClasses";
import type { AppUser, Student } from "../types";

const user = (sectionIds: AppUser["sectionIds"]): AppUser => ({ id: "director", name: "Test", email: "test@example.test", role: "discipline_director", schoolId: "school-a", sectionIds, status: "active" });
const student = (id: string, section: Student["section"], schoolId = "school-a", schoolYearId = "year-a"): Student => ({ id, schoolId, schoolYearId, matricule: id, nom: id, postnom: "", prenom: "", sexe: "M", birthDate: "2010-01-01", address: "", phone: "", className: section === "Secondaire" ? "1ère Humanité" : "2ème Primaire", section });

describe("périmètre temps réel des directeurs", () => {
  const values = [student("primary", "Primaire"), student("secondary", "Secondaire"), student("foreign", "Primaire", "school-b")];
  const tenantYear = values.filter((item) => item.schoolId === "school-a" && item.schoolYearId === "year-a");

  it("applique l’union des sections", () => expect(filterByAllowedSections(user(["Primaire", "Secondaire"]), tenantYear, getStudentSection).map((item) => item.id)).toEqual(["primary", "secondary"]));
  it("retire sans état stale une section supprimée", () => expect(filterByAllowedSections(user(["Secondaire"]), tenantYear, getStudentSection).map((item) => item.id)).toEqual(["secondary"]));
  it("préserve l’isolation école et année avant le scope section", () => expect(tenantYear.map((item) => item.id)).toEqual(["primary", "secondary"]));
});


describe("section administrator interface/export filtering", () => {
  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"] as const)("filters tenant and sections for %s", role => {
    const actor = { ...user(["Primaire", "CTEB"]), role };
    const values = [student("own", "Primaire"), student("foreign", "Primaire", "school-b"), student("other-section", "Secondaire")];
    expect(filterByAllowedSections(actor, values, getStudentSection).map(item => item.id)).toEqual(["own"]);
    expect(filterByAllowedSections({ ...actor, sectionIds: [] }, values, getStudentSection)).toEqual([]);
    expect(filterByAllowedSections({ ...actor, schoolId: undefined }, values, getStudentSection)).toEqual([]);
    expect(isSectionAllowed(actor, undefined)).toBe(false);
    expect(filterByAllowedSections(actor, [{ ...student("unattributed", "Primaire"), section: undefined }], getStudentSection)).toEqual([]);
  });
  it("does not use legacy single-section fallback for a new profile", () => {
    const actor = { ...user([]), role: "primary_admin" as const, section: "Primaire" as const };
    expect(isSectionAllowed(actor, "Primaire")).toBe(false);
  });
});
