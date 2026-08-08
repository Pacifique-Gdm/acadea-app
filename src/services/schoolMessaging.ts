import { getIdToken } from "firebase/auth";
import { auth } from "../firebase";
import { resolveApiUrl } from "../config/apiUrl";
import type { Message } from "../types";
import type { PendingMessageAttachment } from "./messageStorage";

export type SchoolMessageRecipientRole = "school_admin" | "cashier" | "discipline_director" | "secretary" | "parent";

export async function sendSchoolMessage(input: { schoolYearId: string; recipientRoles: SchoolMessageRecipientRole[]; recipientIds: string[]; subject: string; body: string; draftId: string; attachments: PendingMessageAttachment[]; idempotencyKey: string }): Promise<Message> {
  const currentUser = auth?.currentUser;
  if (!currentUser) throw new Error("Authentification requise.");
  const token = await getIdToken(currentUser);
  const response = await fetch(resolveApiUrl("/api/send-school-message"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({})) as { message?: Message | string; error?: string };
  if (!response.ok) throw Object.assign(new Error(typeof payload.message === "string" ? payload.message : "Message non envoyé. Veuillez réessayer."), { code: payload.error, status: response.status });
  if (!payload.message || typeof payload.message === "string") throw new Error("Réponse serveur invalide.");
  return payload.message;
}
