import { getIdToken } from "firebase/auth";
import { auth } from "../firebase";
import { resolveApiUrl } from "../config/apiUrl";
import type { Message } from "../types";
import type { PendingMessageAttachment } from "./messageStorage";

export type SchoolMessageRecipientRole = "school_admin" | "cashier" | "discipline_director" | "study_director" | "secretary" | "teacher" | "parent" | "coordination_admin" | "sub_coordination_admin" | "pedagogical_advisor";
export type SchoolMessageRecipient = { uid: string; name: string; role: SchoolMessageRecipientRole };

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

export async function sendSchoolMessage(input: { schoolYearId: string; recipientRoles: SchoolMessageRecipientRole[]; recipientIds: string[]; subject: string; body: string; draftId: string; attachments: PendingMessageAttachment[]; idempotencyKey: string }): Promise<Message> {
  const response = await authenticatedRequest("/api/send-school-message", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({})) as { message?: Message | string; error?: string };
  if (!response.ok) throw Object.assign(new Error(typeof payload.message === "string" ? payload.message : "Message non envoyé. Veuillez réessayer."), { code: payload.error, status: response.status });
  if (!payload.message || typeof payload.message === "string") throw new Error("Réponse serveur invalide.");
  return payload.message;
}

/** Lot 23 : réponse à un message de la Coordination (personnel de l'école, pas les parents)
 * ou du Super administrateur (administrateurs). Contrôle complet côté serveur. */
export async function sendMessageReply(input: { replyToMessageId: string; body: string; subject?: string; schoolYearId?: string; idempotencyKey: string }): Promise<Message> {
  const response = await authenticatedRequest("/api/send-school-message", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({})) as { message?: Message | string; error?: string };
  if (!response.ok) throw Object.assign(new Error(typeof payload.message === "string" ? payload.message : "Réponse non envoyée. Veuillez réessayer."), { code: payload.error, status: response.status });
  if (!payload.message || typeof payload.message === "string") throw new Error("Réponse serveur invalide.");
  return payload.message;
}

/** Lot 23 : messagerie du Super administrateur (même point d'entrée, limite de 12 fonctions Vercel). */
export type PlatformRecipientRole = "coordination_admin" | "sub_coordination_admin" | "school_admin";
/** `place` : école (administrateurs) ou coordination (coordinateurs et sous-coordinateurs). */
export type PlatformRecipient = { uid: string; name: string; role: PlatformRecipientRole; schoolId: string | null; coordinationId: string | null; place: string };
/** Lot SA-6 : une page de destinataires. `unit` dit ce que compte `total` (écoles trouvées, ou personnes). */
export type PlatformRecipientPage = {
  role: PlatformRecipientRole; page: number; pageSize: number; total: number; unit: "schools" | "recipients";
  recipients: PlatformRecipient[]; emptySchools: { id: string; name: string }[];
};

export function parsePlatformRecipientPage(value: unknown): PlatformRecipientPage {
  const payload = value as Partial<PlatformRecipientPage> | null;
  if (!payload || !Number.isInteger(payload.total) || !Number.isInteger(payload.page) || !Number.isInteger(payload.pageSize) || !Array.isArray(payload.recipients)) {
    throw new Error("Réponse des destinataires incomplète.");
  }
  return {
    role: payload.role ?? "coordination_admin", page: payload.page!, pageSize: payload.pageSize!, total: payload.total!,
    unit: payload.unit === "schools" ? "schools" : "recipients",
    recipients: payload.recipients.filter((row): row is PlatformRecipient => Boolean(row) && typeof row.uid === "string" && typeof row.name === "string").map((row) => ({ ...row, place: typeof row.place === "string" ? row.place : "" })),
    emptySchools: Array.isArray(payload.emptySchools) ? payload.emptySchools.filter((row) => row && typeof row.id === "string") : [],
  };
}

/** Pages déjà chargées pendant la session : rouvrir l'onglet ou refaire la même recherche ne relit rien. */
const recipientPages = new Map<string, Promise<PlatformRecipientPage>>();
export const platformRecipientKey = (role: PlatformRecipientRole, query: string, page: number) => `${role}|${query.trim().toLowerCase()}|${page}`;
export function clearPlatformRecipientCache() { recipientPages.clear(); }

export function searchPlatformRecipients(role: PlatformRecipientRole, query: string, page: number): Promise<PlatformRecipientPage> {
  const key = platformRecipientKey(role, query, page);
  const cached = recipientPages.get(key);
  if (cached) return cached;
  const params = new URLSearchParams({ role, page: String(page), ...(query.trim() ? { q: query.trim().slice(0, 120) } : {}) });
  const request = authenticatedRequest(`/api/message-recipients?${params.toString()}`, { method: "GET" }).then(async (response) => {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) throw new Error(payload.message ?? "Destinataires indisponibles.");
    return parsePlatformRecipientPage(payload);
  });
  recipientPages.set(key, request);
  // Un échec n'est pas gardé : la prochaine demande réessaie.
  request.catch(() => { if (recipientPages.get(key) === request) recipientPages.delete(key); });
  return request;
}
export async function sendPlatformMessage(input: { recipientIds: string[]; subject: string; body: string; idempotencyKey: string }) {
  const response = await authenticatedRequest("/api/message-recipients", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": input.idempotencyKey }, body: JSON.stringify({ action: "send", ...input }) });
  const payload = await response.json().catch(() => ({})) as { messageIds?: string[]; message?: string };
  if (!response.ok) throw new Error(payload.message ?? "Message non envoyé.");
  return payload;
}
