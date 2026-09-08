import type { AppData, ParentProfile } from "../types";

export const PARENT_UNLINK_CONFIRMATION = "DÉLIER LE PARENT";
export const PARENT_LINK_CONFIRMATION = "LIER À CE PARENT";
export const PARENT_STUDENT_UNLINK_CONFIRMATION = "DÉLIER À CET ÉLÈVE";

export function isExactParentUnlinkConfirmation(value: string) {
  return value === PARENT_UNLINK_CONFIRMATION;
}

export function isExactParentLinkConfirmation(value: string) {
  return value === PARENT_LINK_CONFIRMATION;
}

export function isExactParentStudentUnlinkConfirmation(value: string) {
  return value === PARENT_STUDENT_UNLINK_CONFIRMATION;
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

export function applyParentLinkResult(data: Pick<AppData, "students" | "parents" | "users">, result: {
  studentId: string;
  parentId: string;
  parentStudentIds: string[];
  parentUserStudentIds?: string[];
  previousParentId?: string;
  previousParentStudentIds?: string[];
}) {
  return {
    students: data.students.map((student) => (student.id === result.studentId ? { ...student, parentId: result.parentId } : student)),
    parents: data.parents.map((parent) => {
      if (parent.id === result.parentId) return { ...parent, studentIds: result.parentStudentIds };
      if (result.previousParentId && parent.id === result.previousParentId && result.previousParentStudentIds) {
        return { ...parent, studentIds: result.previousParentStudentIds };
      }
      return parent;
    }),
    users: data.users.map((user) => {
      if (user.role !== "parent" || !user.parentId) return user;
      if (user.parentId === result.parentId && result.parentUserStudentIds) return { ...user, studentIds: result.parentUserStudentIds };
      if (result.previousParentId && user.parentId === result.previousParentId && result.previousParentStudentIds) return { ...user, studentIds: result.previousParentStudentIds };
      return user;
    }),
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
