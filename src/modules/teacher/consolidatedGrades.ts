import type { Student } from "../../types";
import { studentBelongsToAssignment } from "../studies/studyCourseScope";
import type { PedagogicalAssignment, StudyClass, StudySubject } from "../studies/studyTypes";
import { applicableGradingConfig, editableGradingSlots, type CourseGradingConfig, type EditableGradingSlot, type GradeEntry } from "./teacherGrading";

export type ConsolidatedCourse = { key: string; classId: string; subjectId: string; name: string };
export type ConsolidatedEvaluation = {
  score: number | null;
  maximum: number | null;
  percentage: number | null;
  rank: number | null;
  complete: boolean;
};
export type ConsolidatedStudent = {
  student: Student;
  scores: Record<string, Partial<Record<EditableGradingSlot, number | null>>>;
  maxima: Record<string, Partial<Record<EditableGradingSlot, number | null>>>;
  statuses: Record<string, Partial<Record<EditableGradingSlot, GradeEntry["status"]>>>;
  evaluations: Record<EditableGradingSlot, ConsolidatedEvaluation>;
};
export type ConsolidatedClassReport = { courses: ConsolidatedCourse[]; students: ConsolidatedStudent[] };

const courseKey = (classId: string, subjectId: string) => `${classId.length}:${classId}${subjectId.length}:${subjectId}`;
const emptyEvaluation = (): ConsolidatedEvaluation => ({ score: null, maximum: null, percentage: null, rank: null, complete: false });

/**
 * An evaluation is rankable only if every currently applicable course has a
 * recorded grade and a valid maximum. An old grade retains its recorded
 * maxScoreSnapshot even when the course configuration changes later.
 */
export function buildConsolidatedClassReport(input: {
  schoolId: string;
  schoolYearId: string;
  classId: string;
  students: readonly Student[];
  classes: readonly StudyClass[];
  subjects: readonly StudySubject[];
  assignments: readonly PedagogicalAssignment[];
  configs: readonly CourseGradingConfig[];
  entries: readonly GradeEntry[];
}): ConsolidatedClassReport {
  const schoolClass = input.classes.find((item) => item.id === input.classId && item.schoolId === input.schoolId && item.schoolYearId === input.schoolYearId);
  if (!schoolClass) throw new Error("Classe opérationnelle introuvable.");
  const scopedStudents = input.students.filter((student) => student.schoolId === input.schoolId && student.schoolYearId === input.schoolYearId
    && studentBelongsToAssignment(student, { classId: input.classId, schoolId: input.schoolId, schoolYearId: input.schoolYearId }, input.classes));
  const scopedAssignments = input.assignments.filter((assignment) => assignment.active && assignment.schoolId === input.schoolId && assignment.schoolYearId === input.schoolYearId
    && scopedStudents.some((student) => studentBelongsToAssignment(student, assignment, input.classes)));
  const assignments = [...new Map(scopedAssignments.map((item) => [courseKey(item.classId, item.subjectId), item])).values()];
  const courses = assignments.map((assignment) => ({
    key: courseKey(assignment.classId, assignment.subjectId), classId: assignment.classId, subjectId: assignment.subjectId,
    name: input.subjects.find((subject) => subject.id === assignment.subjectId && subject.schoolId === input.schoolId && subject.schoolYearId === input.schoolYearId)?.name ?? "Cours non renseigné",
  })).sort((a, b) => a.name.localeCompare(b.name, "fr") || a.key.localeCompare(b.key));
  const entryByKey = new Map(input.entries.filter((item) => item.schoolId === input.schoolId && item.schoolYearId === input.schoolYearId)
    .map((item) => [`${item.studentId.length}:${item.studentId}${courseKey(item.classId, item.subjectId)}${item.gradingSlot}`, item]));
  const rows: ConsolidatedStudent[] = scopedStudents.map((student) => {
    const scores: ConsolidatedStudent["scores"] = {};
    const maxima: ConsolidatedStudent["maxima"] = {};
    const statuses: ConsolidatedStudent["statuses"] = {};
    const evaluations = Object.fromEntries(editableGradingSlots.map((slot) => {
      let score = 0;
      let maximum = 0;
      let applicable = 0;
      let complete = true;
      for (const course of courses) {
        const assignment = assignments.find((item) => courseKey(item.classId, item.subjectId) === course.key);
        if (!assignment || !studentBelongsToAssignment(student, assignment, input.classes)) continue;
        applicable += 1;
        const entry = entryByKey.get(`${student.id.length}:${student.id}${course.key}${slot}`);
        const configured = applicableGradingConfig(input.configs, course.classId, course.subjectId, slot, input.schoolId, input.schoolYearId);
        const effectiveMaximum = entry?.status === "graded" && Number.isFinite(entry.maxScoreSnapshot) && entry.maxScoreSnapshot > 0
          ? entry.maxScoreSnapshot : configured?.maxScore;
        scores[course.key] ??= {};
        maxima[course.key] ??= {};
        statuses[course.key] ??= {};
        scores[course.key][slot] = entry?.status === "graded" && typeof entry.score === "number" && Number.isFinite(entry.score) ? entry.score : null;
        maxima[course.key][slot] = typeof effectiveMaximum === "number" && Number.isFinite(effectiveMaximum) && effectiveMaximum > 0 ? effectiveMaximum : null;
        statuses[course.key][slot] = entry?.status;
        if (!Number.isFinite(effectiveMaximum) || !effectiveMaximum || effectiveMaximum <= 0
          || entry?.status !== "graded" || typeof entry.score !== "number" || !Number.isFinite(entry.score)
          || entry.score < 0 || entry.score > effectiveMaximum) {
          complete = false;
          continue;
        }
        score += entry.score;
        maximum += effectiveMaximum;
      }
      return [slot, applicable > 0 && complete && maximum > 0
        ? { score, maximum, percentage: score / maximum * 100, rank: null, complete: true }
        : emptyEvaluation()];
    })) as Record<EditableGradingSlot, ConsolidatedEvaluation>;
    return { student, scores, maxima, statuses, evaluations };
  });
  for (const slot of editableGradingSlots) {
    const ranked = rows.filter((row) => row.evaluations[slot].complete).sort((a, b) =>
      b.evaluations[slot].percentage! - a.evaluations[slot].percentage! || a.student.id.localeCompare(b.student.id));
    ranked.forEach((row, index) => {
      const previous = ranked[index - 1];
      row.evaluations[slot].rank = previous && Math.abs(previous.evaluations[slot].percentage! - row.evaluations[slot].percentage!) < 1e-9
        ? previous.evaluations[slot].rank : index + 1;
    });
  }
  rows.sort((a, b) => [a.student.nom, a.student.postnom, a.student.prenom].join(" ").localeCompare([b.student.nom, b.student.postnom, b.student.prenom].join(" "), "fr") || a.student.id.localeCompare(b.student.id));
  return { courses, students: rows };
}
