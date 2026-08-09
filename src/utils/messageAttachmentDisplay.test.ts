import { describe, expect, it } from "vitest";
import type { Message } from "../types";
import { getDisplayableMessageAttachments } from "./messageAttachmentDisplay";

function message(attachments?: Message["attachments"]): Message {
  return { id: "message-a", schoolId: "school-a", schoolYearId: "year-a", senderId: "secretary-a", recipientParentId: "school", conversationId: "conversation-a", subject: "Objet", body: "Corps", createdAt: "2026-08-09T10:00:00.000Z", attachments };
}

describe("affichage des pièces jointes de messagerie", () => {
  it("conserve toutes les pièces jointes finales valides dans leur ordre", () => {
    const attachments = [
      { name: "document.pdf", type: "application/pdf", size: 1200, path: "messages/school-a/conversation-a/message-a/123e4567-e89b-42d3-a456-426614174000.pdf", url: "https://example.invalid/ignored" },
      { name: "photo.png", type: "image/png", size: 800, path: "messages/school-a/conversation-a/message-a/223e4567-e89b-42d3-a456-426614174000.png", url: "https://example.invalid/ignored" },
    ];
    expect(getDisplayableMessageAttachments(message(attachments))).toEqual(attachments);
  });

  it("reste compatible avec les anciens messages sans pièce jointe", () => {
    expect(getDisplayableMessageAttachments(message())).toEqual([]);
  });

  it("refuse les chemins d'un autre message, d'une autre école et les types falsifiés", () => {
    expect(getDisplayableMessageAttachments(message([
      { name: "autre.pdf", type: "application/pdf", size: 10, path: "messages/school-a/conversation-a/message-b/file.pdf", url: "" },
      { name: "autre-école.pdf", type: "application/pdf", size: 10, path: "messages/school-b/conversation-a/message-a/file.pdf", url: "" },
      { name: "fichier.png", type: "text/html", size: 10, path: "messages/school-a/conversation-a/message-a/file.png", url: "" },
    ]))).toEqual([]);
  });
});
