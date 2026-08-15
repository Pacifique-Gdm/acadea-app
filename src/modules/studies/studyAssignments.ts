import type { PedagogicalAssignment, StudySubject, StudyTeacher } from "./studyTypes";

export const MAX_WEEKLY_PERIODS = 60;

export function pedagogicalAssignmentId(input: Pick<PedagogicalAssignment, "schoolId" | "schoolYearId" | "teacherId" | "subjectId" | "classId">) {
  return [input.schoolId, input.schoolYearId, input.teacherId, input.subjectId, input.classId].join("__");
}

export function validateWeeklyPeriods(value: number) {
  return Number.isInteger(value) && value > 0 && value <= MAX_WEEKLY_PERIODS
    ? ""
    : `Le nombre de périodes doit être un entier compris entre 1 et ${MAX_WEEKLY_PERIODS}.`;
}

export function hasActiveAssignmentDuplicate(assignments: PedagogicalAssignment[], candidate: Pick<PedagogicalAssignment, "schoolId" | "schoolYearId" | "teacherId" | "subjectId" | "classId">, ignoredId?: string) {
  return assignments.some((assignment) => assignment.id !== ignoredId && assignment.active && pedagogicalAssignmentId(assignment) === pedagogicalAssignmentId(candidate));
}

export function expandAssignmentSelections(subjectIds: string[], classIds: string[]) {
  const uniqueSubjects = [...new Set(subjectIds.filter(Boolean))];
  const uniqueClasses = [...new Set(classIds.filter(Boolean))];
  return uniqueSubjects.flatMap((subjectId) => uniqueClasses.map((classId) => ({ subjectId, classId })));
}

export function teacherWorkload(teacherId: string, assignments: PedagogicalAssignment[]) {
  return assignments.filter((assignment) => assignment.teacherId === teacherId && assignment.active).reduce((total, assignment) => total + assignment.weeklyPeriods, 0);
}

export function assignmentsForClasses(assignments: PedagogicalAssignment[], classIds: ReadonlySet<string>) {
  return assignments.filter((assignment) => classIds.has(assignment.classId));
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
