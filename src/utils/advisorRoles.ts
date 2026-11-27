// Lots 10 et 11 : rôles des conseillers (Conseiller pédagogique, Conseiller d'orientation).
// Aucun accès à l'argent ; les données passent par le serveur (api/_lib/advisors.js).
import type { Role } from "../types";

export const ADVISOR_ROLE_LABELS = {
  pedagogical_advisor: "Conseiller pédagogique",
} as const;

export type AdvisorRole = keyof typeof ADVISOR_ROLE_LABELS;
export const ADVISOR_ROLES = Object.keys(ADVISOR_ROLE_LABELS) as AdvisorRole[];
export const ADVISOR_ROUTE = "/conseil";

export function isAdvisorRole(role: Role | string | undefined): role is AdvisorRole {
  return typeof role === "string" && Object.hasOwn(ADVISOR_ROLE_LABELS, role);
}
