import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ caller: { uid: "super-test", role: "super_admin" }, update: vi.fn(), set: vi.fn() }));
vi.mock("./_lib/activeUser.js", () => ({ verifyActorIdToken: async () => mocks.caller, requireActiveApiUser: async () => mocks.caller }));
vi.mock("./_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { SCHOOL_ADMIN: {}, SCHOOL_DELETE: {} }, enforceApiRateLimit: async () => undefined, sendRateLimitError: () => false }));
vi.mock("./_lib/firebaseAdmin.js", () => ({
  firebaseAdminPublicError: (error: Error) => ({ message: error.message, code: "internal" }),
  initAdmin: () => {
    const school = { schoolOptions: ["Sciences", "Littéraire"], schoolOptionDisplayNames: {} };
    const snapshot = { exists: true, id: "school-a", data: () => school };
    const schoolRef = { id: "school-a", path: "schools/school-a", get: async () => snapshot };
    return { auth: {}, bucket: {}, db: {
      doc: () => schoolRef,
      collection: () => ({ doc: (id: string) => ({ id }) }),
      runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ get: async () => snapshot, update: mocks.update, set: mocks.set }),
    } };
  },
}));

import handler from "./manage-school.js";

async function request(body: Record<string, unknown>) {
  let payload = "";
  const res = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { payload = value; } };
  await handler({ method: "POST", headers: { authorization: "Bearer e2e-token" }, body } as never, res as never);
  return { status: res.statusCode, body: JSON.parse(payload) as Record<string, unknown> };
}

describe("API de renommage d'option", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.caller = { uid: "super-test", role: "super_admin" }; });
  const valid = { action: "rename-option", schoolId: "school-a", option: "Sciences", newName: "Technologies", confirmation: "CHANGER LE NOM DE CETTE OPTION" };

  it("refuse un rôle scolaire et toute confirmation manquante sans écriture", async () => {
    mocks.caller = { uid: "admin-test", role: "school_admin" };
    expect((await request(valid)).status).toBe(403);
    mocks.caller = { uid: "super-test", role: "super_admin" };
    expect((await request({ ...valid, confirmation: "" })).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("engage le seul libellé et l'audit dans la même transaction", async () => {
    const response = await request(valid);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-a" }), expect.objectContaining({ schoolOptionDisplayNames: { Sciences: "Technologies" } }));
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty("schoolOptions");
    expect(mocks.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ schoolId: "school-a", resourceId: "Sciences", metadata: expect.objectContaining({ oldName: "Sciences", newName: "Technologies" }) }));
  });
});
