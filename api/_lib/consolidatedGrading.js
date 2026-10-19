import { studentMatchesAssignment } from "./teacherGrading.js";
import { operationalBaseClassId } from "../../src/utils/studentYearTransition.js";

export const GRADE_SLOTS = ["period_1", "period_2", "semester_1_exam", "period_3", "period_4", "semester_2_exam"];
const courseKey = (classId, subjectId) => `${classId.length}:${classId}${subjectId.length}:${subjectId}`;
const emptyEvaluation = () => ({ score: null, maximum: null, percentage: null, rank: null, complete: false });

/** The server applies the same all-applicable-courses completeness rule as the class UI. */
export function calculateConsolidatedReport({ classId, students, classes, subjects, assignments, configs, entries }) {
  const schoolClass = classes.find((item) => item.id === classId);
  if (!schoolClass) throw new Error("Classe opérationnelle introuvable.");
  const schoolId = schoolClass.schoolId;
  const schoolYearId = schoolClass.schoolYearId;
  const byClass = new Map(classes.map((item) => [item.id, item]));
  const scopedStudents = students.filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId
    && studentMatchesAssignment(student, { classId, schoolId, schoolYearId }, schoolClass, byClass.get(operationalBaseClassId(schoolClass))));
  const applicableAssignments = [...new Map(assignments.filter((assignment) => assignment.active === true && assignment.schoolId === schoolId && assignment.schoolYearId === schoolYearId
    && scopedStudents.some((student) => {
      const assignedClass = byClass.get(assignment.classId);
      return studentMatchesAssignment(student, assignment, assignedClass, byClass.get(operationalBaseClassId(assignedClass)));
    })).map((assignment) => [courseKey(assignment.classId, assignment.subjectId), assignment])).values()];
  const courses = applicableAssignments.map((assignment) => ({
    key: courseKey(assignment.classId, assignment.subjectId), classId: assignment.classId, subjectId: assignment.subjectId,
    name: subjects.find((subject) => subject.id === assignment.subjectId && subject.schoolId === schoolId && subject.schoolYearId === schoolYearId)?.name ?? "Cours non renseigné",
  })).sort((a, b) => a.name.localeCompare(b.name, "fr") || a.key.localeCompare(b.key));
  const entryByKey = new Map(entries.filter((entry) => entry.schoolId === schoolId && entry.schoolYearId === schoolYearId)
    .map((entry) => [`${entry.studentId.length}:${entry.studentId}${courseKey(entry.classId, entry.subjectId)}${entry.gradingSlot}`, entry]));
  const rows = scopedStudents.map((student) => {
    const scores = {}, maxima = {}, statuses = {}, evaluations = {};
    for (const slot of GRADE_SLOTS) {
      let score = 0, maximum = 0, applicable = 0, complete = true;
      for (const course of courses) {
        const assignment = applicableAssignments.find((item) => courseKey(item.classId, item.subjectId) === course.key);
        const assignedClass = byClass.get(course.classId);
        if (!assignment || !studentMatchesAssignment(student, assignment, assignedClass, byClass.get(operationalBaseClassId(assignedClass)))) continue;
        applicable += 1;
        const entry = entryByKey.get(`${student.id.length}:${student.id}${course.key}${slot}`);
        const matching = configs.filter((item) => item.schoolId === schoolId && item.schoolYearId === schoolYearId && item.classId === course.classId && item.subjectId === course.subjectId);
        const config = matching.find((item) => item.gradingSlot === slot) ?? matching.find((item) => !item.gradingSlot);
        const effectiveMaximum = entry?.status === "graded" && Number.isFinite(entry.maxScoreSnapshot) && entry.maxScoreSnapshot > 0
          ? entry.maxScoreSnapshot : config?.maxScore;
        scores[course.key] ??= {}; maxima[course.key] ??= {}; statuses[course.key] ??= {};
        scores[course.key][slot] = entry?.status === "graded" && typeof entry.score === "number" && Number.isFinite(entry.score) ? entry.score : null;
        maxima[course.key][slot] = typeof effectiveMaximum === "number" && Number.isFinite(effectiveMaximum) && effectiveMaximum > 0 ? effectiveMaximum : null;
        statuses[course.key][slot] = entry?.status;
        if (!Number.isFinite(effectiveMaximum) || effectiveMaximum <= 0 || entry?.status !== "graded"
          || typeof entry.score !== "number" || !Number.isFinite(entry.score) || entry.score < 0 || entry.score > effectiveMaximum) {
          complete = false;
          continue;
        }
        score += entry.score;
        maximum += effectiveMaximum;
      }
      evaluations[slot] = applicable > 0 && complete && maximum > 0
        ? { score, maximum, percentage: score / maximum * 100, rank: null, complete: true } : emptyEvaluation();
    }
    return { student, scores, maxima, statuses, evaluations };
  });
  for (const slot of GRADE_SLOTS) {
    const ranked = rows.filter((row) => row.evaluations[slot].complete).sort((a, b) =>
      b.evaluations[slot].percentage - a.evaluations[slot].percentage || a.student.id.localeCompare(b.student.id));
    ranked.forEach((row, index) => {
      const previous = ranked[index - 1];
      row.evaluations[slot].rank = previous && Math.abs(previous.evaluations[slot].percentage - row.evaluations[slot].percentage) < 1e-9
        ? previous.evaluations[slot].rank : index + 1;
    });
  }
  rows.sort((a, b) => [a.student.nom, a.student.postnom, a.student.prenom].join(" ").localeCompare([b.student.nom, b.student.postnom, b.student.prenom].join(" "), "fr") || a.student.id.localeCompare(b.student.id));
  return { courses, students: rows };
}
