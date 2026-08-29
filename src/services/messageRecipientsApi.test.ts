import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The Vercel helper is intentionally implemented in JavaScript.
import { isRelatedCoordinationRecipient, listAllowedMessageRecipients, requireMessagingCaller } from "../../api/_lib/messageRecipients.js";
// @ts-expect-error The Vercel handler is intentionally implemented in JavaScript.
import messageRecipientsHandler from "../../api/message-recipients.js";
// @ts-expect-error The Vercel handler is intentionally implemented in JavaScript.
import { resolveRecipients } from "../../api/send-school-message.js";

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

function coordinationDatabase(documents: Record<string, Profile>) {
  const snapshot = (path: string) => ({
    id: path.split("/").pop() ?? "",
    path,
    exists: Boolean(documents[path]),
    data: () => documents[path],
  });
  return {
    doc: (path: string) => ({ path, get: vi.fn(async () => snapshot(path)) }),
    getAll: vi.fn(async (...references: { path: string }[]) => references.map((reference) => snapshot(reference.path))),
    collection: (name: string) => {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        where: (field: string, _operator: string, value: unknown) => { filters.push([field, value]); return builder; },
        get: vi.fn(async () => ({
          docs: Object.entries(documents)
            .filter(([path, value]) => path.startsWith(`${name}/`) && path.split("/").length === 2 && filters.every(([field, expected]) => value[field] === expected))
            .map(([path]) => snapshot(path)),
        })),
      };
      return builder;
    },
  };
}

