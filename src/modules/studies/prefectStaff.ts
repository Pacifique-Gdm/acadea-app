// Lot P3 (Préfet d'études) : enseignants de ses sections (cours, charge, absences approuvées), lus par le serveur.
// Affichés dans le drawer EXISTANT « Personnels enseignants », pour le Préfet seulement.
// Données gardées en mémoire pendant la session ; relecture seulement après un appui sur la flèche
// ronde de l'en-tête (même signal que « Enfants »). Aucun bouton « Actualiser ».
import { getCurrentFirebaseIdToken } from "../../services/auth";
import { resolveApiUrl } from "../../config/apiUrl";
import { localDateKey } from "./prefectDashboard";

export interface PrefectStaffAbsence { date: string; requestType: "FULL_DAY" | "TIME_RANGE"; startTime?: string; endTime?: string }
export interface PrefectStaffTeacher {
  id: string;
  teacherName: string;
  courses: Array<{ subjectName: string; className: string; weeklyPeriods: number }>;
  weeklyPeriods: number;
  absentToday: boolean;
  upcomingAbsences: PrefectStaffAbsence[];
  upcomingAbsenceCount: number;
}
export interface PrefectStaff { sections: string[]; today: string; teachers: PrefectStaffTeacher[] }

const cache = new Map<string, { staff: PrefectStaff; refreshSeen: number }>();
const cacheKey = (uid: string, schoolId: string, schoolYearId: string, today: string) => [uid, schoolId, schoolYearId, today].join("|");

export function cachedPrefectStaff(uid: string, schoolId: string, schoolYearId: string, today = localDateKey()) {
  return cache.get(cacheKey(uid, schoolId, schoolYearId, today))?.staff;
}

/** Vrai si rien n'est gardé ou si la flèche de l'en-tête a été touchée depuis la dernière lecture. */
export function prefectStaffNeedsLoad(uid: string, schoolId: string, schoolYearId: string, headerRefresh: number, today = localDateKey()) {
  const entry = cache.get(cacheKey(uid, schoolId, schoolYearId, today));
  return !entry || entry.refreshSeen !== headerRefresh;
}

export function clearPrefectStaffCache() {
  cache.clear();
}

export async function loadPrefectStaff(uid: string, schoolId: string, schoolYearId: string, options: { headerRefresh?: number; today?: string; fetcher?: typeof fetch } = {}) {
  const today = options.today ?? localDateKey();
  const token = await getCurrentFirebaseIdToken();
  const response = await (options.fetcher ?? fetch)(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prefect-staff", schoolId, schoolYearId, today }),
  });
  const payload = await response.json().catch(() => ({})) as Partial<PrefectStaff> & { error?: string };
  if (!response.ok || !Array.isArray(payload.teachers)) throw new Error(payload.error || "Personnel de mes sections indisponible.");
  const staff = payload as PrefectStaff;
  cache.set(cacheKey(uid, schoolId, schoolYearId, today), { staff, refreshSeen: options.headerRefresh ?? 0 });
  return staff;
}
