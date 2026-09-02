import type { AppData, ParentProfile } from "../types";

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

/** Keeps stable membership ordering when the selected parent did not change. */
export function reconcileStudentParentMembership(parents: ParentProfile[], studentId: string, parentId?: string) {
  return parents.map((parent) => {
    const alreadyLinked = parent.studentIds.includes(studentId);
    if (parent.id === parentId) {
      return alreadyLinked ? parent : { ...parent, studentIds: [...parent.studentIds, studentId] };
    }
    return alreadyLinked ? { ...parent, studentIds: parent.studentIds.filter((id) => id !== studentId) } : parent;
  });
}
