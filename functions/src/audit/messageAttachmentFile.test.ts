import { describe, expect, it } from "vitest";
import { assertMessageAttachmentAccess } from "./messageAttachmentFile.js";

const path = "messages/school-a/conversation-a/message-a/123e4567-e89b-42d3-a456-426614174000.pdf";
const identity = { uid: "parent-user", role: "parent", schoolId: "school-a", parentId: undefined, coordinationId: undefined, subCoordinationId: undefined };
const profile = { role: "parent", schoolId: "school-a", parentId: "parent-a", status: "active", active: true };
const school = { status: "active" };
const message = { id: "message-a", schoolId: "school-a", conversationId: "conversation-a", participantIds: ["parent-user", "secretary-a"], attachments: [{ name: "document.pdf", type: "application/pdf", size: 42, path }] };

describe("accès serveur aux pièces jointes de messages", () => {
  it("autorise le Parent historique sans claim à lire son propre message", () => {
    expect(assertMessageAttachmentAccess(identity, profile, school, message, "message-a", path).path).toBe(path);
  });
  it("refuse un claim Parent discordant, même si le profil est actif", () => {
    expect(() => assertMessageAttachmentAccess({ ...identity, parentId: "parent-b" }, profile, school, message, "message-a", path)).toThrow();
  });
  it("refuse le transfert, la désactivation et l'école suspendue", () => {
    expect(() => assertMessageAttachmentAccess(identity, { ...profile, schoolId: "school-b" }, school, message, "message-a", path)).toThrow();
    expect(() => assertMessageAttachmentAccess(identity, { ...profile, active: false }, school, message, "message-a", path)).toThrow();
    expect(() => assertMessageAttachmentAccess(identity, profile, { status: "suspended" }, message, "message-a", path)).toThrow();
  });
  it("refuse un non-participant et un chemin d'une autre école ou d'un autre message", () => {
    expect(() => assertMessageAttachmentAccess({ ...identity, uid: "stranger" }, profile, school, message, "message-a", path)).toThrow();
    expect(() => assertMessageAttachmentAccess(identity, profile, school, message, "message-a", path.replace("school-a", "school-b"))).toThrow();
    expect(() => assertMessageAttachmentAccess(identity, profile, school, message, "message-b", path)).toThrow();
  });
  it("refuse une pièce absente du document et un type ou une taille incohérents", () => {
    expect(() => assertMessageAttachmentAccess(identity, profile, school, { ...message, attachments: [] }, "message-a", path)).toThrow();
    expect(() => assertMessageAttachmentAccess(identity, profile, school, { ...message, attachments: [{ ...message.attachments[0], type: "text/html" }] }, "message-a", path)).toThrow();
    expect(() => assertMessageAttachmentAccess(identity, profile, school, { ...message, attachments: [{ ...message.attachments[0], size: 0 }] }, "message-a", path)).toThrow();
  });
});
