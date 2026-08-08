import { describe, expect, it, vi } from "vitest";
import { MAX_TOTAL_BYTES, resolveRecipients, verifyAndMoveAttachments } from "./send-school-message.js";

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
    await expect(resolveRecipients(database({ unknown: { role: "teacher", schoolId: "school-a" } }), { role: "secretary", schoolId: "school-a" }, ["teacher"], ["unknown"])).rejects.toMatchObject({ code: "invalid-recipient" });
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
});
