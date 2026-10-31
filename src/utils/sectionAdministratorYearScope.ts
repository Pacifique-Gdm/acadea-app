import type { AppData, AppUser } from "../types";

export function isSectionAdministratorRole(role: AppUser["role"]): boolean {
  return role === "kindergarten_admin" || role === "primary_admin" || role === "studies_prefect";
}

/** Defense in depth only. Firestore queries and API handlers must enforce the same scope before these roles are released. */
export function sectionAdministratorYearScope(data: AppData, user: AppUser, schoolId: string, schoolYearId: string) {
  const known = new Set(["Maternelle", "Primaire", "CTEB", "Secondaire"]);
  const sections = new Set(user.sectionIds ?? []);
  const valid = isSectionAdministratorRole(user.role)
    && user.schoolId === schoolId
    && user.status === "active"
    && user.active !== false
    && sections.size > 0
    && [...sections].every((section) => known.has(section));
  const students = valid ? data.students.filter((student) =>
    student.schoolId === schoolId && student.schoolYearId === schoolYearId
    && Boolean(student.section && sections.has(student.section))) : [];
  const studentIds = new Set(students.map((student) => student.id));
  const parents = valid ? data.parents.filter((parent) =>
    parent.schoolId === schoolId && parent.schoolYearId === schoolYearId
    && parent.studentIds.length > 0 && parent.studentIds.every((id) => studentIds.has(id))) : [];
  return {
    students,
    parents,
    users: valid ? data.users.filter((item) => item.id === user.id && item.schoolId === schoolId) : [],
    // Fee types, expenses, inflows, messages and audit logs have no authoritative
    // section attribution. Do not infer permission from an untrusted label.
    feeTypes: [],
    payments: valid ? data.payments.filter((payment) =>
      payment.schoolId === schoolId && payment.schoolYearId === schoolYearId
      && studentIds.has(payment.studentId)) : [],
    expenses: [],
    cashInflows: [],
    auditLogs: [],
    valves: valid ? data.valves.filter((item) => item.schoolId === schoolId
      && item.schoolYearId === schoolYearId && sections.has(item.visibility)) : [],
    disciplineSanctions: valid ? data.disciplineSanctions.filter((item) => item.schoolId === schoolId
      && item.schoolYearId === schoolYearId && studentIds.has(item.studentId)) : [],
    attendance: valid ? data.attendance.filter((item) => item.schoolId === schoolId
      && item.schoolYearId === schoolYearId && studentIds.has(item.studentId)) : [],
    attendanceSettings: [],
    messages: [],
    notifications: valid ? data.notifications.filter((item) => item.schoolId === schoolId
      && item.schoolYearId === schoolYearId && Boolean(item.studentId && studentIds.has(item.studentId))
      && !item.messageId) : [],
  };
}
