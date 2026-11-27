import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import type { FeeAllocationConfig, FeeAllocationRubric, FeeAllocationSocialVersion, FeeAllocationVersion } from "../types/feeAllocation";

export type AllocationFee = { id: string; name: string; className: string; classOptionKey: string | null; amount: number };
export type AllocationWorkspace = {
  school: { id: string; name: string; activeSchoolYearId: string };
  year: { id: string; schoolId: string; name: string; status: string; startsAt: string | null; endsAt: string | null };
  currency: "USD" | "CDF"; canConfigure: boolean; operational: false; pendingAllocations?: number;
  /** Lot « Deux onglets » : présent seulement dans la vue du personnel (rubriques partagées avec lui). */
  sharedRubricIds?: string[]; rubricCatalog?: { id: string; name: string; hidden: boolean }[];
  fees: AllocationFee[]; configs: FeeAllocationConfig[];
  forecast?: { status: 'complete'; revision: string | null; calculatedAt: string; studentCount: number;
    /** Version 1.19.0 : nombre de cas sociaux de l'année (Administrateur seulement ; absent dans la vue du personnel). */
    socialStudentCount?: number;
    rows: { feeTypeId: string; className: string; classOptionKey: string | null; rubricId: string; rubricName: string; amountMinor: number; arrearsYearName?: string; studentsCount: number;
      /** Lot 27c-1 : tableau 1 (élèves normaux) ou 2 (cas sociaux) ; part de la rubrique dans le tarif. */
      table?: 1 | 2; rubricShare?: number; tariffMinor?: number; rubricMode?: "percent" | "fixed" | null; basisPoints?: number | null }[] };
  ledger?: null | { status: "ACTIVE" | "PAUSED"; cutoffAt: string; testOnly: boolean; rubrics: { id: string; name: string; arrearsYearName?: string; originSchoolYearId?: string }[];
    pagination?: { page: number; hasNext: boolean; nextCursor: string | null; fingerprint: string };
    movements: { id: string; sourceType: "opening" | "payment" | "expense"; type: string; amountMinor: number;
      lines: { rubricId: string; amountMinor: number }[]; feeTypeId: string | null; className: string | null; classOptionKey: string | null;
      originSchoolYearId: string; postedAt: string; socialCase?: boolean; formerStudent?: boolean }[];
    balances: { rubricId: string; openingMinor: number; receivedMinor: number; spentMinor: number; reservedMinor: number; availableMinor: number;
      /** Soldes des sous-rubriques, puis « Non affecté (rubrique) » (id UNALLOCATED), seulement si la rubrique en a. */
      subView?: { id: string; name: string; mode?: "percent" | "fixed"; basisPoints?: number; fixedMinor?: number; receivedMinor: number; spentMinor: number; availableMinor: number }[] }[] };
};
export type SaveAllocationDrafts = { schoolYearId: string; baseFeeTypeId: string; requestId: string;
  targets: Array<{ feeTypeId: string; expectedRevision: number }>; rubrics: FeeAllocationRubric[];
  /** Version 1.19.0 : partie des cas sociaux (mêmes rubriques), publiée en même temps que la partie 1. */
  socialRubrics?: Array<{ id: string; mode: "percent" | "fixed"; basisPoints?: number; fixedMinor?: number }> };
