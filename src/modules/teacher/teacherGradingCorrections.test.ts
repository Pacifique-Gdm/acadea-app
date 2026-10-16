import { describe, expect, it } from "vitest";
import { maxScoreConfirmation, scopeTeacherGradingData } from "./teacherGrading";
import type { TeacherGradingData } from "./teacherGradingService";

describe("protections de la fiche de cotation", () => {
  it("distingue la première confirmation de la modification persistée", () => {
    expect(maxScoreConfirmation(false)).toBe("ENREGISTRER LA CÔTE MAXIMALE");
    expect(maxScoreConfirmation(true)).toBe("MODIFIER LA CÔTE MAXIMALE");
  });

  it("n'expose que la titularité active de l'enseignant dans son école et son année", () => {
    const base = { schoolId: "s", schoolYearId: "y", teacherId: "t", classId: "c", assignmentId: "a", updatedAt: "", updatedBy: "" };
    const data = {
      teacher: { id: "t", schoolId: "s", schoolYearId: "y", status: "active", firstName: "A", lastName: "B", fullName: "A B", createdAt: "", updatedAt: "", createdBy: "u" },
      assignments: [], classes: [{ id: "c", schoolId: "s", schoolYearId: "y", section: "Secondaire", name: "Classe" }],
      subjects: [], students: [], configs: [], entries: [],
      titulars: [
        { ...base, id: "valid", active: true },
        { ...base, id: "inactive", active: false },
        { ...base, id: "other-school", schoolId: "other", active: true },
        { ...base, id: "other-year", schoolYearId: "old", active: true },
        { ...base, id: "other-teacher", teacherId: "other", active: true },
      ],
    } as TeacherGradingData;
    expect(scopeTeacherGradingData({ section: "Secondaire" }, data).titulars.map((item) => item.id)).toEqual(["valid"]);
    expect(scopeTeacherGradingData({ section: "Primaire" }, data).titulars).toEqual([]);
  });
});
