import { describe, expect, it } from "vitest";
import type { AppUser, Student } from "../types";
import { disciplineStudentScope, hasDeclaredSections } from "./disciplineSectionScope";

// Lot B : règle unique des sections pour le Directeur de discipline.
const student = (id: string, section: Student["section"]) => ({ id, schoolId: "s", schoolYearId: "y", section }) as unknown as Student;
const director = (fields: Partial<Pick<AppUser, "section" | "sectionIds">>) => ({ role: "discipline_director" as const, ...fields });

describe("Directeur de discipline : règle unique des sections", () => {
  const students = [student("a", "Primaire"), student("b", "Secondaire")];
  it("sans section : toute l'école", () => {
    expect(disciplineStudentScope(director({}), students).map((item) => item.id)).toEqual(["a", "b"]);
  });
  it("sections invalides : aucun élève (jamais élargi)", () => {
    expect(disciplineStudentScope(director({ sectionIds: ["Lycée" as never] }), students)).toEqual([]);
    expect(disciplineStudentScope(director({ section: "Lycée" as never }), students)).toEqual([]);
  });
  it("sait si des sections sont renseignées", () => {
    expect(hasDeclaredSections({})).toBe(false);
    expect(hasDeclaredSections({ sectionIds: [] })).toBe(false);
    expect(hasDeclaredSections({ section: "Primaire" })).toBe(true);
  });
  it("les autres rôles ne sont pas filtrés", () => {
    expect(disciplineStudentScope({ role: "secretary", sectionIds: ["Primaire"] }, students)).toHaveLength(2);
  });
});