export type AllocationEvidence = { collection: string; id: string; amountMinor: number | null; createdAt: string | null; reason: string | null; nature: string; receiptNumber: string | null; currency: 'USD' | 'CDF' | null };
export type AllocationProof = { type: 'financialIdempotency' | 'personnelPayments'; id: string; nature: string; amount: number; currency: 'USD' | 'CDF' | null; createdAt: string | null; receiptNumber: string | null };
export type AllocationActivationView = {
  operational: false; schoolId: string; schoolYearId: string; currency: "USD" | "CDF"; testOnly: boolean;
  status: "EN_PREPARATION" | "ACTIVE" | "PAUSED"; cutoffAt: string;
  reconciliation?: null | { id: string; status: "RUNNING" | "BLOCKED" | "COMPLETE"; pageCount: number; scanned: number; evidenceCount: number; blockedCount: number; sequence: number; stale: boolean; reason: string | null; deficitMinor?: number };
  /** Lot « 3 étapes » : encaissements reçus depuis la vérification (répartis à l'activation). */
  setupPayments?: { count: number; receivedMinor: number };
  /** Lot « 3 étapes », B : aucune écriture cette année → un seul écran « Activer ». */
  emptyHistory?: boolean;
  evidencePage?: { page: number; hasNext: boolean; fingerprint: string | null; rows: AllocationEvidence[] };
  singleBlocker?: AllocationEvidence | null;
  rubrics: Array<{ id: string; name: string }>;
  versions: Array<{ id: string; configId: string; feeTypeId: string; version: number; status: "prepared" | "published"; hasSocialPart?: true }>;
  opening: null | { id: string; status: "proposed" | "approved" | "activated"; stale: boolean; cutoffAt: string;
    approvedByCurrentUser: boolean; lines: Array<{ rubricId: string; amountMinor: number }>; cashCountMinor: number;
    cashGapMinor?: number; reasons?: { deficit: string | null; cashGap: string | null; unallocated: string | null } | null };
  inventory: null | { schoolAvailableMinor: number; cashAvailableMinor: number; cashExpectedMinor?: number; deficitMinor?: number; fingerprint: string; evidenceCount: number;
    page: number; hasNext: boolean; evidence: Array<{ collection: string; id: string; amountMinor: number; createdAt: string }> };
};
export async function loadAllocationActivation(schoolId: string, page = 0, fingerprint?: string, blockedOnly = false) {
  const result = await allocationRequest<AllocationActivationView>("get-activation", { page, ...(fingerprint ? { fingerprint } : {}), ...(blockedOnly ? { blockedOnly } : {}) });
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
/** `fresh` : relecture complète côté serveur (sans le prévu gardé), utilisée avant un export PDF. */
export async function loadAllocationWorkspace(schoolId: string, signal?: AbortSignal, options: { fresh?: boolean; shared?: boolean } = {}) {
  // Lot « Deux onglets » : le personnel lit une vue réduite aux rubriques partagées avec lui.
  const result = await allocationRequest<AllocationWorkspace>(options.shared ? "get-shared-workspace" : "get-workspace", { schoolId, ...(options.fresh ? { fresh: true } : {}) }, signal);
  if (result.school?.id !== schoolId || !result.year?.id || !["USD", "CDF"].includes(result.currency)
    || !Array.isArray(result.fees) || !Array.isArray(result.configs)) throw new AllocationApiError("Contexte de répartition incomplet.");
  if (result.forecast?.status !== 'complete' || !Array.isArray(result.forecast.rows)
    || result.forecast.rows.some(r => !Number.isSafeInteger(r.amountMinor) || r.amountMinor < 0)) throw new AllocationApiError("Prévu annuel non confirmé : tableau et export indisponibles.");
  const first = result.ledger?.pagination;
  if (first && result.ledger) {
    if (first.page !== 0 || typeof first.hasNext !== 'boolean' || !/^[a-f0-9]{64}$/.test(first.fingerprint)) throw new AllocationApiError("Pagination de registre invalide.");
    const movements = [...result.ledger.movements];
    let pagination = first;
    const seenCursors = new Set<string>();
    for (let page = 1; pagination.hasNext; page++) {
      if (!pagination.nextCursor || seenCursors.has(pagination.nextCursor) || movements.at(-1)?.id !== pagination.nextCursor) throw new AllocationApiError('Curseur de registre invalide.');
      seenCursors.add(pagination.nextCursor);
      const next = await allocationRequest<AllocationWorkspace>("get-workspace", { schoolId, ledgerPage: page, ledgerFingerprint: first.fingerprint, ledgerCursor: pagination.nextCursor }, signal);
      if (next.school?.id !== schoolId || next.year?.id !== result.year.id || next.currency !== result.currency
        || next.ledger?.pagination?.page !== page || next.ledger.pagination.fingerprint !== first.fingerprint
        || typeof next.ledger.pagination.hasNext !== 'boolean'
        || !Array.isArray(next.ledger.movements) || !next.ledger.movements.length) throw new AllocationApiError("Registre modifié ou réponse incomplète : aucun total partiel n'est affiché.");
      movements.push(...next.ledger.movements);
      pagination = next.ledger.pagination;
    }
    if (new Set(movements.map(m => m.id)).size !== movements.length) throw new AllocationApiError("Registre incomplet ou doublonné : export bloqué.");
    const sums = new Map<string, number>();
    for (const movement of movements) for (const line of movement.lines) {
      const sum = (sums.get(line.rubricId) ?? 0) + line.amountMinor;
      if (!Number.isSafeInteger(sum)) throw new AllocationApiError('Cumul de registre invalide.');
      sums.set(line.rubricId, sum);
    }
    if (result.ledger.balances.some(b => (sums.get(b.rubricId) ?? 0) !== b.openingMinor + b.receivedMinor - b.spentMinor)
      || [...sums.keys()].some(id => !result.ledger!.balances.some(b => b.rubricId === id))) throw new AllocationApiError('Écart entre registre complet et soldes : export bloqué.');
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

/** Lot 27b : catalogue des rubriques de l'école et de l'année. */
export type AllocationCatalogRubric = { id: string; name: string; hidden: boolean; used?: boolean };
export async function loadRubricCatalog(schoolId: string, signal?: AbortSignal) {
  const result = await allocationRequest<{ enabled: boolean; rubrics: AllocationCatalogRubric[]; schoolYearId: string; currency?: string }>("list-rubrics", { schoolId }, signal);
  if (!Array.isArray(result.rubrics)) throw new AllocationApiError("Liste des rubriques incomplète.");
  return result;
}
const rubricRequestId = () => crypto.randomUUID().replaceAll("-", "");
export const createRubric = (schoolId: string, name: string) => allocationRequest<{ rubric: AllocationCatalogRubric }>("create-rubric", { schoolId, name, requestId: rubricRequestId() });
export const renameRubric = (schoolId: string, rubricId: string, name: string) => allocationRequest<{ rubric: AllocationCatalogRubric }>("rename-rubric", { schoolId, rubricId, name, requestId: rubricRequestId() });
export const setRubricHidden = (schoolId: string, rubricId: string, hidden: boolean) => allocationRequest<{ rubric: AllocationCatalogRubric }>("set-rubric-hidden", { schoolId, rubricId, hidden, requestId: rubricRequestId() });
export const deleteRubric = (schoolId: string, rubricId: string) => allocationRequest<{ deletedId: string }>("delete-rubric", { schoolId, rubricId, requestId: rubricRequestId() });

/** Version 1.19.0 : partie 2 (cas sociaux) de TOUS les frais répartis, dans un seul formulaire. */
export type SocialPartItem = { feeTypeId: string; feeName: string; className: string | null; classOptionKey: string | null;
  partOne: FeeAllocationVersion; social: FeeAllocationSocialVersion | null; paidWithCurrent: number };
export async function loadSocialParts(schoolId: string) {
  const result = await allocationRequest<{ items: SocialPartItem[] }>("get-social-parts", { schoolId });
  if (!Array.isArray(result.items) || result.items.some((item) => !item?.partOne || !Array.isArray(item.partOne.rubrics))) throw new AllocationApiError("Partie 2 non confirmée.");
  return result.items;
}
export type SocialPartRubricInput = { id: string; mode: "percent" | "fixed"; basisPoints?: number; fixedMinor?: number };
export type PublishSocialParts = { requestId: string; confirmation: string;
  items: Array<{ feeTypeId: string; expectedPartOneVersionId: string; expectedSocialVersionId: string | null; rubrics: SocialPartRubricInput[] }>;
  /** F2 : écarts des sous-rubriques des cas sociaux avec la partie 1, par rubrique (une répartition pour tous les frais). */
  socialSubRubrics?: Record<string, SocialSubOverrides> };
export type SocialSubOverride = { removed: true } | { mode: "percent"; basisPoints: number } | { mode: "fixed"; fixedMinor: number };
export type SocialSubOverrides = Record<string, SocialSubOverride>;
/** Tous les frais modifiés en une seule fois : tout passe ou rien ne passe. */
export async function publishSocialParts(request: PublishSocialParts) {
  const result = await allocationRequest<{ socials: FeeAllocationSocialVersion[] }>("publish-social-parts", request);
  if (!Array.isArray(result.socials) || result.socials.length !== request.items.length
    || request.items.some((item) => !result.socials.some((social) => social.feeTypeId === item.feeTypeId && social.partOneVersionId === item.expectedPartOneVersionId))) {
    throw new AllocationApiError("Publication non confirmée. Vérifiez la même demande avant de recommencer.");
  }
  return result.socials;
}

/** Lot « Deux onglets et partage des rubriques ». */
export type ShareRule = { all: boolean; userIds?: string[]; exceptUserIds?: string[] };
export type ShareStaff = { id: string; name: string; role: "discipline_director" | "study_director" | "secretary" | "teacher" };
export type AllocationShares = { schoolId: string; schoolYearId: string; revision: string | null; rubrics: Record<string, ShareRule>; staff: ShareStaff[] };
const shareRequestId = () => crypto.randomUUID().replaceAll("-", "");
export const loadAllocationShares = (schoolId: string) => allocationRequest<AllocationShares>("get-shares", { schoolId });
export const setRubricShare = (schoolId: string, expectedRevision: string | null, rubricId: string, all: boolean, userIds: string[]) =>
  allocationRequest<{ revision: string; rubrics: Record<string, ShareRule> }>("set-rubric-share", { schoolId, requestId: shareRequestId(), expectedRevision, rubricId, all, userIds });
export const revokeShare = (schoolId: string, expectedRevision: string | null, target: string, rubricIds: string[] | null) =>
  allocationRequest<{ revision: string; rubrics: Record<string, ShareRule> }>("revoke-share", { schoolId, requestId: shareRequestId(), expectedRevision, target, rubricIds });
export const loadMySharedRubrics = () => allocationRequest<{ schoolId: string; rubricIds: string[] }>("get-my-shares", {});
export const staffRoleLabel = (role: ShareStaff["role"]) => ({ discipline_director: "Directeur de discipline", study_director: "Directeur des études", secretary: "Secrétaire", teacher: "Enseignant" })[role] ?? "Personnel";
/** Ce que voit une personne : rubriques partagées avec elle (tout le personnel sauf exception, ou choisie). */
export function rubricsSharedWith(rubrics: Record<string, ShareRule>, userId: string) {
  return Object.entries(rubrics).filter(([, rule]) => rule.all ? !(rule.exceptUserIds ?? []).includes(userId) : (rule.userIds ?? []).includes(userId)).map(([id]) => id);
}
