import type { FeeType, ParentProfile, Payment, Student } from "../types";

export function getStudentBalance(studentId: string, feeTypes: FeeType[], payments: Payment[]) {
  const expected = feeTypes.reduce((sum, fee) => sum + fee.amount, 0);
  const paid = payments
    .filter((payment) => payment.studentId === studentId)
    .reduce((sum, payment) => sum + payment.amount, 0);

  return { expected, paid, remaining: Math.max(expected - paid, 0) };
}

export function buildStats(students: Student[], parents: ParentProfile[], feeTypes: FeeType[], payments: Payment[]) {
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const expected = students.length * feeTypes.reduce((sum, fee) => sum + fee.amount, 0);

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
