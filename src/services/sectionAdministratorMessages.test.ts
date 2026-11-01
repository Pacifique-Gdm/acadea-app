import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Vercel helper is implemented in JavaScript.
import { listAllowedMessageRecipients } from "../../api/_lib/messageRecipients.js";
// @ts-expect-error Vercel endpoint is implemented in JavaScript.
import { createSchoolMessageDocument, resolveRecipients } from "../../api/send-school-message.js";

const caller = { uid: "section-a", role: "primary_admin", schoolId: "school-a",
  profile: { role: "primary_admin", schoolId: "school-a", status: "active", sectionIds: ["Primaire"] } };

function database(overrides: Record<string, Record<string, unknown>> = {}) {
  const documents: Record<string, Record<string, unknown>> = {
    "users/section-a": { role: "primary_admin", schoolId: "school-a", status: "active", sectionIds: ["Primaire"] },
    "schoolYears/year-a": { schoolId: "school-a", status: "active" },
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
    ...overrides,
  };
  const snapshot = (path: string) => ({ id: path.split("/").at(-1), exists: Boolean(documents[path]), data: () => documents[path] });
  const db = {
    doc: (path: string) => ({ path, get: vi.fn(async () => snapshot(path)) }),
    getAll: vi.fn(async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path))),
    collection: vi.fn((name: string) => ({
      where: (field: string, _operator: string, value: string) => ({
        where: (secondField: string, _secondOperator: string, secondValue: string) => ({
          get: async () => ({ docs: Object.entries(documents).filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value && data[secondField] === secondValue).map(([path]) => snapshot(path)) }),
        }),
        get: async () => ({ docs: Object.entries(documents).filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).map(([path]) => snapshot(path)) }),
      }),
    })),
  };
  return db;
}

describe("destinataires des administrateurs de section", () => {
  it("retourne un annuaire borné à la section et refuse la fratrie mixte", async () => {
    const db = database();
    const recipients = await listAllowedMessageRecipients(db, caller, "year-a");
    expect(recipients.map((recipient: { uid: string }) => recipient.uid).sort()).toEqual(["admin", "parent-primary", "teacher-primary"]);
    expect(recipients.find((recipient: { uid: string }) => recipient.uid === "parent-primary")?.sections).toEqual(["Primaire"]);
    expect(db.collection).toHaveBeenCalledTimes(2);
  });

  it("révoque immédiatement l'annuaire si le profil actif est désactivé", async () => {
    const db = database({ "users/section-a": { role: "primary_admin", schoolId: "school-a", status: "inactive", sectionIds: ["Primaire"] } });
    await expect(listAllowedMessageRecipients(db, caller, "year-a"))
      .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("refuse un identifiant d'élève malformé sans lecture hors collection", async () => {
    const db = database({ "parents/parent-a": { schoolId: "school-a", studentIds: ["../foreign"] } });
    const recipients = await listAllowedMessageRecipients(db, caller, "year-a");
    expect(recipients.map((recipient: { uid: string }) => recipient.uid)).not.toContain("parent-primary");
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
