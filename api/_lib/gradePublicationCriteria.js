export const PUBLICATION_SLOTS = ["period_1", "period_2", "semester_1_exam", "period_3", "period_4", "semester_2_exam"];
const COMPARISONS = new Set(["gte", "lt"]);

export function validatePublicationCriteria(input) {
  if (!PUBLICATION_SLOTS.includes(input?.slot)) throw new Error("Période de publication invalide.");
  const percentage = input.percentage;
  if (percentage !== undefined && percentage !== null) {
    if (!COMPARISONS.has(percentage.operator) || typeof percentage.value !== "number" || !Number.isFinite(percentage.value)
      || percentage.value < 0 || percentage.value > 100) throw new Error("Critère de pourcentage invalide.");
  }
  const fee = input.fee;
  if (fee !== undefined && fee !== null) {
    if (typeof fee.feeTypeId !== "string" || !fee.feeTypeId.trim() || !COMPARISONS.has(fee.operator)
      || !Number.isSafeInteger(fee.amountMinor) || fee.amountMinor < 0) throw new Error("Critère de frais invalide.");
  }
  return { slot: input.slot, percentage: percentage ?? null, fee: fee ?? null };
}

/** No implicit conversion: any known payment in another or unknown currency blocks publication. */
export function validatedFeePaidMinor(payments, { schoolId, schoolYearId, studentId, feeTypeId, currency }) {
  let total = 0;
  for (const payment of payments) {
    if (payment.schoolId !== schoolId || payment.schoolYearId !== schoolYearId || payment.studentId !== studentId || payment.feeTypeId !== feeTypeId) continue;
    if (payment.collectionSchoolYearId && payment.collectionSchoolYearId !== schoolYearId) continue;
    if (["cancelled", "canceled", "refunded", "void"].includes(payment.status)) continue;
    if (payment.status && !["validated", "completed", "paid"].includes(payment.status)) throw new Error("Statut de paiement non reconnu : publication suspendue.");
    if (payment.currency !== currency) throw new Error("Devise de paiement inconnue ou différente : publication suspendue.");
    const minor = Math.round(payment.amount * 100);
    if (typeof payment.amount !== "number" || !Number.isFinite(payment.amount) || !Number.isSafeInteger(minor) || minor < 0 || Math.abs(payment.amount * 100 - minor) > 1e-7) {
      throw new Error("Montant de paiement invalide : publication suspendue.");
    }
    total += minor;
    if (!Number.isSafeInteger(total)) throw new Error("Montant cumulé trop élevé : publication suspendue.");
  }
  return total;
}

export function qualifiesForPublication(evaluation, criteria, paidMinor = null) {
  if (!evaluation?.complete || typeof evaluation.percentage !== "number" || !Number.isFinite(evaluation.percentage)) return false;
  if (criteria.percentage) {
    const { operator, value } = criteria.percentage;
    if (operator === "gte" ? evaluation.percentage < value : evaluation.percentage >= value) return false;
  }
  if (criteria.fee) {
    if (paidMinor === null || !Number.isSafeInteger(paidMinor)) return false;
    const { operator, amountMinor } = criteria.fee;
    if (operator === "gte" ? paidMinor < amountMinor : paidMinor >= amountMinor) return false;
  }
  return true;
}

/** Identical option targeting to the existing financial transaction boundary. */
export function feeAppliesToPublishedStudent(fee, student) {
  if (typeof fee.classOptionKey === "string" && fee.classOptionKey) {
    const option = typeof student.option === "string" ? student.option.trim() : "";
    const target = option && String(student.className).includes("Humanité")
      ? `${student.className}::option::${option}` : student.className;
    return fee.classOptionKey === target;
  }
  return !fee.className || fee.className === student.className;
}
