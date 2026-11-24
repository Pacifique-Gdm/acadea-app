// Changement de classe d'un élève qui a déjà payé cette année (lot E du caissier).
// Décision de l'établissement : SEUL le caissier le fait, par l'action serveur « change-student-class »,
// qui rattache les paiements aux frais de la nouvelle classe. Les autres rôles sont refusés.
// Partagé par l'écran (fiche élève) et le serveur.

export const CLASS_CHANGE_WITH_PAYMENTS_MESSAGE = "Cet élève a déjà des paiements cette année : seul le caissier peut changer sa classe, car ses paiements doivent être rattachés à la nouvelle classe.";
export const CLASS_CHANGE_CASHIER_ONLY_MESSAGE = "Seul le caissier peut changer la classe d'un élève qui a déjà payé.";
export const CLASS_CHANGE_SOCIAL_CASE_MESSAGE = "Cet élève a une réduction ou une prise en charge. L'administrateur doit d'abord la revoir dans « Cas sociaux et prises en charge » avant le changement de classe.";

const text = (value) => (typeof value === "string" ? value.trim() : "");

/** Vrai si la classe change : classe structurée, libellé, ou option (les frais peuvent dépendre de l'option). */
export function isClassChange(previous, next) {
  if (!previous || !next) return false;
  return ["classId", "className", "option", "classOptionKey"].some((key) => text(previous[key]) !== text(next[key]));
}

/** Vrai si au moins un paiement de cet élève existe pour cette école et cette année. */
export function hasYearPayments(payments, studentId, schoolId, schoolYearId) {
  return (payments || []).some((payment) => payment && payment.studentId === studentId
    && payment.schoolId === schoolId && (payment.schoolYearId || payment.annee_scolaire_id) === schoolYearId);
}
