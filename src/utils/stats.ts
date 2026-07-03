import type { FeeType, ParentProfile, Payment, Student } from "../types";

const feeTargetSeparator = "::option::";

function studentFeeTargetKey(student: Student) {
  const option = student.option?.trim();
  return option && student.className.includes("Humanité") ? `${student.className}${feeTargetSeparator}${option}` : student.className;
}

function feeAppliesToStudent(fee: FeeType, student: Student | undefined) {
  if (!student) return true;
  if (fee.classOptionKey) return fee.classOptionKey === studentFeeTargetKey(student);
  return !fee.className || fee.className === student.className;
}

function getApplicableFees(student: Student | undefined, feeTypes: FeeType[]) {
  return feeTypes.filter((fee) => feeAppliesToStudent(fee, student));
}

function getExpectedFromPaidFees(student: Student | undefined, feeTypes: FeeType[], payments: Payment[]) {
  const paidFeeIds = new Set(payments.map((payment) => payment.feeTypeId));
  return getApplicableFees(student, feeTypes)
    .filter((fee) => paidFeeIds.has(fee.id))
    .reduce((sum, fee) => sum + fee.amount, 0);
}

export function getStudentBalance(studentId: string, feeTypes: FeeType[], payments: Payment[], students: Student[] = []) {
  const student = students.find((item) => item.id === studentId);
  const studentPayments = payments.filter((payment) => payment.studentId === studentId);
  const expected = getExpectedFromPaidFees(student, feeTypes, studentPayments);
  const paid = studentPayments.reduce((sum, payment) => sum + payment.amount, 0);

  return { expected, paid, remaining: Math.max(expected - paid, 0) };
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
  const paid = scopedPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const expected = students.reduce((sum, student) => sum + getExpectedFromPaidFees(student, feeTypes, paymentsByStudent.get(student.id) ?? []), 0);

  return {
    students: students.length,
    parents: parents.length,
    boys: students.filter((student) => student.sexe === "M").length,
    girls: students.filter((student) => student.sexe === "F").length,
    paid,
    expected,
    remaining: Math.max(expected - paid, 0),
    classes: new Set(students.map((student) => student.className)).size,
  };
}
