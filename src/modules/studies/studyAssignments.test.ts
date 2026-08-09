import { describe, expect, it } from "vitest";
import type { PedagogicalAssignment, StudyTeacher } from "./studyTypes";
import { hasActiveAssignmentDuplicate, pedagogicalAssignmentId, studyDashboardMetrics, teacherWorkload, validateWeeklyPeriods } from "./studyAssignments";

const teacher = (id: string, status: StudyTeacher["status"] = "active"): StudyTeacher => ({ id, schoolId: "school-a", schoolYearId: "year-a", firstName: id, lastName: "Test", fullName: `${id} Test`, status, createdAt: "now", updatedAt: "now", createdBy: "director-a" });
const assignment = (teacherId: string, subjectId: string, classId: string, weeklyPeriods: number, active = true): PedagogicalAssignment => {
  const scope = { schoolId: "school-a", schoolYearId: "year-a", teacherId, subjectId, classId };
  return { id: pedagogicalAssignmentId(scope), ...scope, weeklyPeriods, active, createdAt: "now", updatedAt: "now", createdBy: "director-a", updatedBy: "director-a" };
};

describe("affectations pédagogiques", () => {
  it("autorise plusieurs matières et plusieurs classes pour un enseignant", () => {
    const assignments = [assignment("teacher-a", "math", "4a", 4), assignment("teacher-a", "physics", "4a", 2), assignment("teacher-a", "computing", "5a", 3)];
    expect(new Set(assignments.map((item) => item.subjectId)).size).toBe(3);
    expect(new Set(assignments.map((item) => item.classId)).size).toBe(2);
    expect(teacherWorkload("teacher-a", assignments)).toBe(9);
  });
  it("ne compte pas une affectation désactivée dans la charge", () => {
    expect(teacherWorkload("teacher-a", [assignment("teacher-a", "math", "4a", 4), assignment("teacher-a", "physics", "4a", 8, false)])).toBe(4);
  });
  it("détecte uniquement le doublon actif du même périmètre", () => {
    const existing = assignment("teacher-a", "math", "4a", 4);
    expect(hasActiveAssignmentDuplicate([existing], existing)).toBe(true);
    expect(hasActiveAssignmentDuplicate([{ ...existing, active: false }], existing)).toBe(false);
    expect(hasActiveAssignmentDuplicate([existing], { ...existing, classId: "5a" })).toBe(false);
  });
  it("valide un nombre entier raisonnable de périodes", () => {
    expect(validateWeeklyPeriods(1)).toBe("");
    expect(validateWeeklyPeriods(60)).toBe("");
    for (const invalid of [0, -1, 1.5, 61]) expect(validateWeeklyPeriods(invalid)).not.toBe("");
  });
  it("calcule le dashboard et les enseignants sans affectation", () => {
    expect(studyDashboardMetrics([teacher("teacher-a"), teacher("teacher-b"), teacher("teacher-c", "inactive")], [assignment("teacher-a", "math", "4a", 4), assignment("teacher-a", "physics", "5a", 2), assignment("teacher-b", "history", "4a", 8, false)])).toEqual({ teachers: 2, subjects: 2, assignments: 2, workload: 6, teachersWithoutAssignment: 1 });
  });
});
