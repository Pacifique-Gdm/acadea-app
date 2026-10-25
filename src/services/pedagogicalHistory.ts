import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import type { AuditLog } from "../types";

export type PedagogicalHistoryCursor = { createdAt: string; id: string };

export async function listPedagogicalHistory(schoolId: string, schoolYearId: string, cursor?: PedagogicalHistoryCursor) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-teacher-grading"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list-pedagogical-history", schoolId, schoolYearId, ...(cursor ? { cursor } : {}) }),
  });
  const payload = await response.json().catch(() => ({})) as { items?: AuditLog[]; nextCursor?: PedagogicalHistoryCursor | null; error?: string };
  if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.error || "Historique pédagogique indisponible.");
  return { items: payload.items, nextCursor: payload.nextCursor ?? null };
}
