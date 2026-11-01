import type { AppUser, Payment, Student } from "../types";
import { isSectionAdministratorRole, sectionAdministratorQuerySections } from "./sectionAdministratorYearScope";

/** Last-mile guard for client-generated PDFs. Server reads and rules still enforce authorization. */
export function assertSectionStudentPdfScope(
  user: AppUser, schoolId: string, schoolYearId: string, students: readonly Student[],
): void {
  if (!isSectionAdministratorRole(user.role)) return;
  const sections = new Set(sectionAdministratorQuerySections(user, schoolId));
  if (students.some((student) => student.schoolId !== schoolId || student.schoolYearId !== schoolYearId
    || !student.section || !sections.has(student.section))) {
    throw new Error("L'export contient un élève hors des sections autorisées.");
  }
}

export function assertSectionPaymentReceiptScope(
  user: AppUser, schoolId: string, schoolYearId: string, student: Student, payment: Payment,
): void {
  if (!isSectionAdministratorRole(user.role)) return;
  assertSectionStudentPdfScope(user, schoolId, schoolYearId, [student]);
  if (payment.schoolId !== schoolId
    || (payment.schoolYearId !== schoolYearId && payment.collectionSchoolYearId !== schoolYearId)
    || payment.studentId !== student.id) {
    throw new Error("Le reçu ne correspond pas à cet élève ou à cette année scolaire.");
  }
}
