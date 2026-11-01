import { getIdToken } from "firebase/auth";
import { auth } from "../firebase";
import { resolveApiUrl } from "../config/apiUrl";
import type { Message } from "../types";
import type { PendingMessageAttachment } from "./messageStorage";

export type SchoolMessageRecipientRole = "school_admin" | "cashier" | "discipline_director" | "study_director" | "secretary" | "teacher" | "parent" | "coordination_admin" | "sub_coordination_admin" | "kindergarten_admin" | "primary_admin" | "studies_prefect";
export type SchoolMessageRecipient = { uid: string; name: string; role: SchoolMessageRecipientRole; sections?: string[] };

async function authenticatedRequest(path: string, init: RequestInit) {
  const currentUser = auth?.currentUser;
  if (!currentUser) throw new Error("Authentification requise.");
  const token = await getIdToken(currentUser);
  return fetch(resolveApiUrl(path), { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
}

export async function loadSchoolMessageRecipients(schoolYearId?: string): Promise<SchoolMessageRecipient[]> {
  const query = schoolYearId ? `?schoolYearId=${encodeURIComponent(schoolYearId)}` : "";
  const response = await authenticatedRequest(`/api/message-recipients${query}`, { method: "GET" });
  const payload = await response.json().catch(() => ({})) as { recipients?: SchoolMessageRecipient[]; message?: string; error?: string };
  if (!response.ok) throw Object.assign(new Error(payload.message ?? "Destinataires indisponibles. Veuillez réessayer."), { code: payload.error, status: response.status });
  return Array.isArray(payload.recipients) ? payload.recipients : [];
}

export async function markSectionNotificationsRead(schoolYearId: string, notificationId?: string) {
  let count = 0;
  for (let page = 0; page < 100; page += 1) {
    const response = await authenticatedRequest("/api/message-recipients", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark-section-notifications-read", schoolYearId, ...(notificationId ? { notificationId } : {}) }) });
    if (!response.ok) throw new Error("Lecture de notification refusée. Réessayez.");
    const result = await response.json() as { count: number; hasMore: boolean };
    if (!Number.isSafeInteger(result.count) || result.count < 0 || result.count > 200 || typeof result.hasMore !== "boolean") throw new Error("Réponse de lecture invalide.");
    count += result.count;
    if (!result.hasMore) return count;
  }
  throw new Error("Actualisation incomplète. Réessayez.");
}

export async function sendSchoolMessage(input: { schoolYearId: string; recipientRoles: SchoolMessageRecipientRole[]; recipientIds: string[]; subject: string; body: string; draftId: string; attachments: PendingMessageAttachment[]; idempotencyKey: string; section?: string }): Promise<Message> {
  const response = await authenticatedRequest("/api/send-school-message", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({})) as { message?: Message | string; error?: string };
  if (!response.ok) throw Object.assign(new Error(typeof payload.message === "string" ? payload.message : "Message non envoyé. Veuillez réessayer."), { code: payload.error, status: response.status });
  if (!payload.message || typeof payload.message === "string") throw new Error("Réponse serveur invalide.");
  return payload.message;
}
