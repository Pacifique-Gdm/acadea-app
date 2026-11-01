import type { AppUser } from "../types";
import type { DashboardFinancialAggregates } from "../utils/dashboardStats";
import { sectionAdministratorQuerySections } from "../utils/sectionAdministratorYearScope";
import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
export type SectionDashboard = DashboardFinancialAggregates & {
  schoolId: string; schoolYearId: string; sections: string[]; currency: "CDF" | "USD";
  students: number; parents: number;
  personnel: { school_admin: number; cashier: number; discipline_director: number };
};
export async function loadSectionDashboard(user: AppUser, schoolId: string, schoolYearId: string,
  filters: { section?: string; startDate?: string; endDate?: string }, signal?: AbortSignal): Promise<SectionDashboard> {
  const allowed = sectionAdministratorQuerySections(user, schoolId);
  if (filters.section && !allowed.includes(filters.section)) throw new Error("Section interdite.");
  const token = await getCurrentFirebaseIdToken();
  if (!token) throw new Error("Authentification requise.");
  const response = await fetch(resolveApiUrl("/api/provision-school-account"), { method: "POST", signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "load-section-dashboard", schoolYearId, ...filters }) });
  if (!response.ok) throw new Error("Synthèse scolaire indisponible. Veuillez réessayer.");
  const result = await response.json() as SectionDashboard;
  const expected = filters.section ? [filters.section] : allowed;
  if (result.schoolId !== schoolId || result.schoolYearId !== schoolYearId
    || !Array.isArray(result.sections) || result.sections.length !== expected.length || result.sections.some((section) => !expected.includes(section))
    || !["CDF", "USD"].includes(result.currency) || !result.financialStats || !Array.isArray(result.feeProgressRows)
    || !result.personnel || [result.students, result.parents, ...Object.values(result.personnel)].some((count) => !Number.isSafeInteger(count) || count < 0)
    || Object.values(result.financialStats).some((amount) => !Number.isFinite(amount))) throw new Error("Synthèse hors périmètre ou invalide.");
  return result;
}
