import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";
import type { SchoolClassRecord } from "../types";

export async function readDisciplineClasses(schoolId: string, schoolYearId: string, signal?: AbortSignal): Promise<SchoolClassRecord[]> {
  const token = await getCurrentFirebaseIdToken();
  const query = new URLSearchParams({ view: "attendance-classes", schoolYearId });
  const response = await fetch(resolveApiUrl(`/api/manage-teacher-availability-request?${query}`), {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal,
  });
  const payload = await response.json() as { classes?: SchoolClassRecord[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "Classes indisponibles.");
  if (!Array.isArray(payload.classes) || payload.classes.some(item => item.schoolId !== schoolId || item.schoolYearId !== schoolYearId)) throw new Error("Classes hors périmètre.");
  return payload.classes;
}
