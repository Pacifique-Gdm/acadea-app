import { supportBalance } from "../../api/_lib/socialSupportMath.js";
import type { FeeType, Payment, Student } from "../types";
import { getPaymentsForStudentFee, sumPayments } from "./dataIndexes";
import type { SchoolYearDataIndexes } from "./dataIndexes";
import { sumMoney } from "./money";
import { getApplicableFeeTypes } from "./stats";


export type StudentFeeSummary = {
  feeTypeId: string;
  feeName: string;
  expected: number;
  paid: number;
  remaining: number;
  /** Trop-perçu sur ce frais : payé au-delà du montant net dû. */
  overpaid: number;
};

export function getStudentFeeSummaries(student: Student, feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes): StudentFeeSummary[] {
  const applicableFeeTypes = indexes?.applicableFeeTypesByStudentId.get(student.id) ?? getApplicableFeeTypes(student, feeTypes);
  return applicableFeeTypes.map((fee) => {
    const feePayments = indexes ? getPaymentsForStudentFee(indexes, student.id, fee.id) : payments.filter((payment) => payment.studentId === student.id && payment.feeTypeId === fee.id);
    const paid = sumPayments(feePayments);

    const balance = supportBalance(student, fee, payments);
    return {
      feeTypeId: fee.id,
      feeName: String(fee.name),
      expected: balance.net,
      paid,
      remaining: balance.remaining,
      overpaid: balance.credit,
    };
  });
}

/**
 * Paiements de l'année rattachés à un frais de l'école qui ne concerne plus l'élève
 * (par exemple après un ancien changement de classe). Ils ne sont comptés dans aucun frais
 * actuel : c'est de l'argent reçu en trop pour la classe actuelle.
 */
export function getStudentDetachedPaid(student: Student, feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes): number {
  const applicableIds = new Set((indexes?.applicableFeeTypesByStudentId.get(student.id) ?? getApplicableFeeTypes(student, feeTypes)).map((fee) => fee.id));
  const yearFeeIds = new Set(feeTypes.filter((fee) => !fee.schoolYearId || !student.schoolYearId || fee.schoolYearId === student.schoolYearId).map((fee) => fee.id));
  const studentPayments = indexes?.paymentsByStudentId.get(student.id) ?? payments.filter((payment) => payment.studentId === student.id);
  return sumMoney(studentPayments
    .filter((payment) => payment.studentId === student.id && !payment.formerStudent
      && (!student.schoolYearId || payment.schoolYearId === student.schoolYearId)
      && yearFeeIds.has(payment.feeTypeId) && !applicableIds.has(payment.feeTypeId))
    .map((payment) => payment.amount));
}

/** Trop-perçu total de l'élève : surplus sur ses frais actuels + paiements sur des frais qui ne le concernent plus. */
export function getStudentOverpaid(student: Student, feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes): number {
  const summaries = getStudentFeeSummaries(student, feeTypes, payments, indexes);
  return sumMoney([...summaries.map((summary) => summary.overpaid), getStudentDetachedPaid(student, feeTypes, payments, indexes)]);
}
