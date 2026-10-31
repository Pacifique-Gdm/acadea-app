import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Vercel helper is implemented in JavaScript.
import { listAllowedMessageRecipients } from "../../api/_lib/messageRecipients.js";
// @ts-expect-error Vercel endpoint is implemented in JavaScript.
import { createSchoolMessageDocument, resolveRecipients } from "../../api/send-school-message.js";

const caller = { uid: "section-a", role: "primary_admin", schoolId: "school-a",
  profile: { role: "primary_admin", schoolId: "school-a", status: "active", sectionIds: ["Primaire"] } };

function database() {
  const documents: Record<string, Record<string, unknown>> = {
    "users/parent-primary": { role: "parent", parentId: "parent-a", schoolId: "school-a", status: "active" },
    "users/parent-mixed": { role: "parent", parentId: "parent-b", schoolId: "school-a", status: "active" },
    "users/teacher-primary": { role: "teacher", schoolId: "school-a", sectionIds: ["Primaire"], status: "active" },
    "users/teacher-secondary": { role: "teacher", schoolId: "school-a", sectionIds: ["Secondaire"], status: "active" },
    "users/admin": { role: "school_admin", schoolId: "school-a", status: "active" },
    "users/foreign": { role: "school_admin", schoolId: "school-b", status: "active" },
    "parents/parent-a": { schoolId: "school-a", studentIds: ["student-primary"] },
    "parents/parent-b": { schoolId: "school-a", studentIds: ["student-primary", "student-secondary"] },
    "students/student-primary": { schoolId: "school-a", schoolYearId: "year-a", section: "Primaire" },
    "students/student-secondary": { schoolId: "school-a", schoolYearId: "year-a", section: "Secondaire" },
  };
  const snapshot = (path: string) => ({ id: path.split("/").at(-1), exists: Boolean(documents[path]), data: () => documents[path] });
  const db = {
    doc: (path: string) => ({ path, get: vi.fn(async () => snapshot(path)) }),
    getAll: vi.fn(async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path))),
    collection: vi.fn(() => { throw new Error("Lecture globale interdite pour l'annuaire de section."); }),
  };
  return db;
}

describe("destinataires des administrateurs de section", () => {
  it("refuse l'annuaire global avant toute requête", async () => {
    const db = database();
    await expect(listAllowedMessageRecipients(db, caller, "year-a"))
      .rejects.toMatchObject({ statusCode: 403, code: "not-authorized" });
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("autorise un parent entièrement lié à la section et refuse une fratrie mixte", async () => {
    const db = database();
    await expect(resolveRecipients(db, caller, ["parent"], ["parent-primary"], "year-a", "Primaire"))
      .resolves.toHaveLength(1);
    await expect(resolveRecipients(db, caller, ["parent"], ["parent-mixed"], "year-a", "Primaire"))
      .rejects.toMatchObject({ statusCode: 403, code: "invalid-recipient" });
  });

  it("refuse une section non attribuée, un personnel hors section et une école étrangère", async () => {
    const db = database();
    await expect(resolveRecipients(db, caller, ["parent"], ["parent-primary"], "year-a", "Secondaire"))
      .rejects.toMatchObject({ statusCode: 403, code: "invalid-recipient" });
    await expect(resolveRecipients(db, caller, ["teacher"], ["teacher-secondary"], "year-a", "Primaire"))
      .rejects.toMatchObject({ statusCode: 403, code: "invalid-recipient" });
    await expect(resolveRecipients(db, caller, ["school_admin"], ["foreign"], "year-a", "Primaire"))
      .rejects.toMatchObject({ statusCode: 403, code: "invalid-recipient" });
    await expect(resolveRecipients(db, caller, ["teacher"], ["teacher-primary"], "year-a", "Primaire"))
      .resolves.toHaveLength(1);
    await expect(resolveRecipients(db, caller, ["school_admin"], ["admin"], "year-a", "Primaire"))
      .resolves.toHaveLength(1);
  });

  it("annote le message serveur avec la section validée", () => {
    const message = createSchoolMessageDocument({ messageId: "msg-a", caller, schoolYearId: "year-a", recipients: [{ id: "parent-primary" }],
      participantIds: [caller.uid, "parent-primary"], conversationId: "conv-a", subject: "Information", messageBody: "Bonjour", attachments: [],
      createdAt: "2026-10-31T12:00:00.000Z", messageSection: "Primaire" });
    expect(message).toMatchObject({ schoolId: "school-a", section: "Primaire", senderId: "section-a" });
  });
});
