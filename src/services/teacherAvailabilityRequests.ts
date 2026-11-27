import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";

export async function reviewTeacherAvailabilityRequest(input: { requestId: string; action: "APPROVE" | "REJECT"; reviewComment?: string }) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-teacher-availability-request"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({})) as { error?: string; request?: unknown };
  if (!response.ok) throw new Error(payload.error || "Traitement de la demande impossible.");
  return payload.request;
}

/** Lot B : demandes de l'année, déjà filtrées par le serveur selon les sections du compte. */
export async function listTeacherAvailabilityRequests<T = unknown>(schoolYearId: string): Promise<T[]> {
  const token = await getCurrentFirebaseIdToken();
  const params = new URLSearchParams({ view: "availability-requests", schoolYearId });
  const response = await fetch(resolveApiUrl(`/api/manage-teacher-availability-request?${params.toString()}`), { method: "GET", headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({})) as { error?: string; requests?: T[] };
  if (!response.ok) throw new Error(payload.error || "Chargement impossible. Veuillez réessayer.");
  return Array.isArray(payload.requests) ? payload.requests : [];
}
