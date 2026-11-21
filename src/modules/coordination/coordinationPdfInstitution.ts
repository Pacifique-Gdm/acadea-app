import type { Coordination, School } from "../../types";
import { COORDINATION_PDF_ID_PREFIX } from "../../services/coordinationLogo";

/** Builds the institutional PDF identity from the Coordination, never from a supervised school. */
export function coordinationPdfInstitution(coordination: Coordination, contextSchool?: School): School {
  return {
    id: `${COORDINATION_PDF_ID_PREFIX}${coordination.id}`,
    name: coordination.name,
    acronym: coordination.code,
    address: coordination.address ?? "",
    phone: coordination.phone ?? "",
    email: coordination.email ?? "",
    // Logo complet lu à part (coordinationLogos) au moment du PDF ; ancien champ gardé tant qu'il existe.
    logoUrl: coordination.logoUrl,
    logoVersion: coordination.logoVersion,
    activeSchoolYearId: coordination.referenceSchoolYear ?? contextSchool?.activeSchoolYearId ?? "",
    status: "active",
    subscriptionPlan: "Standard",
    subscriptionStatus: "active",
    subscriptionAmount: 0,
  };
}
