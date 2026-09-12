import type { PedagogicalAssignment, StudySubject, StudyTeacher } from "./studyTypes";
import { firebaseErrorCode } from "../../utils/refreshErrors";
import { assignmentAppliesToClass, assignmentStudentGroupKey } from "./studyCourseScope";
import type { StudyClass } from "./studyTypes";

export const MAX_WEEKLY_PERIODS = 60;
export const SUBJECT_RENAME_CONFIRMATION = "MODIFIER NOM DE CE COURS";

export function subjectRenameConfirmed(value: string) {
  return value === SUBJECT_RENAME_CONFIRMATION;
}

export function pedagogicalAssignmentId(input: Pick<PedagogicalAssignment, "schoolId" | "schoolYearId" | "teacherId" | "subjectId" | "classId" | "courseScope" | "targetOptionIds" | "studentGroupKey">) {
  const groupKey = input.studentGroupKey ?? assignmentStudentGroupKey(input);
  return [input.schoolId, input.schoolYearId, input.teacherId, input.subjectId, input.classId, groupKey].filter(Boolean).join("__");
}

export function activeAssignmentLockId(input: Pick<PedagogicalAssignment, "schoolId" | "schoolYearId" | "subjectId" | "classId" | "courseScope" | "targetOptionIds" | "studentGroupKey">) {
  const groupKey = input.studentGroupKey ?? assignmentStudentGroupKey(input);
  return [input.schoolId, input.schoolYearId, input.subjectId, input.classId, groupKey].filter(Boolean).join("__");
}

export function validateWeeklyPeriods(value: number) {
  return Number.isInteger(value) && value > 0 && value <= MAX_WEEKLY_PERIODS
    ? ""
    : `Le nombre de périodes doit être un entier compris entre 1 et ${MAX_WEEKLY_PERIODS}.`;
}

export function pedagogicalAssignmentSaveErrorMessage(error: unknown) {
  const code = firebaseErrorCode(error);
  if (code === "permission-denied") return "Vous n’avez pas l’autorisation nécessaire pour enregistrer cette affectation.";
  if (code === "unavailable" || code === "network-request-failed") return "Le service est temporairement indisponible. Vérifiez votre connexion puis réessayez.";
  if (code === "invalid-argument") return "Impossible d’enregistrer cette affectation. Vérifiez les classes sélectionnées.";
  return error instanceof Error && code === "unknown" && error.message
    ? error.message
    : "Impossible d’enregistrer cette affectation.";
}

export function hasActiveAssignmentDuplicate(assignments: PedagogicalAssignment[], candidate: Pick<PedagogicalAssignment, "schoolId" | "schoolYearId" | "teacherId" | "subjectId" | "classId" | "courseScope" | "targetOptionIds">, ignoredId?: string) {
  return assignments.some((assignment) => assignment.id !== ignoredId && assignment.active && pedagogicalAssignmentId(assignment) === pedagogicalAssignmentId(candidate));
}

export function hasActiveSubjectClassConflict(assignments: PedagogicalAssignment[], candidate: Pick<PedagogicalAssignment, "schoolId" | "schoolYearId" | "subjectId" | "classId" | "courseScope" | "targetOptionIds">, ignoredId?: string) {
  const lockId = activeAssignmentLockId(candidate);
  return assignments.some((assignment) => assignment.id !== ignoredId && assignment.active && activeAssignmentLockId(assignment) === lockId);
}

export function expandAssignmentSelections(subjectIds: string[], classIds: string[]) {
  const uniqueSubjects = [...new Set(subjectIds.filter(Boolean))];
  const uniqueClasses = [...new Set(classIds.filter(Boolean))];
  return uniqueSubjects.flatMap((subjectId) => uniqueClasses.map((classId) => ({ subjectId, classId })));
}

export function teacherWorkload(teacherId: string, assignments: PedagogicalAssignment[]) {
  return assignments.filter((assignment) => assignment.teacherId === teacherId && assignment.active).reduce((total, assignment) => total + assignment.weeklyPeriods, 0);
}

export function assignmentsForClasses(assignments: PedagogicalAssignment[], classIds: ReadonlySet<string>, classes: readonly StudyClass[] = []) {
  return assignments.filter((assignment) => classIds.has(assignment.classId) || classes.some((item) => classIds.has(item.id) && assignmentAppliesToClass(assignment, item, classes)));
}

export function subjectsReferencedByAssignments(subjects: StudySubject[], assignments: PedagogicalAssignment[]) {
  const subjectIds = new Set(assignments.map((assignment) => assignment.subjectId));
  return subjects.filter((subject) => subjectIds.has(subject.id));
}

export function studyDashboardMetrics(teachers: StudyTeacher[], assignments: PedagogicalAssignment[]) {
  const activeTeachers = teachers.filter((teacher) => teacher.status === "active");
  const activeAssignments = assignments.filter((assignment) => assignment.active);
  const assignedTeachers = new Set(activeAssignments.map((assignment) => assignment.teacherId));
  return {
    teachers: activeTeachers.length,
    subjects: new Set(activeAssignments.map((assignment) => assignment.subjectId)).size,
    assignments: activeAssignments.length,
    workload: activeAssignments.reduce((total, assignment) => total + assignment.weeklyPeriods, 0),
    teachersWithoutAssignment: activeTeachers.filter((teacher) => !assignedTeachers.has(teacher.id)).length,
  };
}
