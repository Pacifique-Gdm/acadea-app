import type { School } from "../../types";

// Valeur du filtre « année active » des Cas sociaux : l'année active de CHAQUE école
// (une Coordination couvre plusieurs écoles, chacune avec sa propre année active).
export const SUPPORT_ACTIVE_YEAR = "active";

export function supportActiveYearOf(schools: readonly Pick<School, "id" | "activeSchoolYearId">[], schoolId: string) {
  return schools.find((school) => school.id === schoolId)?.activeSchoolYearId ?? "";
}

// "" = toutes les années ; SUPPORT_ACTIVE_YEAR = année active de l'école de la décision ; sinon une année précise.
export function supportDecisionMatchesYear(decision: { schoolId: string; schoolYearId: string }, filterYear: string, schools: readonly Pick<School, "id" | "activeSchoolYearId">[]) {
  if (!filterYear) return true;
  if (filterYear === SUPPORT_ACTIVE_YEAR) {
    const active = supportActiveYearOf(schools, decision.schoolId);
    return !!active && decision.schoolYearId === active;
  }
  return decision.schoolYearId === filterYear;
}
