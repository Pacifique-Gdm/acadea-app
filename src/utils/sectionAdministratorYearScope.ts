import type { AppData, AppUser } from "../types";

export function isSectionAdministratorRole(role: AppUser["role"]): boolean {
  return role === "kindergarten_admin" || role === "primary_admin" || role === "studies_prefect";
}

/** Client-side query guard; Firestore rules must independently re-read the active profile. */
export function sectionAdministratorQuerySections(user: AppUser, schoolId: string): string[] {
  const known = new Set(["Maternelle", "Primaire", "CTEB", "Secondaire"]);
  const sections = [...new Set(user.sectionIds ?? [])];
  if (!isSectionAdministratorRole(user.role) || user.schoolId !== schoolId || user.status !== "active"
    || user.active === false || !sections.length || !sections.every((section) => known.has(section))) {
    throw new Error("Périmètre administratif indisponible.");
  }
  return sections;
}

/** Defense in depth only. Firestore queries and API handlers must enforce the same scope before these roles are released. */
export function sectionAdministratorYearScope(data: AppData, user: AppUser, schoolId: string, schoolYearId: string) {
  const known = new Set(["Maternelle", "Primaire", "CTEB", "Secondaire"]);
  const sections = new Set<string>(user.sectionIds ?? []);
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
  const scopedStudents = new Map(valid ? data.students.filter((student) => student.schoolId === schoolId
    && Boolean(student.section && sections.has(student.section))).map((student) => [student.id, student]) : []);
  return {
    students,
    // Parent contacts are exposed only by the scoped messaging directory.
    // Never reuse an old general-school cache to populate a parent directory.
    parents: [],
    users: valid ? data.users.filter((item) => item.id === user.id && item.schoolId === schoolId) : [],
    // Fee definitions are school/year-wide reference data. They are needed to
    // collect a scoped student's fees, but never confer permission to mutate
    // the general ledger or another section's student.
    feeTypes: valid ? data.feeTypes.filter((fee) => fee.schoolId === schoolId
      && fee.schoolYearId === schoolYearId) : [],
    // Expenses, inflows, messages and audit logs have no authoritative
    // section attribution in the legacy client data model.
    payments: valid ? data.payments.filter((payment) =>
      payment.schoolId === schoolId
      && scopedStudents.get(payment.studentId)?.schoolYearId === payment.schoolYearId
      && (!payment.currentStudentId || scopedStudents.get(payment.currentStudentId)?.schoolYearId === payment.collectionSchoolYearId)
      && (payment.schoolYearId === schoolYearId && studentIds.has(payment.studentId)
        || payment.collectionSchoolYearId === schoolYearId && studentIds.has(payment.currentStudentId ?? ""))) : [],
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
