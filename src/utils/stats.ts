import type { FeeType, ParentProfile, Payment, Student } from "../types";
import { remainingMoney, sumMoney } from "./money";

const feeTargetSeparator = "::option::";

function studentFeeTargetKey(student: Student) {
  const option = student.option?.trim();
  return option && student.className.includes("Humanité") ? `${student.className}${feeTargetSeparator}${option}` : student.className;
}

export function feeAppliesToStudent(fee: FeeType, student: Student | undefined) {
  if (!student) return true;
  if (fee.classOptionKey) return fee.classOptionKey === studentFeeTargetKey(student);
  return !fee.className || fee.className === student.className;
}

export function getApplicableFeeTypes(student: Student | undefined, feeTypes: FeeType[]) {
  return feeTypes.filter((fee) => feeAppliesToStudent(fee, student));
}

function getExpectedFromPaidFees(student: Student | undefined, feeTypes: FeeType[], payments: Payment[]) {
  const paidFeeIds = new Set(payments.map((payment) => payment.feeTypeId));
  return getApplicableFeeTypes(student, feeTypes)
    .filter((fee) => paidFeeIds.has(fee.id))
    .reduce((sum, fee) => sumMoney([sum, fee.amount]), 0);
}

export function getStudentBalance(studentId: string, feeTypes: FeeType[], payments: Payment[], students: Student[] = []) {
  const student = students.find((item) => item.id === studentId);
  const studentPayments = payments.filter((payment) => payment.studentId === studentId);
  const expected = getExpectedFromPaidFees(student, feeTypes, studentPayments);
  const paid = sumMoney(studentPayments.map((payment) => payment.amount));

  return { expected, paid, remaining: remainingMoney(expected, paid) };
}

export function buildStats(students: Student[], parents: ParentProfile[], feeTypes: FeeType[], payments: Payment[]) {
  const studentIds = new Set(students.map((student) => student.id));
  const scopedPayments = payments.filter((payment) => studentIds.has(payment.studentId));
  const paymentsByStudent = scopedPayments.reduce<Map<string, Payment[]>>((items, payment) => {
    const studentPayments = items.get(payment.studentId) ?? [];
    studentPayments.push(payment);
    items.set(payment.studentId, studentPayments);
    return items;
  }, new Map());
  const paid = sumMoney(scopedPayments.map((payment) => payment.amount));
  const expected = sumMoney(students.map((student) => getExpectedFromPaidFees(student, feeTypes, paymentsByStudent.get(student.id) ?? [])));

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
