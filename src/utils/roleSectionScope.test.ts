import { describe, expect, it } from "vitest";
import { filterByAllowedSections } from "./userSections";
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
