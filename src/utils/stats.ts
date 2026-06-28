import type { FeeType, ParentProfile, Payment, Student } from "../types";

function getApplicableFees(student: Student | undefined, feeTypes: FeeType[]) {
  return feeTypes.filter((fee) => !fee.className || !student || fee.className === student.className);
}

export function getStudentBalance(studentId: string, feeTypes: FeeType[], payments: Payment[], students: Student[] = []) {
  const student = students.find((item) => item.id === studentId);
  const expected = getApplicableFees(student, feeTypes).reduce((sum, fee) => sum + fee.amount, 0);
  const paid = payments
    .filter((payment) => payment.studentId === studentId)
    .reduce((sum, payment) => sum + payment.amount, 0);

  return { expected, paid, remaining: Math.max(expected - paid, 0) };
}

export function buildStats(students: Student[], parents: ParentProfile[], feeTypes: FeeType[], payments: Payment[]) {
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const expected = students.reduce((sum, student) => sum + getApplicableFees(student, feeTypes).reduce((feeSum, fee) => feeSum + fee.amount, 0), 0);

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
