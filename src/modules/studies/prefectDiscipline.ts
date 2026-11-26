// Lot P2 (Préfet d'études) : discipline de ses sections, en lecture seule, lue par le serveur.
// Données gardées en mémoire pendant la session ; relecture seulement après un appui sur la flèche
// ronde de l'en-tête (même signal que « Enfants »). Aucun bouton « Actualiser » dans le drawer.
import { getCurrentFirebaseIdToken } from "../../services/auth";
import { resolveApiUrl } from "../../config/apiUrl";

export interface PrefectSanction {
  id: string;
  studentName: string;
  className: string;
  reason: string;
  sanctionType: string;
  duration: number | null;
  startDate: string;
  expectedEndDate: string;
  actualEndDate?: string;
  status: "active" | "completed";
  recurrenceNumber: number;
}

const cache = new Map<string, { sanctions: PrefectSanction[]; refreshSeen: number }>();
const cacheKey = (uid: string, schoolId: string, schoolYearId: string) => [uid, schoolId, schoolYearId].join("|");

export function cachedPrefectDiscipline(uid: string, schoolId: string, schoolYearId: string) {
  return cache.get(cacheKey(uid, schoolId, schoolYearId))?.sanctions;
}

/** Vrai si rien n'est gardé ou si la flèche de l'en-tête a été touchée depuis la dernière lecture. */
export function prefectDisciplineNeedsLoad(uid: string, schoolId: string, schoolYearId: string, headerRefresh: number) {
  const entry = cache.get(cacheKey(uid, schoolId, schoolYearId));
  return !entry || entry.refreshSeen !== headerRefresh;
}

export function clearPrefectDisciplineCache() {
  cache.clear();
}

export async function loadPrefectDiscipline(uid: string, schoolId: string, schoolYearId: string, options: { headerRefresh?: number; fetcher?: typeof fetch } = {}) {
  const token = await getCurrentFirebaseIdToken();
  const response = await (options.fetcher ?? fetch)(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prefect-discipline", schoolId, schoolYearId }),
  });
  const payload = await response.json().catch(() => ({})) as { sanctions?: PrefectSanction[]; error?: string };
  if (!response.ok || !Array.isArray(payload.sanctions)) throw new Error(payload.error || "Discipline indisponible.");
  cache.set(cacheKey(uid, schoolId, schoolYearId), { sanctions: payload.sanctions, refreshSeen: options.headerRefresh ?? 0 });
  return payload.sanctions;
}
