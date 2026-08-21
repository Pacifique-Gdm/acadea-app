import type { Coordination, School } from "../../types";

/** Builds the institutional PDF identity from the Coordination, never from a supervised school. */
export function coordinationPdfInstitution(coordination: Coordination, contextSchool?: School): School {
  return {
    id: `coordination:${coordination.id}`,
    name: coordination.name,
    acronym: coordination.code,
    address: coordination.address ?? "",
    phone: coordination.phone ?? "",
    email: coordination.email ?? "",
    logoUrl: coordination.logoUrl,
    activeSchoolYearId: coordination.referenceSchoolYear ?? contextSchool?.activeSchoolYearId ?? "",
    status: "active",
    subscriptionPlan: "Standard",
    subscriptionStatus: "active",
    subscriptionAmount: 0,
  };
}
