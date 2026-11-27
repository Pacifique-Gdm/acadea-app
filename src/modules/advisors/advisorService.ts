// Lots 10 et 11 : appels au serveur pour les conseillers (api/manage-teacher-grading, actions « advisor-* » et « class-visit* »).
// Les réponses sont gardées en mémoire pendant la session ; relecture seulement après un appui sur la flèche
// ronde de l'en-tête (même signal que « Enfants »). Aucun bouton « Actualiser ».
import { useEffect, useState, useSyncExternalStore } from "react";
import { getCurrentFirebaseIdToken } from "../../services/auth";
import { resolveApiUrl } from "../../config/apiUrl";
import { readStaffChildrenRefresh, subscribeStaffChildrenRefresh } from "../../services/staffChildren";

export interface AdvisorCourse { classId: string; subjectId: string; subjectName: string; className: string; weeklyPeriods: number }
export interface AdvisorTeacher { id: string; teacherName: string; courses: AdvisorCourse[]; weeklyPeriods: number }
export interface AdvisorOverview {
  sections: string[];
  teachers: AdvisorTeacher[];
  classes: Array<{ id: string; name: string; section: string }>;
  metrics: { teachers: number; assignments: number; subjects: number; workload: number; teachersWithoutAssignment: number };
}
export interface AdvisorStudent { id: string; name: string; matricule: string; className: string; section: string; gender: string; status: string }
export interface AdvisorGradeClass { classId: string; className: string; section: string; students: number; slots: Array<{ slot: string; label: string; evaluated: number; average: number | null }> }
export interface ClassVisit {
  id: string; classId: string; className: string; section: string;
  teacherId: string; teacherName: string; subjectId: string; subjectName: string;
  visitDate: string; strengths: string; improvements: string; advice: string; nextVisitDate: string;
  authorId: string; authorName: string; createdAt?: string; updatedAt?: string;
}
export interface ClassVisitInput { classId: string; teacherId: string; subjectId: string; visitDate: string; strengths: string; improvements: string; advice: string; nextVisitDate: string }

type Fetcher = typeof fetch;

export async function callAdvisorAction<T>(action: string, payload: Record<string, unknown>, fetcher: Fetcher = fetch): Promise<T> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetcher(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Lecture impossible pour le moment.");
  return body;
}

const cache = new Map<string, { value: unknown; refreshSeen: number }>();
export function clearAdvisorCache() { cache.clear(); }

/** Vrai si rien n'est gardé ou si la flèche de l'en-tête a été touchée depuis la dernière lecture. */
export function advisorNeedsLoad(key: string, headerRefresh: number) {
  const entry = cache.get(key);
  return !entry || entry.refreshSeen !== headerRefresh;
}

export async function loadAdvisorData<T>(key: string, action: string, payload: Record<string, unknown>, headerRefresh: number, fetcher?: Fetcher) {
  const value = await callAdvisorAction<T>(action, payload, fetcher);
  cache.set(key, { value, refreshSeen: headerRefresh });
  return value;
}

/** Lecture serveur gardée en mémoire ; relue après la flèche de l'en-tête. */
export function useAdvisorData<T>(action: string, payload: { uid: string; schoolId: string; schoolYearId: string }, enabled = true) {
  const headerRefresh = useSyncExternalStore(subscribeStaffChildrenRefresh, readStaffChildrenRefresh);
  const key = [action, payload.uid, payload.schoolId, payload.schoolYearId].join("|");
  const [value, setValue] = useState<T | undefined>(() => cache.get(key)?.value as T | undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [localRevision, setLocalRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const cached = cache.get(key);
    if (cached && !advisorNeedsLoad(key, headerRefresh) && retry === 0 && localRevision === 0) { setValue(cached.value as T); return undefined; }
    let active = true;
    setLoading(true);
    setError(null);
    loadAdvisorData<T>(key, action, { schoolId: payload.schoolId, schoolYearId: payload.schoolYearId }, headerRefresh)
      .then((next) => { if (active) setValue(next); })
      .catch((reason: unknown) => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [action, key, payload.schoolId, payload.schoolYearId, headerRefresh, retry, enabled, localRevision]);
  return { value, loading, error, retry: () => setRetry((count) => count + 1), reload: () => setLocalRevision((count) => count + 1) };
}

export function saveClassVisit(input: { schoolId: string; schoolYearId: string; visitId?: string; visit: ClassVisitInput }, fetcher?: Fetcher) {
  return callAdvisorAction<{ visit: ClassVisit }>("class-visit-save", input, fetcher);
}

/** Calcul pur : filtre de recherche simple sur les élèves (nom, matricule, classe). */
export function filterAdvisorStudents(students: AdvisorStudent[], search: string) {
  const term = search.trim().toLocaleLowerCase("fr");
  if (!term) return students;
  return students.filter((student) => [student.name, student.matricule, student.className].some((value) => value.toLocaleLowerCase("fr").includes(term)));
}

export const emptyVisitInput = (today: string): ClassVisitInput => ({ classId: "", teacherId: "", subjectId: "", visitDate: today, strengths: "", improvements: "", advice: "", nextVisitDate: "" });
