// Lot R3 (réglages par section) : périmètre et enregistrement des réglages de présence d'un
// Directeur de discipline rattaché à des sections, par le serveur.
// Périmètre gardé en mémoire pendant la session ; relu seulement après un appui sur la flèche
// ronde de l'en-tête. Aucun bouton « Actualiser » dans le drawer.
import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import type { AttendanceSettings, SchoolSection } from "../types";

export type AttendanceSettingsScope = { limited: boolean; sections: SchoolSection[] };

const cache = new Map<string, { scope: AttendanceSettingsScope; refreshSeen: number }>();
const cacheKey = (uid: string, schoolId: string) => `${uid}|${schoolId}`;

export function cachedAttendanceSettingsScope(uid: string, schoolId: string) {
  return cache.get(cacheKey(uid, schoolId))?.scope;
}

/** Vrai si rien n'est gardé ou si la flèche de l'en-tête a été touchée depuis la dernière lecture. */
export function attendanceSettingsScopeNeedsLoad(uid: string, schoolId: string, headerRefresh: number) {
  const entry = cache.get(cacheKey(uid, schoolId));
  return !entry || entry.refreshSeen !== headerRefresh;
}

export function clearAttendanceSettingsScopeCache() {
  cache.clear();
}

async function callServer<T>(body: Record<string, unknown>, fetcher: typeof fetch, fallback: string): Promise<T> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetcher(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
}

export async function loadAttendanceSettingsScope(uid: string, schoolId: string, options: { headerRefresh?: number; fetcher?: typeof fetch } = {}) {
  const payload = await callServer<Partial<AttendanceSettingsScope>>({ action: "attendance-settings-scope", schoolId }, options.fetcher ?? fetch, "Droits sur les réglages indisponibles.");
  if (typeof payload.limited !== "boolean" || !Array.isArray(payload.sections)) throw new Error("Droits sur les réglages indisponibles.");
  const scope = { limited: payload.limited, sections: payload.sections };
  cache.set(cacheKey(uid, schoolId), { scope, refreshSeen: options.headerRefresh ?? 0 });
  return scope;
}

/** Le serveur repart du document actuel ; un compte limité ne remplace que ses sections. */
export async function saveAttendanceSettingsOnServer(input: { schoolId: string; schoolYearId: string; settings: AttendanceSettings; expectedUpdatedAt: string | null }, fetcher: typeof fetch = fetch) {
  const { schoolDays, sectionSchoolDays, defaultSchedule, sectionSchedule, classSchedule } = input.settings;
  const payload = await callServer<{ settings?: AttendanceSettings }>({
    action: "attendance-settings-save",
    schoolId: input.schoolId,
    schoolYearId: input.schoolYearId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    settings: { schoolDays, sectionSchoolDays, defaultSchedule, sectionSchedule, classSchedule },
  }, fetcher, "Enregistrement des réglages impossible.");
  if (!payload.settings) throw new Error("Enregistrement des réglages impossible.");
  return payload.settings;
}
