import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { administrativeSenderDetails, formatAdministrativeSender, sentMessageRecipientLabel } from "./administrativeSender";
import type { Message } from "../types";

const message = (changes: Partial<Message>) => ({ id: "m", schoolId: "s", schoolYearId: "y", senderId: "a", recipientParentId: "school", subject: "x", body: "y", createdAt: "", ...changes }) as Message;

describe("lot 25 : messages envoyés et Équipe ACADÉA", () => {
  it("affiche « Équipe ACADÉA » sans répéter le rôle", () => {
    expect(administrativeSenderDetails(message({ senderRole: "super_admin", senderName: "Nom technique" }))).toEqual({ name: "Équipe ACADÉA", role: "" });
    expect(formatAdministrativeSender(message({ senderRole: "super_admin" }))).toBe("Équipe ACADÉA");
  });
  it("« À : » : libellé enregistré, sinon noms et rôles connus, sinon le nombre", () => {
    expect(sentMessageRecipientLabel(message({ recipientLabel: "412 parents" }), [])).toBe("412 parents");
    const users = [{ id: "u1", name: "Marie Kabila", role: "cashier" as const }, { id: "sa", name: "x", role: "super_admin" as const }];
    expect(sentMessageRecipientLabel(message({ recipientIds: ["u1", "sa"] }), users)).toBe("Marie Kabila (Caissier), Équipe ACADÉA");
    expect(sentMessageRecipientLabel(message({ recipientIds: ["x", "y"] }), users)).toBe("2 destinataires");
  });
  it("le fil affiche « À : … » sur les messages envoyés, pour tous les rôles", () => {
    const feed = readFileSync(new URL("../components/messages/MessageDrawerContent.tsx", import.meta.url), "utf8");
    expect(feed).toContain("message.senderId === user.id && sentMessageRecipientLabel(");
    expect(feed).toContain(">À : {sentMessageRecipientLabel(");
  });
  it("parent : réglage des notifications dans son Menu, « Plus tard » propre à chaque compte ; icône monochrome sur le téléphone", () => {
    expect(readFileSync(new URL("../modules/parent/ParentPortal.tsx", import.meta.url), "utf8")).toContain("<PushNotificationSettings user={user} />");
    const prompt = readFileSync(new URL("../components/notifications/PushNotificationPrompt.tsx", import.meta.url), "utf8");
    expect(prompt).toContain("`${PUSH_PROMPT_SNOOZE_KEY}:${userId}`");
    const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    expect(sw).toContain('badge: "/icons/notification-badge.png"');
    expect(sw).toContain('icon: "/icons/icon-192.png"');
  });
  it("Super administrateur : actualisation et cloche dans l'en-tête, boîte de messagerie depuis la cloche", () => {
    const platform = readFileSync(new URL("../modules/platform/PlatformModule.tsx", import.meta.url), "utf8");
    expect(platform).toContain('aria-label="Boîte à Messagerie"');
    expect(platform).toContain('onClick={() => onRefresh?.()}');
    expect(platform).toContain("<MessagingDrawerShell onClose={() => setMessagingOpen(false)}><PlatformMessages");
  });
});
