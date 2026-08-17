import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The Vercel handler is intentionally implemented in JavaScript.
import { assertAttachmentSenderRole, createSchoolMessageDocument, MAX_TOTAL_BYTES, resolveRecipients, verifyAndMoveAttachments } from "../../api/send-school-message.js";

function database(users: Record<string, Record<string, unknown>>) {
  return {
    doc: (path: string) => ({ path }),
    getAll: vi.fn(async (...refs: Array<{ path: string }>) => refs.map((ref) => {
      const id = ref.path.split("/").at(-1) ?? "";
      return { id, exists: Boolean(users[id]), data: () => users[id] };
    })),
  };
}

function bucketWith(files: Record<string, { size: number; type: string; metadata?: Record<string, string> }>) {
  const file = (path: string) => ({
    getMetadata: vi.fn(async () => [{ size: String(files[path]?.size ?? 0), contentType: files[path]?.type, metadata: files[path]?.metadata ?? {} }]),
    copy: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  });
  return { name: "bucket.test", file };
}

describe("API de messagerie scolaire", () => {
  it("résout uniquement des destinataires réels, actifs et de la même école", async () => {
    const db = database({ admin: { role: "school_admin", schoolId: "school-a", status: "active" }, cashier: { role: "cashier", schoolId: "school-a", active: true } });
    const recipients = await resolveRecipients(db, { role: "secretary", schoolId: "school-a" }, ["school_admin", "cashier"], ["admin", "cashier"]);
    expect(recipients.map((item: { id: string }) => item.id)).toEqual(["admin", "cashier"]);
  });

  it("refuse un rôle inconnu, un destinataire inexistant ou une autre école", async () => {
    await expect(resolveRecipients(database({ unknown: { role: "unknown", schoolId: "school-a" } }), { role: "secretary", schoolId: "school-a" }, ["unknown"], ["unknown"])).rejects.toMatchObject({ code: "invalid-recipient" });
    await expect(resolveRecipients(database({}), { role: "secretary", schoolId: "school-a" }, ["cashier"], ["missing"])).rejects.toMatchObject({ code: "invalid-recipient" });
    await expect(resolveRecipients(database({ cashier: { role: "cashier", schoolId: "school-b" } }), { role: "secretary", schoolId: "school-a" }, ["cashier"], ["cashier"])).rejects.toMatchObject({ code: "invalid-recipient" });
  });

  it("accepte exactement 10 Mo d'après Storage et refuse le dépassement ou les métadonnées falsifiées", async () => {
    const caller = { uid: "secretary-a", schoolId: "school-a" };
    const draftId = "draft-a";
    const first = `message-uploads/school-a/secretary-a/${draftId}/123e4567-e89b-42d3-a456-426614174000.pdf`;
    const second = `message-uploads/school-a/secretary-a/${draftId}/223e4567-e89b-42d3-a456-426614174000.pdf`;
    const metadata = { schoolId: "school-a", schoolYearId: "year-a", senderId: "secretary-a", draftId, originalName: "document.pdf" };
    await expect(verifyAndMoveAttachments(bucketWith({ [first]: { size: MAX_TOTAL_BYTES / 2, type: "application/pdf", metadata }, [second]: { size: MAX_TOTAL_BYTES / 2, type: "application/pdf", metadata } }), caller, "year-a", draftId, [{ path: first }, { path: second }], "conversation-a", "message-a")).resolves.toHaveLength(2);
    await expect(verifyAndMoveAttachments(bucketWith({ [first]: { size: MAX_TOTAL_BYTES, type: "application/pdf", metadata }, [second]: { size: 1, type: "application/pdf", metadata } }), caller, "year-a", draftId, [{ path: first }, { path: second }], "conversation-a", "message-a")).rejects.toMatchObject({ code: "attachments-too-large" });
    await expect(verifyAndMoveAttachments(bucketWith({ [first]: { size: 10, type: "application/pdf", metadata: { ...metadata, schoolId: "school-b" } } }), caller, "year-a", draftId, [{ path: first }], "conversation-a", "message-a")).rejects.toMatchObject({ code: "invalid-attachments" });
  });
  it("impose l'identite authentifiee dans le document persiste", () => {
    const attachments = [{ name: "document.pdf", type: "application/pdf", size: 10, path: "messages/school-a/conversation-a/message-a/file.pdf", url: "https://storage.test/file" }];
    const document = createSchoolMessageDocument({
      messageId: "message-a",
      caller: { uid: "secretary-a", schoolId: "school-a", role: "secretary", profile: { name: "Marie Kabeya" } },
      schoolYearId: "year-a",
      recipients: [{ id: "admin-a" }, { id: "cashier-a" }],
      participantIds: ["secretary-a", "admin-a", "cashier-a"],
      conversationId: "conversation-a",
      subject: "Objet",
      messageBody: "Corps",
      attachments,
      createdAt: "2026-08-09T10:00:00.000Z",
    });
    expect(document).toMatchObject({ senderId: "secretary-a", senderName: "Marie Kabeya", senderRole: "secretary", schoolId: "school-a", recipientIds: ["admin-a", "cashier-a"] });
    expect(document.attachments).toEqual(attachments);
  });

  it("réserve les pièces jointes au Secrétaire sans bloquer les messages sans fichier", () => {
    expect(() => assertAttachmentSenderRole({ role: "secretary" }, [{ path: "temp.pdf" }])).not.toThrow();
    expect(() => assertAttachmentSenderRole({ role: "school_admin" }, [])).not.toThrow();
    expect(() => assertAttachmentSenderRole({ role: "school_admin" }, [{ path: "temp.pdf" }])).toThrowError(expect.objectContaining({ code: "attachments-forbidden", statusCode: 403 }));
  });

  it("supprime les copies finales si un traitement serveur echoue", async () => {
    const draftId = "draft-rollback";
    const first = `message-uploads/school-a/secretary-a/${draftId}/123e4567-e89b-42d3-a456-426614174000.pdf`;
    const second = `message-uploads/school-a/secretary-a/${draftId}/223e4567-e89b-42d3-a456-426614174000.pdf`;
    const metadata = { schoolId: "school-a", schoolYearId: "year-a", senderId: "secretary-a", draftId, originalName: "document.pdf" };
    const deleteFinal = vi.fn(async () => undefined);
    let copies = 0;
    const bucket = {
      name: "bucket.test",
      file: (path: string) => ({
        getMetadata: vi.fn(async () => [{ size: "10", contentType: "application/pdf", metadata }]),
        copy: vi.fn(async () => { copies += 1; if (copies === 2) throw new Error("copy failed"); }),
        delete: path.startsWith("messages/") ? deleteFinal : vi.fn(async () => undefined),
      }),
    };
    await expect(verifyAndMoveAttachments(bucket, { uid: "secretary-a", schoolId: "school-a" }, "year-a", draftId, [{ path: first }, { path: second }], "conversation-a", "message-a")).rejects.toThrow("copy failed");
    expect(deleteFinal).toHaveBeenCalledTimes(1);
  });
});
