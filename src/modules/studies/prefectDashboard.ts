// Lot P1 (Préfet d'études) : tableau de pilotage calculé par le serveur.
// Les données restent en mémoire pendant la session : réouverture immédiate, sans nouvel appel,
// sauf appui sur la flèche ronde de l'en-tête (même signal que « Enfants »).
import { getCurrentFirebaseIdToken } from "../../services/auth";
import { resolveApiUrl } from "../../config/apiUrl";
import type { AppUser } from "../../types";

export interface PrefectDashboard {
  sections: string[];
  today: string;
  enrollment: { students: number; classes: number };
  presence: { recorded: number; present: number; absent: number; rate: number | null };
  difficulty: { slot: string | null; slotLabel: string | null; threshold: number; evaluated: number; count: number };
  approvedAbsences: { count: number; items: Array<{ teacherName: string; requestType: "FULL_DAY" | "TIME_RANGE"; startTime?: string; endTime?: string }> };
}

/** Les ajouts du Préfet ne s'affichent que pour cette fonction ; le Directeur des études ne voit rien de nouveau. */
export function isPrefectOfStudies(user: Pick<AppUser, "role"> & { studyFunction?: string }) {
  return user.role === "study_director" && user.studyFunction === "prefect_of_studies";
}

export function localDateKey(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const cache = new Map<string, PrefectDashboard>();
const refreshSeen = new Map<string, number>();
const cacheKey = (uid: string, schoolId: string, schoolYearId: string, today: string) => [uid, schoolId, schoolYearId, today].join("|");

export function cachedPrefectDashboard(uid: string, schoolId: string, schoolYearId: string, today = localDateKey()) {
  return cache.get(cacheKey(uid, schoolId, schoolYearId, today));
}

/** Vrai si la flèche de l'en-tête a été touchée depuis la dernière lecture gardée (ou si rien n'est gardé). */
export function prefectDashboardNeedsLoad(uid: string, schoolId: string, schoolYearId: string, headerRefresh: number, today = localDateKey()) {
  const key = cacheKey(uid, schoolId, schoolYearId, today);
  return !cache.has(key) || refreshSeen.get(key) !== headerRefresh;
}

export function clearPrefectDashboardCache() {
  cache.clear();
  refreshSeen.clear();
}

export async function loadPrefectDashboard(uid: string, schoolId: string, schoolYearId: string, options: { force?: boolean; today?: string; fetcher?: typeof fetch; headerRefresh?: number } = {}) {
  const today = options.today ?? localDateKey();
  const key = cacheKey(uid, schoolId, schoolYearId, today);
  const cached = cache.get(key);
  if (cached && !options.force) return cached;
  const token = await getCurrentFirebaseIdToken();
  const response = await (options.fetcher ?? fetch)(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prefect-dashboard", schoolId, schoolYearId, today }),
  });
  const payload = await response.json().catch(() => ({})) as Partial<PrefectDashboard> & { error?: string };
  if (!response.ok || !payload.enrollment || !payload.presence || !payload.difficulty || !payload.approvedAbsences) {
    throw new Error(payload.error || "Tableau de pilotage indisponible.");
  }
  const dashboard = payload as PrefectDashboard;
  cache.set(key, dashboard);
  refreshSeen.set(key, options.headerRefresh ?? 0);
  return dashboard;
}
