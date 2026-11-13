import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import type { FeeAllocationConfig, FeeAllocationRubric, FeeAllocationVersion } from "../types/feeAllocation";

export type AllocationFee = { id: string; name: string; className: string; classOptionKey: string | null; amount: number };
export type AllocationWorkspace = {
  school: { id: string; name: string; activeSchoolYearId: string };
  year: { id: string; schoolId: string; name: string; status: string; startsAt: string | null; endsAt: string | null };
  currency: "USD" | "CDF"; canConfigure: boolean; operational: false;
  fees: AllocationFee[]; configs: FeeAllocationConfig[];
  ledger?: null | { status: "ACTIVE" | "PAUSED"; cutoffAt: string; testOnly: boolean; rubrics: { id: string; name: string }[];
    pagination?: { page: number; pages: number; total: number; fingerprint: string };
    movements: { id: string; sourceType: "opening" | "payment" | "expense"; type: string; amountMinor: number;
      lines: { rubricId: string; amountMinor: number }[]; feeTypeId: string | null; className: string | null; classOptionKey: string | null;
      originSchoolYearId: string; postedAt: string }[];
    balances: { rubricId: string; openingMinor: number; receivedMinor: number; spentMinor: number; reservedMinor: number; availableMinor: number }[] };
};
export type SaveAllocationDrafts = { schoolYearId: string; baseFeeTypeId: string; requestId: string;
  targets: Array<{ feeTypeId: string; expectedRevision: number }>; rubrics: FeeAllocationRubric[] };
export type AllocationActivationView = {
  operational: false; schoolId: string; schoolYearId: string; currency: "USD" | "CDF"; testOnly: boolean;
  status: "EN_PREPARATION" | "ACTIVE" | "PAUSED"; cutoffAt: string;
  rubrics: Array<{ id: string; name: string }>;
  versions: Array<{ id: string; configId: string; feeTypeId: string; version: number; status: "prepared" | "published" }>;
  opening: null | { id: string; status: "proposed" | "approved" | "activated"; stale: boolean; cutoffAt: string;
    approvedByCurrentUser: boolean; lines: Array<{ rubricId: string; amountMinor: number }>; cashCountMinor: number };
  inventory: null | { schoolAvailableMinor: number; cashAvailableMinor: number; fingerprint: string; evidenceCount: number;
    page: number; hasNext: boolean; evidence: Array<{ collection: string; id: string; amountMinor: number; createdAt: string }> };
};
export async function loadAllocationActivation(schoolId: string, page = 0, fingerprint?: string) {
  const result = await allocationRequest<AllocationActivationView>("get-activation", { page, ...(fingerprint ? { fingerprint } : {}) });
  if (result.schoolId !== schoolId || !result.schoolYearId || !["USD", "CDF"].includes(result.currency)
    || !["EN_PREPARATION", "ACTIVE", "PAUSED"].includes(result.status) || !Array.isArray(result.rubrics) || !Array.isArray(result.versions)) {
    throw new AllocationApiError("Contexte d'activation non confirmé.");
  }
  return result;
}
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
  const first = result.ledger?.pagination;
  if (first && result.ledger) {
    if (first.page !== 0 || !Number.isSafeInteger(first.pages) || first.pages < 1 || !Number.isSafeInteger(first.total) || first.total < 0 || !/^[a-f0-9]{64}$/.test(first.fingerprint)) throw new AllocationApiError("Pagination de registre invalide.");
    const movements = [...result.ledger.movements];
    for (let page = 1; page < first.pages; page++) {
      const next = await allocationRequest<AllocationWorkspace>("get-workspace", { schoolId, ledgerPage: page, ledgerFingerprint: first.fingerprint }, signal);
      if (next.school?.id !== schoolId || next.year?.id !== result.year.id || next.currency !== result.currency
        || next.ledger?.pagination?.page !== page || next.ledger.pagination.pages !== first.pages
        || next.ledger.pagination.total !== first.total || next.ledger.pagination.fingerprint !== first.fingerprint
        || !Array.isArray(next.ledger.movements)) throw new AllocationApiError("Registre modifié ou réponse incomplète : aucun total partiel n'est affiché.");
      movements.push(...next.ledger.movements);
    }
    if (movements.length !== first.total || new Set(movements.map(m => m.id)).size !== movements.length) throw new AllocationApiError("Registre incomplet ou doublonné : export bloqué.");
    result.ledger.movements = movements;
  }
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
