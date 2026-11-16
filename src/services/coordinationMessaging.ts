import { resolveApiUrl } from "../config/apiUrl";
import { getCurrentFirebaseIdToken } from "./auth";

export type CoordinationRecipient = { uid: string; name: string; role: string; schoolId: string };

async function authenticatedRequest(path: string, init: RequestInit = {}) {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl(path), { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Messagerie Coordination indisponible.");
  return payload;
}

export async function loadCoordinationRecipients(schoolId = "") {
  const suffix = schoolId ? `?schoolId=${encodeURIComponent(schoolId)}` : "";
  const payload = await authenticatedRequest(`/api/coordination-message-recipients${suffix}`);
  return Array.isArray(payload.recipients) ? payload.recipients as CoordinationRecipient[] : [];
}

export async function sendCoordinationMessage(input: { schoolId?: string; recipientIds: string[]; subject: string; body: string; idempotencyKey: string }) {
  return authenticatedRequest("/api/coordination-message-recipients", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(input) });
}

/** Lot 23 : « Tous les … » — la liste est calculée par le serveur (droits, écoles, sans doublon). */
export async function sendCoordinationAudienceMessage(input: { audience: { role: string; schoolId?: string }; subject: string; body: string; idempotencyKey: string }) {
  return authenticatedRequest("/api/coordination-message-recipients", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(input) }) as Promise<{ recipientCount?: number; messageIds?: string[] }>;
}

/** Lot 23 : réponse de la Coordination au Super administrateur. */
export async function replyAsCoordination(input: { replyToMessageId: string; body: string; subject?: string; idempotencyKey: string }) {
  return authenticatedRequest("/api/coordination-message-recipients", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(input) });
}
