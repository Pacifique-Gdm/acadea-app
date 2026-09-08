import type { AppData, AppUser } from "../types";

const schoolUserRoles = new Set<AppUser["role"]>(["school_admin", "parent", "cashier", "discipline_director", "secretary"]);

export function getPlatformSchoolStats(schoolId: string, data: AppData, schoolYearId?: string) {
  const scopedStudents = data.students.filter((student) => student.schoolId === schoolId && (!schoolYearId || student.schoolYearId === schoolYearId));
  const students = scopedStudents.length;
  const scopedStudentIds = new Set(scopedStudents.map((student) => student.id));
  const parents = data.parents.filter((parent) => parent.schoolId === schoolId && (!schoolYearId || parent.studentIds.some((studentId) => scopedStudentIds.has(studentId)) || scopedStudents.some((student) => student.parentId === parent.id))).length;
  const usersForYear = data.users.filter((item) => item.schoolId === schoolId && !item.removedAt && (!schoolYearId || !item.activeSchoolYearId || item.activeSchoolYearId === schoolYearId));
  const admins = usersForYear.filter((item) => item.role === "school_admin").length;
  const users = usersForYear.filter((item) => schoolUserRoles.has(item.role)).length;
  return { students, parents, admins, users };
}
