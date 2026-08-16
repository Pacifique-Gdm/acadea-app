import { describe, expect, it } from "vitest";
import type { AppUser, DisciplineSanction, ParentProfile, Student } from "../types";
import { disciplineParentScope, disciplineSanctionScope, disciplineStudentScope } from "./disciplineSectionScope";

const student = (id: string, section: Student["section"]): Student => ({ id, schoolId: "school-a", schoolYearId: "year-a", matricule: id, nom: id, postnom: "", prenom: "", sexe: "M", birthDate: "2010-01-01", address: "", phone: "", className: section === "Secondaire" ? "1ère Humanité" : "2ème Primaire", section });
const director = (sectionIds: AppUser["sectionIds"]): Pick<AppUser, "role" | "section" | "sectionIds"> => ({ role: "discipline_director", sectionIds });

describe("périmètre partagé du Directeur de Discipline", () => {
  const students = [student("a", "Primaire"), student("b", "Secondaire")];
  const parents: ParentProfile[] = [
    { id: "pa", schoolId: "school-a", schoolYearId: "year-a", userId: "upa", fullName: "Parent A", phone: "", email: "", address: "", studentIds: ["a"], status: "active" },
    { id: "pb", schoolId: "school-a", schoolYearId: "year-a", userId: "upb", fullName: "Parent B", phone: "", email: "", address: "", studentIds: ["b"], status: "active" },
  ];
  const sanctions: DisciplineSanction[] = [
    { id: "sa", schoolId: "school-a", schoolYearId: "year-a", studentId: "a", studentName: "a", className: "2ème Primaire", reason: "Retard", description: "", sanctionType: "Avertissement", duration: 1, startDate: "2026-01-01", expectedEndDate: "2026-01-02", status: "active", recurrenceNumber: 1, observation: "", createdBy: "admin", createdByName: "Admin", createdAt: "2026-01-01" },
    { id: "sb", schoolId: "school-a", schoolYearId: "year-a", studentId: "b", studentName: "b", className: "1ère Humanité", reason: "Retard", description: "", sanctionType: "Avertissement", duration: 1, startDate: "2026-01-01", expectedEndDate: "2026-01-02", status: "active", recurrenceNumber: 1, observation: "", createdBy: "admin", createdByName: "Admin", createdAt: "2026-01-01" },
  ];

  it("retourne uniquement la section attribuée et aucune donnée si le scope est vide", () => {
    expect(disciplineStudentScope(director(["Primaire"]), students).map((item) => item.id)).toEqual(["a"]);
    expect(disciplineStudentScope(director([]), students)).toEqual([]);
  });

  it("réutilise les élèves autorisés pour parents et sanctions", () => {
    const scoped = disciplineStudentScope(director(["Secondaire"]), students);
    expect(disciplineParentScope(director(["Secondaire"]), parents, scoped).map((item) => item.id)).toEqual(["pb"]);
    expect(disciplineSanctionScope(director(["Secondaire"]), sanctions, scoped).map((item) => item.id)).toEqual(["sb"]);
  });
});
