import type { AppData, AppUser } from "../types";

const schoolUserRoles = new Set<AppUser["role"]>(["school_admin", "parent", "cashier", "discipline_director", "secretary"]);

export function getPlatformSchoolStats(schoolId: string, data: AppData) {
  const students = data.students.filter((student) => student.schoolId === schoolId).length;
  const parents = data.parents.filter((parent) => parent.schoolId === schoolId).length;
  const admins = data.users.filter((item) => item.role === "school_admin" && item.schoolId === schoolId && !item.removedAt).length;
  const users = data.users.filter((item) => item.schoolId === schoolId && schoolUserRoles.has(item.role) && !item.removedAt).length;
  return { students, parents, admins, users };
}
