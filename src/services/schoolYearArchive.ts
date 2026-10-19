import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";

export type ArchivedYear = { id: string; name: string; startsAt?: string; endsAt?: string };
export type ArchiveSummary = { year: { id: string; name: string }; title: string; items: Array<{ label: string; detail: string }>; truncated?: boolean };

async function request<T>(body: Record<string, string>): Promise<T> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? "Archives indisponibles.");
  return payload;
}

export const listArchivedYears = (schoolId: string) => request<{ years: ArchivedYear[] }>({ action: "archive-years", schoolId });
export const readArchivedYear = (schoolId: string, schoolYearId: string) => request<ArchiveSummary>({ action: "archive-summary", schoolId, schoolYearId });
