import { describe, expect, it } from "vitest";
import type { Student } from "../../types";
import type { PedagogicalAssignment, StudyClass, StudySubject } from "../studies/studyTypes";
import type { CourseGradingConfig, GradeEntry } from "./teacherGrading";
import { buildConsolidatedClassReport } from "./consolidatedGrades";
import { calculateConsolidatedReport } from "../../../api/_lib/consolidatedGrading.js";

const base = "school__2027-2028__3e";
const science = `${base}::sciences`;
const literary = `${base}::litteraire`;
const scope = { schoolId: "school", schoolYearId: "year" };
const classes = [
  { id: base, name: "3ème", ...scope },
  { id: science, name: "3ème Sciences", parentClassId: base, classOptionKey: science, ...scope },
  { id: literary, name: "3ème Littéraire", parentClassId: base, classOptionKey: literary, ...scope },
] as StudyClass[];
const students = ["a", "b", "c"].map((id) => ({ id, nom: id, postnom: "", prenom: "", classId: base, classOptionKey: science, status: "ACTIVE", ...scope })) as Student[];
const assignments = [
  { id: "common", classId: base, subjectId: "math", active: true, ...scope },
  { id: "option", classId: science, subjectId: "french", active: true, ...scope },
  { id: "other-option", classId: literary, subjectId: "history", active: true, ...scope },
] as PedagogicalAssignment[];
const subjects = [
  { id: "math", name: "Mathématiques", ...scope },
  { id: "french", name: "Français", ...scope },
  { id: "history", name: "Histoire", ...scope },
] as StudySubject[];
const configs = [
  { id: "legacy-math", classId: base, subjectId: "math", maxScore: 20, ...scope },
  { id: "math-period-2", classId: base, subjectId: "math", gradingSlot: "period_2", maxScore: 10, ...scope },
  { id: "french-period-1", classId: science, subjectId: "french", gradingSlot: "period_1", maxScore: 30, ...scope },
  { id: "french-period-2", classId: science, subjectId: "french", gradingSlot: "period_2", maxScore: 20, ...scope },
] as CourseGradingConfig[];
const grade = (studentId: string, classId: string, subjectId: string, gradingSlot: GradeEntry["gradingSlot"], score: number, maxScoreSnapshot: number) =>
  ({ id: `${studentId}-${classId}-${subjectId}-${gradingSlot}`, studentId, classId, subjectId, gradingSlot, score, maxScoreSnapshot, status: "graded", ...scope }) as GradeEntry;

describe("tableau consolidé et palmarès", () => {
  it("agrège plusieurs enseignants et cours, classe les résultats complets sans mélanger les options", () => {
    const entries = [
      grade("a", base, "math", "period_1", 15, 20), grade("a", science, "french", "period_1", 30, 30),
      grade("b", base, "math", "period_1", 15, 20), grade("b", science, "french", "period_1", 30, 30),
      grade("c", base, "math", "period_1", 0, 20), grade("c", science, "french", "period_1", 30, 30),
      grade("a", base, "math", "period_2", 7, 10), grade("a", science, "french", "period_2", 8, 20),
      grade("b", base, "math", "period_2", 9, 10),
    ];
    const report = buildConsolidatedClassReport({ ...scope, classId: science, students: [...students, { ...students[0], id: "other", classOptionKey: literary }], classes, subjects, assignments, configs, entries });
    const serverReport = calculateConsolidatedReport({ classId: science, students: [...students, { ...students[0], id: "other", classOptionKey: literary }], classes, subjects, assignments, configs, entries });
    expect(serverReport).toEqual(report);
    expect(report.courses.map((course) => course.name)).toEqual(["Français", "Mathématiques"]);
    expect(report.students.map((row) => row.student.id)).toEqual(["a", "b", "c"]);
    expect(report.students.map((row) => row.evaluations.period_1.rank)).toEqual([1, 1, 3]);
    expect(report.students[0].evaluations.period_1.percentage).toBe(90);
    expect(report.students[2].scores[report.courses.find((course) => course.subjectId === "math")!.key].period_1).toBe(0);
    expect(report.students[0].evaluations.period_2.percentage).toBe(50);
    expect(report.students[1].evaluations.period_2).toMatchObject({ percentage: null, rank: null, complete: false });
    expect(report.students[0].evaluations.semester_1_exam.rank).toBeNull();
  });

  it("préserve le maximum historique enregistré et refuse un résultat incohérent ou absent", () => {
    const entries = [grade("a", base, "math", "period_1", 10, 25), grade("a", science, "french", "period_1", 15, 30),
      grade("b", base, "math", "period_1", 0, 20), grade("b", science, "french", "period_1", 31, 30)];
    const report = buildConsolidatedClassReport({ ...scope, classId: science, students, classes, subjects, assignments, configs, entries });
    expect(report.students[0].evaluations.period_1).toMatchObject({ maximum: 55, score: 25, rank: 1 });
    expect(report.students[1].evaluations.period_1).toMatchObject({ percentage: null, rank: null, complete: false });
    expect(report.students[2].evaluations.period_1).toMatchObject({ percentage: null, rank: null, complete: false });
  });
});
