import { resolveApiUrl } from "../config/apiUrl";
import { createLoadCache } from "../utils/loadCache";
import { getCurrentFirebaseIdToken } from "./auth";
import type { CoordinationYearGovernance } from "../types";

export const YEAR_CONFIRMATIONS = { close: "CLOTURER LES ANNEES SCOLAIRES", reactivate: "REACTIVER LES ANNEES SCOLAIRES" } as const;

export type CoordinationSchoolYearRow = { schoolId: string; schoolName: string; activeYear: { id: string; name: string; startsAt?: string; endsAt?: string } | null; readinessError?: string | null };
export type CoordinationSchoolYearResult = { schoolId: string; status: "closed" | "reactivated" | "opened"; reason?: string; schoolYearId?: string };
export type CoordinationSchoolYearStatus = { rows: CoordinationSchoolYearRow[]; referenceYear: string | null; governance: CoordinationYearGovernance | null };

async function call(input: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-coordination-school-years"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Gouvernance des années impossible.");
  return payload;
}
export async function loadCoordinationSchoolYearStatus() { return call({ action: "status" }) as Promise<CoordinationSchoolYearStatus>; }
export async function closeCoordinationSchoolYears(confirmation: string, requestId: string) { return call({ action: "close", confirmation, requestId }) as Promise<{ results: CoordinationSchoolYearResult[] }>; }
export async function reactivateCoordinationSchoolYears(confirmation: string, operationId: string, requestId: string) { return call({ action: "reactivate", confirmation, operationId, requestId }) as Promise<{ results: CoordinationSchoolYearResult[] }>; }
export async function openCoordinationSchoolYears(input: { name: string; startsAt: string; endsAt: string; requestId: string }) { return call({ action: "open", confirmed: true, ...input }) as Promise<{ results: CoordinationSchoolYearResult[] }>; }

/** Tiroir « Année scolaire » de la coordination : l'état des années est gardé pendant la
 * session. Rouvrir le tiroir l'affiche tout de suite, sans nouvel appel. Il est relu après
 * « Actualiser » (refreshToken change la clé) et après une ouverture, une clôture ou une
 * réactivation (le résultat remplace la valeur gardée). */
export const coordinationYearStatusCache = createLoadCache<CoordinationSchoolYearStatus>();
export const coordinationYearStatusKey = (input: { uid: string; coordinationId: string; subCoordinationId?: string; refreshToken: number }) =>
  `${input.uid}:${input.coordinationId}:${input.subCoordinationId ?? ""}:${input.refreshToken}`;
