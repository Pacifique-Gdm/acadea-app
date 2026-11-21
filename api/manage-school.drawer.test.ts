import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot SA-4 : drawer d'école léger. Seul le Super administrateur obtient les nombres et l'historique.
const mocks = vi.hoisted(() => ({ caller: { uid: "super-test", role: "super_admin" } as { uid: string; role: string }, reads: [] as string[] }));
vi.mock("./_lib/activeUser.js", () => ({ verifyActorIdToken: async () => mocks.caller, requireActiveApiUser: async () => mocks.caller }));
vi.mock("./_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { SCHOOL_ADMIN: {}, SCHOOL_DELETE: {}, MESSAGE_RECIPIENTS: {} }, enforceApiRateLimit: async () => undefined, sendRateLimitError: () => false }));
vi.mock("./_lib/firebaseAdmin.js", () => ({
  firebaseAdminPublicError: (error: Error) => ({ message: error.message, code: "internal" }),
  initAdmin: () => {
    const rows: Record<string, Record<string, unknown>[]> = {
      students: [{ id: "s1", schoolId: "school-a", schoolYearId: "year-1", className: "1ère Primaire", status: "ACTIVE" }],
      parents: [{ id: "p1", schoolId: "school-a", studentIds: ["s1"] }],
      users: [{ id: "u1", schoolId: "school-a", role: "school_admin" }],
      auditLogs: [{ id: "l1", schoolId: "school-a", schoolYearId: "year-1", action: "Création", actorName: "SA", createdAt: "2026-11-20T10:00:00.000Z" }],
    };
    const query = (name: string, filters: [string, unknown][] = []): unknown => ({
      where: (field: string, _operator: string, value: unknown) => query(name, [...filters, [field, value]]),
      select: () => query(name, filters),
      get: async () => {
        mocks.reads.push(name);
        const docs = (rows[name] ?? []).filter((row) => filters.every(([field, value]) => row[field] === value));
        return { docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) };
      },
    });
    return { auth: {}, bucket: {}, db: { collection: (name: string) => query(name), doc: () => ({ get: async () => ({ exists: false }) }) } };
  },
}));

import handler from "./manage-school.js";

async function request(body: Record<string, unknown>) {
  let payload = "";
  const res = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { payload = value; } };
  await handler({ method: "POST", headers: { authorization: "Bearer e2e-token" }, body } as never, res as never);
  return { status: res.statusCode, body: JSON.parse(payload) as Record<string, unknown> };
}

describe("API du drawer d'école (lot SA-4)", () => {
  beforeEach(() => { mocks.reads = []; mocks.caller = { uid: "super-test", role: "super_admin" }; });

  it("le Super administrateur reçoit les nombres et la première page d'historique en une seule demande", async () => {
    const response = await request({ action: "school-drawer", schoolId: "school-a", schoolYearId: "year-1" });
    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({ students: 1, parents: 1, admins: 1, users: 1, classes: [{ className: "1ère Primaire", option: "", count: 1 }] });
    expect(response.body.history).toMatchObject({ page: 0, total: 1, hasMore: false });
    // Ni paiements, ni dépenses, ni messages, ni notifications, ni valves, ni frais.
    expect([...new Set(mocks.reads)].sort()).toEqual(["auditLogs", "parents", "students", "users"]);
  });

  it("page suivante de l'historique", async () => {
    const response = await request({ action: "school-history", schoolId: "school-a", schoolYearId: "year-1", page: 1 });
    expect(response.status).toBe(200);
    expect(response.body.history).toMatchObject({ page: 1, logs: [], hasMore: false });
  });

  it("refuse tous les autres rôles, sans rien lire", async () => {
    for (const role of ["school_admin", "cashier", "coordination_admin", "sub_coordination_admin", "teacher", "parent", "secretary"]) {
      mocks.caller = { uid: `${role}-test`, role };
      for (const action of ["school-drawer", "school-history"]) {
        const response = await request({ action, schoolId: "school-a", schoolYearId: "year-1" });
        expect(response.status).toBe(403);
        expect(response.body.summary).toBeUndefined();
        expect(response.body.history).toBeUndefined();
      }
    }
    expect(mocks.reads).toEqual([]);
  });

  it("refuse une école ou une année mal formée", async () => {
    expect((await request({ action: "school-drawer", schoolId: "../x", schoolYearId: "year-1" })).status).toBe(400);
    expect((await request({ action: "school-drawer", schoolId: "school-a" })).status).toBe(400);
    expect(mocks.reads).toEqual([]);
  });
});
