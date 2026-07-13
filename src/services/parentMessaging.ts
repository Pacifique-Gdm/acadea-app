import { getIdToken } from "firebase/auth";
import { auth } from "../firebase";
import type { AppNotification, Message } from "../types";

export type ParentMessageRecipient = "admin" | "cashier" | "both" | "discipline";

export type ParentMessageQuota = {
  limit: number;
  messageCount: number;
  remaining: number;
  localDate: string;
  timeZone: string;
};

type ParentMessageResponse = {
  message: Message;
  notification: AppNotification;
  quota: ParentMessageQuota;
};

async function requireIdToken() {
  const currentUser = (auth as unknown as { currentUser?: Parameters<typeof getIdToken>[0] } | undefined)?.currentUser;
  if (!currentUser) {
    throw new Error("Authentification parent requise.");
  }
  return getIdToken(currentUser);
}

async function parseParentMessageResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload.message ?? "Message non envoyé. Veuillez réessayer."));
    Object.assign(error, { code: payload.error ?? "server-error", status: response.status });
    throw error;
  }
  return payload;
}

export async function fetchParentMessageQuota(schoolYearId: string): Promise<ParentMessageQuota> {
  const token = await requireIdToken();
  const params = new URLSearchParams({ schoolYearId });
  const response = await fetch(`/api/send-parent-message?${params.toString()}`, {
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
  const response = await fetch("/api/send-parent-message", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return parseParentMessageResponse(response) as Promise<ParentMessageResponse>;
}
