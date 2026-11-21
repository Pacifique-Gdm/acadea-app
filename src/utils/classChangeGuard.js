// Protection provisoire (22/11) : tant que le rattachement des paiements et le remboursement du trop-perçu
// ne sont pas en ligne (lots D, E, F du caissier), un élève qui a déjà payé cette année ne change pas de classe.
// Partagé par l'écran (fiche élève) et le serveur (enregistrement de la fiche).

export const CLASS_CHANGE_WITH_PAYMENTS_MESSAGE = "Cet élève a déjà des paiements cette année : le changement de classe sera possible bientôt, avec le remboursement automatique du trop-perçu. Contactez l'administrateur si c'est urgent.";

/** Vrai si la classe change (classe structurée ou libellé). Option et sous-classe seules ne comptent pas. */
export function isClassChange(previous, next) {
  if (!previous || !next) return false;
  return (previous.classId || "") !== (next.classId || "") || (previous.className || "") !== (next.className || "");
}

/** Vrai si au moins un paiement de cet élève existe pour cette école et cette année. */
export function hasYearPayments(payments, studentId, schoolId, schoolYearId) {
  return (payments || []).some((payment) => payment && payment.studentId === studentId
    && payment.schoolId === schoolId && (payment.schoolYearId || payment.annee_scolaire_id) === schoolYearId);
}
