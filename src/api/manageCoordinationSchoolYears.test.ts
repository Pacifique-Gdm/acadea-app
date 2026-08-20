import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: { uid: "sub-user", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", coordination: { referenceSchoolYear: "2026-2027" }, profile: { name: "Sous-coordinateur" } },
  db: { doc: vi.fn(), getAll: vi.fn(), collection: vi.fn(), batch: vi.fn() },
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: {}, db: mocks.db }) }));
vi.mock("../../api/_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { SCHOOL_ADMIN: {} }, enforceApiRateLimit: vi.fn(), sendRateLimitError: () => false }));
vi.mock("../../api/_lib/coordination.js", () => ({
  chunks: (values: string[]) => [values],
  coordinationHttpError: (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code }),
  requireActiveCoordinationActor: vi.fn(async () => mocks.actor),
  resolveCoordinationSchoolScope: vi.fn(async () => ["school-a"]),
}));

import handler from "../../api/manage-coordination-school-years.js";

function response() {
  return { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value) as Record<string, unknown>; } };
}

function request(action: string) {
  return { method: "POST", headers: { authorization: "Bearer staging-token" }, body: { action, confirmed: true } };
}

describe("gouvernance annuelle Sous-coordinateur", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.doc.mockImplementation((path: string) => ({ path }));
    mocks.db.getAll.mockResolvedValue([{ id: "school-a", exists: true, data: () => ({ id: "school-a", name: "École A", activeSchoolYearId: "year-a" }) }]);
    mocks.db.collection.mockReturnValue({ where: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [{ id: "year-a", data: () => ({ id: "year-a", schoolId: "school-a", name: "2026-2027", status: "active" }) }] })) })) });
  });

  it("autorise uniquement la consultation de l’état des années du périmètre", async () => {
    const res = response();
    await handler(request("status"), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ referenceYear: "2026-2027" });
    expect(res.body.rows).toEqual([expect.objectContaining({ schoolId: "school-a" })]);
  });

  it.each(["close", "open"])("refuse l’action annuelle %s", async (action) => {
    const res = response();
    await handler(request(action), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "not-authorized" });
    expect(mocks.db.batch).not.toHaveBeenCalled();
  });
});
