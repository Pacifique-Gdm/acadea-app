import { supportBalance } from "../../api/_lib/socialSupportMath.js";
import type { FeeType, ParentProfile, Payment, Student } from "../types";
import { remainingMoney, sumMoney } from "./money";

const feeTargetSeparator = "::option::";

function studentFeeTargetKey(student: Student) {
  const option = student.option?.trim();
  return option && student.className.includes("Humanité") ? `${student.className}${feeTargetSeparator}${option}` : student.className;
}

export function feeAppliesToStudent(fee: FeeType, student: Student | undefined) {
  if (!student) return true;
  if (fee.schoolId && student.schoolId && fee.schoolId !== student.schoolId) return false;
  if (fee.schoolYearId && student.schoolYearId && fee.schoolYearId !== student.schoolYearId) return false;
  if (fee.classOptionKey) return fee.classOptionKey === studentFeeTargetKey(student);
  return !fee.className || fee.className === student.className;
}

export function getApplicableFeeTypes(student: Student | undefined, feeTypes: FeeType[]) {
  return feeTypes.filter((fee) => feeAppliesToStudent(fee, student));
}

function getExpectedFromApplicableFees(student: Student | undefined, feeTypes: FeeType[]) {
  return getApplicableFeeTypes(student, feeTypes)
    .reduce((sum, fee) => sumMoney([sum, student ? supportBalance(student, fee).net : fee.amount]), 0);
}

export function getStudentBalance(studentId: string, feeTypes: FeeType[], payments: Payment[], students: Student[] = []) {
  const student = students.find((item) => item.id === studentId);
  const studentPayments = payments.filter((payment) => payment.studentId === studentId);
  const expected = getExpectedFromApplicableFees(student, feeTypes);
  const paid = sumMoney(studentPayments.map((payment) => payment.amount));

  return { expected, paid, remaining: remainingMoney(expected, paid) };
}

export function buildStats(students: Student[], parents: ParentProfile[], feeTypes: FeeType[], payments: Payment[]) {
  const studentIds = new Set(students.map((student) => student.id));
  const scopedPayments = payments.filter((payment) => studentIds.has(payment.studentId));
  const paid = sumMoney(scopedPayments.map((payment) => payment.amount));
  const expected = sumMoney(students.map((student) => getExpectedFromApplicableFees(student, feeTypes)));

  return {
    students: students.length,
    parents: parents.length,
    boys: students.filter((student) => student.sexe === "M").length,
    girls: students.filter((student) => student.sexe === "F").length,
    paid,
    expected,
    remaining: remainingMoney(expected, paid),
    classes: new Set(students.map((student) => student.className)).size,
  };
}
