import type { FeeType, Payment, Student } from "../types";
import { getApplicableFeeTypes, getStudentBalance } from "./stats";

export type StudentFeeSummary = {
  feeTypeId: string;
  feeName: string;
  expected: number;
  paid: number;
  remaining: number;
};

export function getStudentFeeSummaries(student: Student, feeTypes: FeeType[], payments: Payment[]): StudentFeeSummary[] {
  return getApplicableFeeTypes(student, feeTypes).map((fee) => {
    const feePayments = payments.filter((payment) => payment.studentId === student.id && payment.feeTypeId === fee.id);
    const balance = getStudentBalance(student.id, [fee], feePayments, [student]);

    return {
      feeTypeId: fee.id,
      feeName: String(fee.name),
      expected: fee.amount,
      paid: balance.paid,
      remaining: Math.max(fee.amount - balance.paid, 0),
    };
  });
}
