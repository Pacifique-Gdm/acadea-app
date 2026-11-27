import { beforeEach, describe, expect, it, vi } from "vitest";

// Lots 10 et 11 (décision de l'utilisateur) : un conseiller a toujours au moins une section.
// Le serveur refuse la création d'un conseiller sans section et le retrait de toutes ses sections.

const harness = vi.hoisted(() => ({
  createUser: vi.fn(async () => ({ uid: "nouveau" })),
  writes: [] as Array<{ path: string; data: Record<string, unknown> }>,
}));

vi.mock("../../api/_lib/firebaseAdmin.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  initAdmin: () => ({
    auth: { createUser: harness.createUser, getUser: async () => ({}), updateUser: async () => undefined, setCustomUserClaims: async () => undefined },
    db: {
      doc: (path: string) => ({ path, id: path.split("/").pop(), get: async () => ({ exists: false, data: () => undefined }), set: async (data: Record<string, unknown>) => { harness.writes.push({ path, data }); } }),
      collection: (name: string) => ({ doc: (id = "auto") => ({ path: `${name}/${id}`, id }), where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }), get: async () => ({ empty: true, docs: [] }) }) }),
      runTransaction: async () => { throw new Error("aucune écriture attendue"); },
    },
  }),
}));
vi.mock("../../api/_lib/activeUser.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  verifyActorIdToken: async () => ({ uid: "admin1", role: "school_admin", schoolId: "s1" }),
  requireActiveApiUser: async () => undefined,
}));
vi.mock("../../api/_lib/rateLimit.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  enforceApiRateLimit: async () => undefined,
}));

const { default: handler, managePersonnel } = await import("../../api/provision-school-account.js");

async function create(role: string, sectionIds: string[]) {
  const res = { statusCode: 0, body: "", setHeader: () => undefined, end(text: string) { this.body = text; } };
  await handler({ method: "POST", headers: { authorization: "Bearer jeton" }, body: {
    role, schoolId: "s1", schoolYearId: "y1", name: "Conseiller Test", email: "conseiller@ecole.cd", password: "secret123", phone: "0990000000", sectionIds,
  } }, res);
  return { status: res.statusCode, body: JSON.parse(res.body || "{}") as { error?: string } };
}

function personnelDb(target: Record<string, unknown>) {
  const docs: Record<string, Record<string, unknown>> = {
    "schools/s1": { schoolType: "Mixte", educationLevels: ["Primaire", "Secondaire"] },
    "users/admin1": { role: "school_admin", schoolId: "s1", status: "active" },
    "users/c1": target,
  };
  const writes: string[] = [];
  const ref = (path: string) => ({ id: path.split("/").pop(), path, get: async () => ({ exists: path in docs, data: () => docs[path] }) });
  const db = {
    doc: ref,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id ?? "auto"}`) }),
    runTransaction: async (run: (transaction: unknown) => Promise<unknown>) => run({
      get: (target: { get: () => Promise<unknown> }) => target.get(),
      set: (target: { path: string }) => writes.push(target.path),
      update: (target: { path: string }) => writes.push(target.path),
      create: (target: { path: string }) => writes.push(target.path),
    }),
  };
  const auth = { getUser: async () => ({ displayName: "Conseiller", email: "conseiller@ecole.cd" }), updateUser: async () => undefined };
  return { db, auth, writes };
}
const updateBody = (sectionIds: string[]) => ({ schoolId: "s1", personnelId: "c1", name: "Conseiller", phone: "0990000000", email: "conseiller@ecole.cd", section: sectionIds[0] ?? null, sectionIds, profile: {} });
const admin = { uid: "admin1", role: "school_admin", schoolId: "s1" };

describe("Conseillers : section obligatoire côté serveur", () => {
  beforeEach(() => { harness.createUser.mockClear(); harness.writes.length = 0; });

  it.each(["pedagogical_advisor", "orientation_advisor"])("refuse la création d'un %s sans section, sans créer de compte", async (role) => {
    const result = await create(role, []);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("La section est obligatoire pour un conseiller.");
    expect(harness.createUser).not.toHaveBeenCalled();
    expect(harness.writes).toHaveLength(0);
  });

  it("ne bloque pas ce contrôle pour un conseiller avec section", async () => {
    const result = await create("pedagogical_advisor", ["Primaire"]);
    expect(result.body.error).not.toBe("La section est obligatoire pour un conseiller.");
  });

  it.each(["pedagogical_advisor", "orientation_advisor"])("refuse de retirer toutes les sections d'un %s existant, sans rien écrire", async (role) => {
    const { db, auth, writes } = personnelDb({ role, schoolId: "s1", status: "active", sectionIds: ["Primaire"], section: "Primaire", name: "Conseiller", email: "conseiller@ecole.cd" });
    await expect(managePersonnel({ auth, db, caller: admin, body: updateBody([]), action: "update-personnel" }))
      .rejects.toMatchObject({ statusCode: 400, message: "La section est obligatoire pour un conseiller." });
    expect(writes).toHaveLength(0);
  });

  it("laisse l'administrateur changer la section d'un conseiller existant", async () => {
    const { db, auth, writes } = personnelDb({ role: "orientation_advisor", schoolId: "s1", status: "active", sectionIds: ["Primaire"], section: "Primaire", name: "Conseiller", email: "conseiller@ecole.cd" });
    const result = await managePersonnel({ auth, db, caller: admin, body: updateBody(["Secondaire"]), action: "update-personnel" });
    expect(result.user.sectionIds).toEqual(["Secondaire"]);
    expect(writes).toContain("users/c1");
  });
});
