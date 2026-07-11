import type { FeeType, Payment, Student } from "../types";
import { getPaymentsForStudentFee, sumPayments } from "./dataIndexes";
import type { SchoolYearDataIndexes } from "./dataIndexes";
import { getApplicableFeeTypes } from "./stats";

export type StudentFeeSummary = {
  feeTypeId: string;
  feeName: string;
  expected: number;
  paid: number;
  remaining: number;
};

export function getStudentFeeSummaries(student: Student, feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes): StudentFeeSummary[] {
  const applicableFeeTypes = indexes?.applicableFeeTypesByStudentId.get(student.id) ?? getApplicableFeeTypes(student, feeTypes);
  return applicableFeeTypes.map((fee) => {
    const feePayments = indexes ? getPaymentsForStudentFee(indexes, student.id, fee.id) : payments.filter((payment) => payment.studentId === student.id && payment.feeTypeId === fee.id);
    const paid = sumPayments(feePayments);

    return {
      feeTypeId: fee.id,
      feeName: String(fee.name),
      expected: fee.amount,
      paid,
      remaining: Math.max(fee.amount - paid, 0),
    };
  });
}
