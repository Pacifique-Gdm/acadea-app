export const STAGING_PROJECT = "acadea-staging";
export const PRODUCTION_PROJECT = "acadea-production";
export const STAGING_CONFIRMATION = "RECONCILE SCHOOL OPTIONS";
export const PRODUCTION_CONFIRMATION = "RECONCILE SCHOOL OPTIONS PRODUCTION";

export function validateReconciliationPolicy({ project, schoolId, apply, confirmation }: { project: string; schoolId?: string; apply: boolean; confirmation?: string }) {
  if (project !== STAGING_PROJECT && project !== PRODUCTION_PROJECT) throw new Error("Projet Firebase non autorisé.");
  if (apply && !schoolId) throw new Error("--school-id est obligatoire en mode apply.");
  const expectedConfirmation = project === PRODUCTION_PROJECT ? PRODUCTION_CONFIRMATION : STAGING_CONFIRMATION;
  if (apply && confirmation !== expectedConfirmation) throw new Error("Confirmation de réconciliation invalide.");
  return { project, schoolId, apply, expectedConfirmation };
}
