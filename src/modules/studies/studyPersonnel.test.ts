import { describe, expect, it } from "vitest";
import { getActiveSchedulePersonnel } from "./studyPersonnel";
import type { PedagogicalAssignment, StudyTeacher } from "./studyTypes";

const teacher = (id: string, status: "active" | "inactive"): StudyTeacher => ({
  id, userId: `user-${id}`, schoolId: "school-a", schoolYearId: "year-a",
  firstName: id, lastName: "Test", fullName: `${id} Test`, status,
  createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "admin-a",
});
const assignment = (id: string, teacherId: string, active = true): PedagogicalAssignment => ({
  id, schoolId: "school-a", schoolYearId: "year-a", teacherId,
  subjectId: "subject-a", classId: "class-a", weeklyPeriods: 2, active,
  createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "admin-a", updatedBy: "admin-a",
});

describe("personnels candidats aux nouvelles générations d’horaires", () => {
  it("exclut l’enseignant archivé et ses affectations sans altérer les sources historiques", () => {
    const teachers = [teacher("active", "active"), teacher("archived", "inactive")];
    const assignments = [assignment("current", "active"), assignment("historical", "archived")];

    const result = getActiveSchedulePersonnel(teachers, assignments);

    expect(result.teachers.map((item) => item.id)).toEqual(["active"]);
    expect(result.assignments.map((item) => item.id)).toEqual(["current"]);
    expect(teachers).toHaveLength(2);
    expect(assignments).toHaveLength(2);
  });

  it("exclut aussi une affectation inactive d’un enseignant actif", () => {
    const result = getActiveSchedulePersonnel([teacher("active", "active")], [assignment("old", "active", false)]);
    expect(result.assignments).toEqual([]);
  });
});
