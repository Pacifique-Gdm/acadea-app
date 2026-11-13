import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import type { FeeAllocationConfig, FeeAllocationRubric, FeeAllocationVersion } from "../types/feeAllocation";

export type AllocationFee = { id: string; name: string; className: string; classOptionKey: string | null; amount: number };
export type AllocationWorkspace = {
  school: { id: string; name: string; activeSchoolYearId: string };
  year: { id: string; schoolId: string; name: string; status: string; startsAt: string | null; endsAt: string | null };
  currency: "USD" | "CDF"; canConfigure: boolean; operational: false;
  fees: AllocationFee[]; configs: FeeAllocationConfig[];
};
export type SaveAllocationDrafts = { schoolYearId: string; baseFeeTypeId: string; requestId: string;
  targets: Array<{ feeTypeId: string; expectedRevision: number }>; rubrics: FeeAllocationRubric[] };
export class AllocationApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); }
  get confirmedRejection() { return [400, 401, 403, 404, 409, 429].includes(this.status ?? 0); }
}
export async function allocationRequest<T>(action: string, body: object, signal?: AbortSignal): Promise<T> {
  const token = await getCurrentFirebaseIdToken();
  let response: Response;
  try {
    response = await fetch(resolveApiUrl("/api/manage-financial-transaction"), { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, action: `fee-allocation.${action}` }), signal: signal ?? AbortSignal.timeout(30_000) });
  } catch { throw new AllocationApiError("Réponse serveur non confirmée. Conservez la même demande pour la vérifier."); }
  const payload = await response.json().catch(() => null) as (T & { error?: string; code?: string; operational?: boolean }) | null;
  if (!response.ok) throw new AllocationApiError(payload?.error ?? `Répartition indisponible (HTTP ${response.status}).`, response.status, payload?.code);
  if (!payload || payload.operational !== false) throw new AllocationApiError("Réponse préparatoire invalide ; aucune activation n'est permise.");
  return payload;
}
export async function loadAllocationWorkspace(schoolId: string, signal?: AbortSignal) {
  const result = await allocationRequest<AllocationWorkspace>("get-workspace", { schoolId }, signal);
  if (result.school?.id !== schoolId || !result.year?.id || !["USD", "CDF"].includes(result.currency)
    || !Array.isArray(result.fees) || !Array.isArray(result.configs)) throw new AllocationApiError("Contexte de répartition incomplet.");
  return result;
}
export async function saveAllocationDrafts(request: SaveAllocationDrafts) {
  const result = await allocationRequest<{ configs: FeeAllocationConfig[]; operational: false }>("save-drafts", request);
  if (!Array.isArray(result.configs) || result.configs.length !== request.targets.length
    || request.targets.some((target) => !result.configs.some((config) => config.feeTypeId === target.feeTypeId
      && config.schoolYearId === request.schoolYearId && config.draftRevision === target.expectedRevision + 1))) {
    throw new AllocationApiError("Confirmation incomplète. Vérifiez la même demande avant de recommencer.");
  }
  return result;
}
export async function loadAllocationVersions(config: FeeAllocationConfig) {
  const result = await allocationRequest<{ versions: FeeAllocationVersion[] }>("list-versions", {
    schoolId: config.schoolId, schoolYearId: config.schoolYearId, feeTypeId: config.feeTypeId,
  });
  if (!Array.isArray(result.versions)) throw new AllocationApiError("Versions non confirmées.");
  return result.versions.sort((a, b) => b.version - a.version);
}
