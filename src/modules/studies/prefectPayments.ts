// Lot P4 (Préfet d'études) : situation des paiements de ses sections, SANS AUCUN MONTANT, calculée par le serveur.
// Affichée seulement sur le Dashboard du Préfet (aucun bouton dans le Menu).
// Données gardées en mémoire pendant la session ; relecture seulement après un appui sur la flèche
// ronde de l'en-tête (même signal que « Enfants »). Aucun bouton « Actualiser ».
import { getCurrentFirebaseIdToken } from "../../services/auth";
import { resolveApiUrl } from "../../config/apiUrl";

export interface PrefectPaymentClass { className: string; students: number; settled: number; remaining: number; unknown: number; settledRate: number | null; remainingRate: number | null }
export interface PrefectPayments {
  sections: string[];
  classes: PrefectPaymentClass[];
  overall: { students: number; settled: number; remaining: number; unknown: number; settledRate: number | null };
}

const cache = new Map<string, { payments: PrefectPayments; refreshSeen: number }>();
const cacheKey = (uid: string, schoolId: string, schoolYearId: string) => [uid, schoolId, schoolYearId].join("|");

export function cachedPrefectPayments(uid: string, schoolId: string, schoolYearId: string) {
  return cache.get(cacheKey(uid, schoolId, schoolYearId))?.payments;
}

/** Vrai si rien n'est gardé ou si la flèche de l'en-tête a été touchée depuis la dernière lecture. */
export function prefectPaymentsNeedsLoad(uid: string, schoolId: string, schoolYearId: string, headerRefresh: number) {
  const entry = cache.get(cacheKey(uid, schoolId, schoolYearId));
  return !entry || entry.refreshSeen !== headerRefresh;
}

export function clearPrefectPaymentsCache() {
  cache.clear();
}

export async function loadPrefectPayments(uid: string, schoolId: string, schoolYearId: string, options: { headerRefresh?: number; fetcher?: typeof fetch } = {}) {
  const token = await getCurrentFirebaseIdToken();
  const response = await (options.fetcher ?? fetch)(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prefect-payments", schoolId, schoolYearId }),
  });
  const payload = await response.json().catch(() => ({})) as Partial<PrefectPayments> & { error?: string };
  if (!response.ok || !Array.isArray(payload.classes) || !payload.overall) throw new Error(payload.error || "Situation des paiements indisponible.");
  const payments = payload as PrefectPayments;
  cache.set(cacheKey(uid, schoolId, schoolYearId), { payments, refreshSeen: options.headerRefresh ?? 0 });
  return payments;
}
