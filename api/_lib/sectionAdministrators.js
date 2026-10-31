/** Deliberately not mapped to school_admin: unrestricted legacy privileges must never leak. */
export const SECTION_ADMINISTRATORS = Object.freeze({
  kindergarten_admin: "Directrice Maternelle",
  primary_admin: "Admin. Primaire",
  studies_prefect: "Préfet d'études",
});
export const SECTION_ADMIN_CONFIRMATIONS = Object.freeze({
  activate: "ACTIVER CET UTILISATEUR",
  deactivate: "DÉSACTIVER CET UTILISATEUR",
  delete: "SUPPRIMER CET UTILISATEUR",
});
const sections = new Set(["Maternelle", "Primaire", "CTEB", "Secondaire"]);
export function isSectionAdministrator(role) {
  return Object.hasOwn(SECTION_ADMINISTRATORS, role ?? "");
}
function denied(message) {
  return Object.assign(new Error(message), { statusCode: 403, code: "permission-denied" });
}
/** Read the authoritative profile, never scopes supplied by a request body or stale claims. */
export function sectionAdministratorScope(profile) {
  if (!isSectionAdministrator(profile?.role) || profile.status !== "active" || profile.active === false
      || typeof profile.schoolId !== "string" || !profile.schoolId.trim()
      || !Array.isArray(profile.sectionIds) || !profile.sectionIds.length
      || profile.sectionIds.some(section => !sections.has(section))) {
    throw denied("Périmètre administratif invalide.");
  }
  return Object.freeze({ schoolId: profile.schoolId, sectionIds: Object.freeze([...new Set(profile.sectionIds)]) });
}
/** Unknown/missing section fails closed, including aggregate and historical records. */
export function requireSectionAdministratorResource(profile, resource) {
  const scope = sectionAdministratorScope(profile);
  if (!resource || resource.schoolId !== scope.schoolId || !scope.sectionIds.includes(resource.section)) {
    throw denied("Donnée extérieure au périmètre administratif.");
  }
  return resource;
}
export function requireSectionAdministratorMutation(profile, before, after) {
  requireSectionAdministratorResource(profile, before);
  requireSectionAdministratorResource(profile, after);
}
export function requireSectionAdministratorConfirmation(action, confirmation) {
  if (!Object.hasOwn(SECTION_ADMIN_CONFIRMATIONS, action) || confirmation !== SECTION_ADMIN_CONFIRMATIONS[action]) {
    throw Object.assign(new Error("Confirmation exacte requise."), { statusCode: 400, code: "invalid-argument" });
  }
}
/** Keep access closed until every API, rules and UI integration has been validated. */
export function rejectUnreleasedSectionAdministrator(role) {
  if (isSectionAdministrator(role)) throw denied("Profil administratif en cours de sécurisation. Connexion indisponible.");
}
