import { describe, expect, it, vi } from "vitest";
import { sendMessageToDevices } from "./sendMessageToDevices.js";

describe("envoi push de messagerie", () => {
  it.each([
    ["school_message_received", "Nouveau message Acadéa", "Un nouveau message de votre école est disponible."],
    ["parent_message_received", "Nouveau message parent", "Un nouveau message est disponible dans la messagerie Acadéa."],
  ] as const)("envoie un payload minimal pour %s et nettoie les tokens invalides", async (event, title, body) => {
    const sendEachForMulticast = vi.fn(async (input: Record<string, unknown>) => {
      void input;
      return { successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: "messaging/registration-token-not-registered" } }] };
    });
    const remove = vi.fn(async () => undefined);
    const database = { doc: vi.fn(() => ({ delete: remove })) };
    await sendMessageToDevices(
      { sendEachForMulticast } as never,
      database as never,
      { id: "notif-a", type: "message", recipientRole: event === "school_message_received" ? "parent" : "school", schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a", schoolRecipient: event === "parent_message_received" ? "admin" : undefined, messageId: "message-a" },
      { event, parentId: "parent-a", schoolRecipient: event === "parent_message_received" ? "admin" : undefined, recipients: [{ userId: "user-a", tokens: [{ id: "token-a", userId: "user-a", token: "secret-token", active: true }] }] },
    );
    const payload = sendEachForMulticast.mock.calls[0]?.[0] as { notification: unknown; data: Record<string, string> };
    expect(payload.notification).toEqual({ title, body });
    expect(payload.data).toMatchObject({ module: "messages", event, destination: "/dashboard", notificationId: "notif-a", messageId: "message-a" });
    expect(JSON.stringify(payload)).not.toContain("corps complet");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("remonte un échec FCM temporaire pour permettre la reprise du dispatch", async () => {
    const sendEachForMulticast = vi.fn(async () => ({ successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: "messaging/internal-error" } }] }));
    const remove = vi.fn();
    await expect(sendMessageToDevices(
      { sendEachForMulticast } as never,
      { doc: vi.fn(() => ({ delete: remove })) } as never,
      { id: "notif-a", type: "message", recipientRole: "parent", schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a", messageId: "message-a" },
      { event: "school_message_received", parentId: "parent-a", recipients: [{ userId: "user-a", tokens: [{ id: "token-a", userId: "user-a", token: "token-a", active: true }] }] },
    )).rejects.toThrow("Échec FCM temporaire");
    expect(remove).not.toHaveBeenCalled();
  });
});
