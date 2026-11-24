// Lot E : aperçu, dans la fiche du caissier, du rattachement des paiements quand la classe change.
// Même calcul que le serveur (classChangePlan.js) ; le serveur refait tout et reste seul juge.
import type { FeeType, Payment, Student } from "../types";
import { feeAppliesToStudent } from "./feeTargets";
import { fromMoneyMinor, toMoneyMinor } from "./money";
import { planClassChangePayments } from "./classChangePlan.js";

const money = (minor: number, currency: "USD" | "CDF") => {
  const value = fromMoneyMinor(minor).toFixed(2).replace(".", ",");
  return currency === "CDF" ? `${value} FC` : `${value} $`;
};

export function classChangePreview({ student, next, feeTypes, payments, schoolYearId, currency }: {
  student: Student; next: Pick<Student, "className" | "option">; feeTypes: FeeType[]; payments: Payment[]; schoolYearId: string; currency: "USD" | "CDF";
}) {
  const yearPayments = payments.filter((payment) => payment.studentId === student.id && payment.schoolId === student.schoolId
    && payment.schoolYearId === schoolYearId && (payment.collectionSchoolYearId ?? schoolYearId) === schoolYearId && !payment.formerStudent
    && !payment.refundedByClassChangeId);
  const yearFees = feeTypes.filter((fee) => fee.schoolId === student.schoolId && fee.schoolYearId === schoolYearId);
  const newFees = yearFees.filter((fee) => feeAppliesToStudent(fee, next) && Number(fee.amount) > 0)
    .map((fee) => ({ id: fee.id, name: fee.name ?? "", netMinor: toMoneyMinor(Number(fee.amount)) }));
  const plan = planClassChangePayments({
    payments: yearPayments.map((payment) => ({ id: payment.id, feeTypeId: payment.feeTypeId, amountMinor: toMoneyMinor(Number(payment.amount)), createdAt: payment.createdAt })),
    oldFees: yearFees.map((fee) => ({ id: fee.id, name: fee.name ?? "" })), newFees,
  });
  const paidMinor = yearPayments.reduce((sum, payment) => sum + toMoneyMinor(Number(payment.amount)), 0);
  const dueMinor = newFees.reduce((sum, fee) => sum + fee.netMinor, 0);
  const message = plan.overpaidMinor > 0
    ? `Ce changement de classe crée un trop-perçu de ${money(plan.overpaidMinor, currency)}. Il sera remboursé tout de suite au parent, en espèces, pris dans la caisse (rubrique « Non affecté » si la répartition est active).`
    : `Changement de classe : les paiements de l'année (${money(paidMinor, currency)}) seront rattachés aux frais de la nouvelle classe. Reste à payer ensuite : ${money(Math.max(0, dueMinor - paidMinor), currency)}.`;
  return { plan, overpaidMinor: plan.overpaidMinor, paidMinor, dueMinor, message };
}