describe("annuaire sécurisé des destinataires de messagerie", () => {
  it("refuse une requête non authentifiée avant toute initialisation Admin", async () => {
    const response = { statusCode: 0, headers: {} as Record<string, string>, body: "", setHeader(name: string, value: string) { this.headers[name] = value; }, end(value: string) { this.body = value; } };
    await messageRecipientsHandler({ method: "GET", headers: {} }, response);
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ error: "not-authenticated" });
  });

  it("refuse un rôle inconnu et un profil inactif", async () => {
    await expect(requireMessagingCaller(authFor({ uid: "unknown", role: "unknown", schoolId: "school-a" }), database({ unknown: { role: "unknown", schoolId: "school-a", status: "active" } }), "token")).rejects.toMatchObject({ code: "not-authorized" });
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
    expect(recipients.map((recipient: { role: string }) => recipient.role).sort()).toEqual(["cashier", "discipline_director", "parent", "school_admin", "study_director", "teacher"]);
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

  it("inclut uniquement les enseignants actifs de la même école", async () => {
    const recipients = await listAllowedMessageRecipients(database({
      caller: { name: "Secrétaire", role: "secretary", schoolId: "school-a", status: "active" },
      teacher: { name: "Enseignant A", role: "teacher", schoolId: "school-a", status: "active" },
      inactive: { name: "Enseignant inactif", role: "teacher", schoolId: "school-a", status: "inactive" },
      external: { name: "Enseignant externe", role: "teacher", schoolId: "school-b", status: "active" },
    }), { uid: "caller", role: "secretary", schoolId: "school-a" });
    expect(recipients).toContainEqual({ uid: "teacher", name: "Enseignant A", role: "teacher" });
    expect(recipients.map((item: { uid: string }) => item.uid)).not.toEqual(expect.arrayContaining(["inactive", "external"]));
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

  it("ajoute au seul Administrateur de l'école les Coordinateurs réellement reliés", async () => {
    const db = coordinationDatabase({
      "schools/school-a": { activeCoordinationId: "coord-a", status: "active" },
      "coordinations/coord-a": { status: "active", principalCoordinatorUserId: "coord-user" },
      "coordinationSchools/coord-a__school-a": { coordinationId: "coord-a", schoolId: "school-a", active: true },
      "subCoordinations/sub-a": { coordinationId: "coord-a", coordinatorUserId: "sub-user", active: true, status: "active" },
      "subCoordinationSchools/sub-a__school-a": { coordinationId: "coord-a", subCoordinationId: "sub-a", schoolId: "school-a", active: true },
      "users/admin": { name: "Administrateur", role: "school_admin", schoolId: "school-a", status: "active" },
      "users/coord-user": { name: "Coordinateur", role: "coordination_admin", coordinationId: "coord-a", status: "active" },
      "users/sub-user": { name: "Sous-coordinateur", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", status: "active" },
      "users/foreign": { name: "Coordination étrangère", role: "coordination_admin", coordinationId: "coord-b", status: "active" },
    });
    const caller = { uid: "admin", role: "school_admin", schoolId: "school-a" };
    const recipients = await listAllowedMessageRecipients(db, caller);
    expect(recipients).toEqual(expect.arrayContaining([
      { uid: "coord-user", name: "Coordinateur", role: "coordination_admin" },
      { uid: "sub-user", name: "Sous-coordinateur", role: "sub_coordination_admin" },
    ]));
    expect(recipients.map((item: { uid: string }) => item.uid)).not.toContain("foreign");
    expect(await isRelatedCoordinationRecipient(db, caller, { id: "foreign", ...documentsForForeign() })).toBe(false);
  });

  it("distingue une école directement rattachée d'une école sous Sous-coordination", async () => {
    const directDb = coordinationDatabase({
      "schools/school-direct": { activeCoordinationId: "coord-a", status: "active" },
      "coordinations/coord-a": { status: "active", principalCoordinatorUserId: "coord-user" },
      "coordinationSchools/coord-a__school-direct": { coordinationId: "coord-a", schoolId: "school-direct", active: true },
      "users/admin-direct": { name: "Administrateur direct", role: "school_admin", schoolId: "school-direct", status: "active" },
      "users/coord-user": { name: "Coordinateur", role: "coordination_admin", coordinationId: "coord-a", status: "active" },
      "users/sub-user": { name: "Sous-coordinateur", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", status: "active" },
    });
    const direct = await listAllowedMessageRecipients(directDb, { uid: "admin-direct", role: "school_admin", schoolId: "school-direct" });
    expect(direct).toContainEqual({ uid: "coord-user", name: "Coordinateur", role: "coordination_admin" });
    expect(direct.map((item: { uid: string }) => item.uid)).not.toContain("sub-user");

    const delegatedDb = coordinationDatabase({
      "schools/school-delegated": { activeCoordinationId: "coord-a", status: "active" },
      "coordinations/coord-a": { status: "active", principalCoordinatorUserId: "coord-user" },
      "coordinationSchools/coord-a__school-delegated": { coordinationId: "coord-a", schoolId: "school-delegated", active: true },
      "subCoordinations/sub-a": { coordinationId: "coord-a", coordinatorUserId: "sub-user", active: true, status: "active" },
      "subCoordinationSchools/sub-a__school-delegated": { coordinationId: "coord-a", subCoordinationId: "sub-a", schoolId: "school-delegated", active: true },
      "users/admin-delegated": { name: "Administrateur délégué", role: "school_admin", schoolId: "school-delegated", status: "active" },
      "users/coord-user": { name: "Coordinateur", role: "coordination_admin", coordinationId: "coord-a", status: "active" },
      "users/sub-user": { name: "Sous-coordinateur", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", status: "active" },
    });
    const delegated = await listAllowedMessageRecipients(delegatedDb, { uid: "admin-delegated", role: "school_admin", schoolId: "school-delegated" });
    expect(delegated).toEqual(expect.arrayContaining([
      { uid: "coord-user", name: "Coordinateur", role: "coordination_admin" },
      { uid: "sub-user", name: "Sous-coordinateur", role: "sub_coordination_admin" },
    ]));
  });

  it("exclut les responsables inactifs même quand le rattachement est valide", async () => {
    const db = coordinationDatabase({
      "schools/school-a": { activeCoordinationId: "coord-a", status: "active" },
      "coordinations/coord-a": { status: "active", principalCoordinatorUserId: "coord-user" },
      "coordinationSchools/coord-a__school-a": { coordinationId: "coord-a", schoolId: "school-a", active: true },
      "subCoordinations/sub-a": { coordinationId: "coord-a", coordinatorUserId: "sub-user", active: true, status: "active" },
      "subCoordinationSchools/sub-a__school-a": { coordinationId: "coord-a", subCoordinationId: "sub-a", schoolId: "school-a", active: true },
      "users/admin": { name: "Administrateur", role: "school_admin", schoolId: "school-a", status: "active" },
      "users/coord-user": { name: "Coordinateur inactif", role: "coordination_admin", coordinationId: "coord-a", status: "inactive" },
      "users/sub-user": { name: "Sous-coordinateur inactif", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", active: false },
    });
    const recipients = await listAllowedMessageRecipients(db, { uid: "admin", role: "school_admin", schoolId: "school-a" });
    expect(recipients.map((item: { uid: string }) => item.uid)).not.toEqual(expect.arrayContaining(["coord-user", "sub-user"]));
  });

  it("autorise l'envoi au Coordinateur relié et refuse la Coordination étrangère", async () => {
    const documents = {
      "schools/school-a": { activeCoordinationId: "coord-a", status: "active" },
      "coordinations/coord-a": { status: "active", principalCoordinatorUserId: "coord-user" },
      "coordinationSchools/coord-a__school-a": { coordinationId: "coord-a", schoolId: "school-a", active: true },
      "users/coord-user": { name: "Coordinateur", role: "coordination_admin", coordinationId: "coord-a", status: "active" },
      "users/foreign": { name: "Autre", role: "coordination_admin", coordinationId: "coord-b", status: "active" },
    };
    const db = coordinationDatabase(documents);
    const caller = { uid: "admin", role: "school_admin", schoolId: "school-a" };
    await expect(resolveRecipients(db, caller, ["coordination_admin"], ["coord-user"], "year-a")).resolves.toHaveLength(1);
    await expect(resolveRecipients(db, caller, ["coordination_admin"], ["foreign"], "year-a")).rejects.toMatchObject({ code: "invalid-recipient", statusCode: 403 });
  });
});

function documentsForForeign() {
  return { name: "Coordination étrangère", role: "coordination_admin", coordinationId: "coord-b", status: "active" };
}
