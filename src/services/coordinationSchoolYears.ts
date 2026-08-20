import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";

export type CoordinationSchoolYearRow = { schoolId: string; schoolName: string; activeYear: { id: string; name: string; startsAt?: string; endsAt?: string } | null; readinessError?: string | null };
export type CoordinationSchoolYearResult = { schoolId: string; status: "blocked" | "closed" | "opened"; reason?: string; schoolYearId?: string };

async function call(input: Record<string, unknown>) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-coordination-school-years"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Gouvernance des années impossible.");
  return payload;
}
export async function loadCoordinationSchoolYearStatus() { return call({ action: "status" }) as Promise<{ rows: CoordinationSchoolYearRow[]; referenceYear: string | null }>; }
export async function closeCoordinationSchoolYears() { return call({ action: "close", confirmed: true }) as Promise<{ results: CoordinationSchoolYearResult[] }>; }
export async function openCoordinationSchoolYears(input: { name: string; startsAt: string; endsAt: string }) { return call({ action: "open", confirmed: true, ...input }) as Promise<{ results: CoordinationSchoolYearResult[] }>; }
