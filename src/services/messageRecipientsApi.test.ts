import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The Vercel helper is intentionally implemented in JavaScript.
import { listAllowedMessageRecipients, requireMessagingCaller } from "../../api/_lib/messageRecipients.js";
// @ts-expect-error The Vercel handler is intentionally implemented in JavaScript.
import messageRecipientsHandler from "../../api/message-recipients.js";

type Profile = Record<string, unknown>;

function database(profiles: Record<string, Profile>) {
  return {
    doc: (path: string) => ({
      get: vi.fn(async () => {
        const uid = path.split("/").pop() ?? "";
        return { exists: Boolean(profiles[uid]), data: () => profiles[uid] };
      }),
    }),
    collection: vi.fn(() => ({
      where: vi.fn((_field: string, _operator: string, schoolId: string) => ({
        get: vi.fn(async () => ({
          docs: Object.entries(profiles)
            .filter(([, profile]) => profile.schoolId === schoolId)
            .map(([id, profile]) => ({ id, data: () => profile })),
        })),
      })),
    })),
  };
}

function authFor(decoded: Profile) {
  return { verifyIdToken: vi.fn(async () => decoded) };
}

describe("annuaire sécurisé des destinataires de messagerie", () => {
  it("refuse une requête non authentifiée avant toute initialisation Admin", async () => {
    const response = { statusCode: 0, headers: {} as Record<string, string>, body: "", setHeader(name: string, value: string) { this.headers[name] = value; }, end(value: string) { this.body = value; } };
    await messageRecipientsHandler({ method: "GET", headers: {} }, response);
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ error: "not-authenticated" });
  });

  it("refuse un rôle inconnu et un profil inactif", async () => {
    await expect(requireMessagingCaller(authFor({ uid: "teacher", role: "teacher", schoolId: "school-a" }), database({ teacher: { role: "teacher", schoolId: "school-a", status: "active" } }), "token")).rejects.toMatchObject({ code: "not-authorized" });
    await expect(requireMessagingCaller(authFor({ uid: "secretary", role: "secretary", schoolId: "school-a" }), database({ secretary: { role: "secretary", schoolId: "school-a", status: "inactive" } }), "token")).rejects.toMatchObject({ code: "not-authorized" });
  });

  it("retourne au Secrétaire uniquement Admin, Caissier, Discipline et Parents actifs de son école", async () => {
    const recipients = await listAllowedMessageRecipients(database({
      secretary: { name: "Secrétaire", role: "secretary", schoolId: "school-a", status: "active" },
      admin: { name: "Admin", role: "admin", schoolId: "school-a", status: "active", email: "private@test", phone: "secret", claims: { admin: true } },
      cashier: { displayName: "Caissier", role: "cashier", schoolId: "school-a", active: true },
      discipline: { name: "Discipline", role: "discipline_director", schoolId: "school-a", status: "active" },
      study: { name: "Études", role: "study_director", schoolId: "school-a", status: "active" },
      parent: { name: "Parent", role: "parent", schoolId: "school-a", status: "active" },
      inactive: { name: "Inactif", role: "cashier", schoolId: "school-a", status: "inactive" },
      otherSchool: { name: "Autre école", role: "school_admin", schoolId: "school-b", status: "active" },
      teacher: { name: "Enseignant", role: "teacher", schoolId: "school-a", status: "active" },
    }), { uid: "secretary", role: "secretary", schoolId: "school-a" });
    expect(recipients.map((recipient: { role: string }) => recipient.role).sort()).toEqual(["cashier", "discipline_director", "parent", "school_admin", "study_director"]);
    expect(recipients.some((recipient: { name: string }) => recipient.name === "Autre école")).toBe(false);
    expect(recipients.every((recipient: Record<string, unknown>) => Object.keys(recipient).sort().join(",") === "name,role,uid")).toBe(true);
  });

  it("inclut le Directeur des études actif de la même école", async () => {
    const recipients = await listAllowedMessageRecipients(database({
      caller: { name: "Secrétaire", role: "secretary", schoolId: "school-a", status: "active" },
      study: { name: "Directeur des études", role: "study_director", schoolId: "school-a", status: "active" },
      external: { name: "Directeur externe", role: "study_director", schoolId: "school-b", status: "active" },
      inactive: { name: "Directeur inactif", role: "study_director", schoolId: "school-a", status: "inactive" },
    }), { uid: "caller", role: "secretary", schoolId: "school-a" });
    expect(recipients).toContainEqual({ uid: "study", name: "Directeur des études", role: "study_director" });
    expect(recipients.map((item: { uid: string }) => item.uid)).not.toEqual(expect.arrayContaining(["external", "inactive"]));
  });

  it.each(["school_admin", "cashier", "discipline_director"])("retourne chaque Secrétaire séparément au rôle %s", async (role) => {
    const recipients = await listAllowedMessageRecipients(database({
      caller: { name: "Appelant", role, schoolId: "school-a", status: "active" },
      secretary1: { name: "Secrétaire A", role: "secretary", schoolId: "school-a", status: "active" },
      secretary2: { name: "Secrétaire B", role: "secretary", schoolId: "school-a", status: "active" },
      other: { name: "Secrétaire externe", role: "secretary", schoolId: "school-b", status: "active" },
    }), { uid: "caller", role, schoolId: "school-a" });
    expect(recipients).toEqual([
      { uid: "secretary1", name: "Secrétaire A", role: "secretary" },
      { uid: "secretary2", name: "Secrétaire B", role: "secretary" },
    ]);
  });
});
