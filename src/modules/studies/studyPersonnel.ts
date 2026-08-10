import type { PedagogicalAssignment, StudyTeacher } from "./studyTypes";

export function getActiveSchedulePersonnel(
  teachers: StudyTeacher[],
  assignments: PedagogicalAssignment[],
) {
  const activeTeachers = teachers.filter((teacher) => teacher.status === "active");
  const activeTeacherIds = new Set(activeTeachers.map((teacher) => teacher.id));

  return {
    teachers: activeTeachers,
    assignments: assignments.filter(
      (assignment) => assignment.active && activeTeacherIds.has(assignment.teacherId),
    ),
  };
}
