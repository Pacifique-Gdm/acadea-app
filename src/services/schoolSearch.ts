import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import { apiErrorMessage } from "../utils/rateLimitErrors";
import type { School } from "../types";

/** Lot SA-2 : recherche des écoles faite par le serveur (liste de recherche, pages de 25). */
export type SchoolSearchSort = "az" | "recent" | "users";
export type SchoolSearchRequest = { query: string; status: "all" | School["status"]; schoolType: string; sort: SchoolSearchSort; page: number; fresh?: boolean };
export type SchoolSearchRow = { id: string; name: string; acronym: string; status: string; schoolType: string; createdAt: string; logoVersion: string; users: number | null };
export type SchoolSearchResult = { total: number; page: number; pageSize: number; schools: SchoolSearchRow[] };

/** La liste de recherche n'existe pas encore : l'écran garde alors l'ancienne recherche. */
export class SchoolSearchUnavailableError extends Error {}

const isText = (value: unknown): value is string => typeof value === "string";

export function parseSchoolSearchResult(value: unknown): SchoolSearchResult {
  const result = value as Partial<SchoolSearchResult> | null;
  if (!result || !Number.isInteger(result.total) || !Number.isInteger(result.page) || !Number.isInteger(result.pageSize) || !Array.isArray(result.schools)) {
    throw new Error("Réponse de recherche incomplète.");
  }
  const schools = result.schools.filter((row): row is SchoolSearchRow => Boolean(row) && isText(row.id) && isText(row.name));
  return { total: result.total!, page: result.page!, pageSize: result.pageSize!, schools };
}

export async function searchPlatformSchools(request: SchoolSearchRequest): Promise<SchoolSearchResult> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-school"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "search-schools", ...request }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (response.status === 409 && payload.code === "search-index-not-ready") throw new SchoolSearchUnavailableError(payload.error ?? "Liste de recherche pas encore prête.");
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Recherche des écoles indisponible."));
  return parseSchoolSearchResult(payload);
}

/** Carte d'école à partir d'une ligne de recherche (le drawer recharge ensuite l'école complète). */
export function schoolFromSearchRow(row: SchoolSearchRow): School {
  return {
    id: row.id, name: row.name, acronym: row.acronym || undefined, status: row.status as School["status"],
    schoolType: (row.schoolType || undefined) as School["schoolType"], createdAt: row.createdAt || undefined,
    logoVersion: row.logoVersion, address: "", phone: "", email: "",
    // Champs non utilisés par la carte de la liste ; le drawer recharge l’école complète.
    activeSchoolYearId: "", subscriptionPlan: "Standard", subscriptionAmount: 0,
  };
}
