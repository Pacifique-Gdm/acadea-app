import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scope: ["school-a"] as string[],
  records: [] as Array<{ id: string; data: Record<string, unknown> }>,
  where: vi.fn(),
  get: vi.fn(),
}));
vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: {}, db: { collection: () => ({ where: mocks.where }) } }), firebaseAdminPublicError: () => ({ code: "internal", message: "Service indisponible." }) }));
vi.mock("../../api/_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { MESSAGE_RECIPIENTS: {} }, enforceApiRateLimit: vi.fn(), sendRateLimitError: () => false }));
vi.mock("../../api/_lib/coordination.js", () => ({
  coordinationHttpError: (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code }),
  requireActiveCoordinator: vi.fn(),
  requireActiveCoordinationActor: vi.fn(async () => ({ uid: "coord-user", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a" })),
  resolveCoordinationSchoolScope: vi.fn(async () => mocks.scope),
}));

import handler from "../../api/manage-coordination.js";

function response() { return { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value) as Record<string, unknown>; } }; }
const request = (token = "staging-token") => ({ method: "POST", headers: { authorization: token ? `Bearer ${token}` : "" }, body: { action: "read-class-filter-choices" } });

describe("métadonnées de classes bornées à la Coordination", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.scope = ["school-a"]; mocks.records = [];
    mocks.where.mockImplementation((_field: string, _operator: string, ids: string[]) => {
      mocks.get.mockImplementation(async () => ({ docs: mocks.records.filter((record) => ids.includes(String(record.data.schoolId))).map((record) => ({ id: record.id, data: () => record.data })) }));
      return { get: mocks.get };
    });
  });

  it("retourne uniquement les classes du périmètre délégué et leurs champs de filtre", async () => {
    mocks.records = [
      { id: "class-a", data: { schoolId: "school-a", schoolYearId: "year-a", name: "1ère Humanité", active: true, privateNote: "excluded" } },
      { id: "class-b", data: { schoolId: "school-b", schoolYearId: "year-b", name: "2ème Humanité", active: true } },
      { id: "class-inactive", data: { schoolId: "school-a", schoolYearId: "year-a", name: "Inactive", active: false } },
    ];
    const res = response(); await handler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.classes).toEqual([{ id: "class-a", schoolId: "school-a", schoolYearId: "year-a", name: "1ère Humanité" }]);
    expect(mocks.where).toHaveBeenCalledWith("schoolId", "in", ["school-a"]);
  });

  it("ne lit aucune classe hors périmètre vide", async () => {
    mocks.scope = [];
    const res = response(); await handler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.classes).toEqual([]);
    expect(mocks.where).not.toHaveBeenCalled();
  });

  it("découpe un périmètre multi-écoles sans requête in supérieure à 30", async () => {
    mocks.scope = Array.from({ length: 31 }, (_, index) => `school-${index}`);
    const res = response(); await handler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.where).toHaveBeenCalledTimes(2);
    expect((mocks.where.mock.calls[0][2] as string[])).toHaveLength(30);
    expect((mocks.where.mock.calls[1][2] as string[])).toHaveLength(1);
  });

  it("refuse l'absence de token avant tout accès aux classes", async () => {
    const res = response(); await handler(request(""), res);
    expect(res.statusCode).toBe(401);
    expect(mocks.where).not.toHaveBeenCalled();
  });
});
