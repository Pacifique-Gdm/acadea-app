import { getIdToken } from "firebase/auth";
import { auth } from "../firebase";
import type { AppNotification, Message } from "../types";

export type ParentMessageRecipient = "admin" | "cashier" | "both" | "discipline";

export type ParentMessageQuota = {
  limit: number;
  messageCount: number;
  remaining: number;
  windowStartedAt?: string;
  windowExpiresAt?: string;
  windowHours?: number;
};

type ParentMessageResponse = {
  message: Message;
  notification: AppNotification;
  quota: ParentMessageQuota;
};

type ParentMessageErrorCode = "api-unavailable" | "not-authorized" | "quota-exceeded" | "server-error" | "network-error" | "request-error";

async function requireIdToken() {
  const currentUser = (auth as unknown as { currentUser?: Parameters<typeof getIdToken>[0] } | undefined)?.currentUser;
  if (!currentUser) {
    const error = new Error("Authentification parent requise.");
    Object.assign(error, { code: "not-authorized", status: 401 });
    throw error;
  }
  return getIdToken(currentUser);
}

function codeFromStatus(status: number, fallbackCode?: string): ParentMessageErrorCode {
  if (status === 404) return "api-unavailable";
  if (status === 401 || status === 403) return "not-authorized";
  if (status === 429) return "quota-exceeded";
  if (status >= 500 && status <= 599) return "server-error";
  if (fallbackCode === "quota-exceeded" || fallbackCode === "not-authorized") return fallbackCode;
  return "request-error";
}

async function readResponsePayload(response: Response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return { raw, data: {} as Record<string, unknown> };
  try {
    return { raw, data: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { raw, data: {} as Record<string, unknown> };
  }
}

async function parseParentMessageResponse(response: Response) {
  const { raw, data: payload } = await readResponsePayload(response);
  if (!response.ok) {
    const serverCode = typeof payload.error === "string" ? payload.error : undefined;
    const serverMessage = typeof payload.message === "string" ? payload.message : undefined;
    const error = new Error(serverMessage || "Message non envoyé. Veuillez réessayer.");
    Object.assign(error, {
      code: codeFromStatus(response.status, serverCode),
      status: response.status,
      statusText: response.statusText,
      responseBody: raw.slice(0, 500),
    });
    throw error;
  }
  return payload;
}

async function fetchParentMessaging(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (cause) {
    const error = new Error("Connexion indisponible. Veuillez réessayer.");
    Object.assign(error, { code: "network-error", cause });
    throw error;
  }
}

export async function fetchParentMessageQuota(schoolYearId: string): Promise<ParentMessageQuota> {
  const token = await requireIdToken();
  const params = new URLSearchParams({ schoolYearId });
  const response = await fetchParentMessaging(`/api/send-parent-message?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await parseParentMessageResponse(response);
  return payload.quota as ParentMessageQuota;
}

export async function sendParentMessageWithQuota(input: {
  schoolYearId: string;
  recipient: ParentMessageRecipient;
  subject: string;
  body: string;
}): Promise<ParentMessageResponse> {
  const token = await requireIdToken();
  const response = await fetchParentMessaging("/api/send-parent-message", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return parseParentMessageResponse(response) as Promise<ParentMessageResponse>;
}
