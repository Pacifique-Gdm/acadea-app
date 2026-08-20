import type { AppData } from "../types";

export const PARENT_UNLINK_CONFIRMATION = "DÉLIER LE PARENT";

export function isExactParentUnlinkConfirmation(value: string) {
  return value === PARENT_UNLINK_CONFIRMATION;
}

export function applyParentUnlinkResult(
  data: Pick<AppData, "students" | "parents" | "users">,
  result: { studentId: string; parentId: string; parentStudentIds: string[] },
) {
  return {
    students: data.students.map((student) => (student.id === result.studentId ? { ...student, parentId: undefined } : student)),
    parents: data.parents.map((parent) => (parent.id === result.parentId ? { ...parent, studentIds: result.parentStudentIds } : parent)),
    users: data.users.map((user) => (user.role === "parent" && user.parentId === result.parentId ? { ...user, studentIds: result.parentStudentIds } : user)),
  };
}
