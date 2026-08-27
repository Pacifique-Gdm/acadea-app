import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(), updateUser: vi.fn(), setCustomUserClaims: vi.fn(), revokeRefreshTokens: vi.fn(),
  },
  db: { doc: vi.fn(), collection: vi.fn(), runTransaction: vi.fn() },
  transaction: { get: vi.fn(), update: vi.fn(), set: vi.fn(), create: vi.fn() },
  caller: { uid: "coord-user", role: "coordination_admin", coordinationId: "coord-a", profile: { name: "Coordinateur Test" } },
  scope: ["school-a", "school-b"],
  principalAuthorized: true,
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: mocks.auth, db: mocks.db }), firebaseAdminPublicError: () => ({ code: "internal", message: "Service indisponible." }) }));
vi.mock("../../api/_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { PROVISION_SCHOOL: {}, MESSAGE_RECIPIENTS: {} }, enforceApiRateLimit: vi.fn(), sendRateLimitError: () => false }));
vi.mock("../../api/_lib/coordination.js", () => ({
  coordinationHttpError: (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code }),
  requireActiveCoordinator: vi.fn(async () => {
    if (!mocks.principalAuthorized) throw Object.assign(new Error("Action réservée au Coordinateur."), { statusCode: 403, code: "not-authorized" });
    return mocks.caller;
  }),
  requireActiveCoordinationActor: vi.fn(),
  resolveCoordinationSchoolScope: vi.fn(async () => mocks.scope),
}));

import handler from "../../api/manage-coordination.js";

type Ref = { id: string; path: string };
const records: Record<string, Record<string, unknown> | undefined> = {};

function snapshot(ref: Ref) {
  const value = records[ref.path];
  return { id: ref.id, ref, exists: Boolean(value), data: () => value };
}

function response() {
  return { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value) as Record<string, unknown>; } };
}

function request(overrides: Record<string, unknown> = {}) {
  return { method: "POST", headers: { authorization: "Bearer staging-token" }, body: { action: "transfer-personnel", personnelId: "personnel-a", sourceSchoolId: "school-a", destinationSchoolId: "school-b", mutationDate: "2026-08-27", reason: "Besoin de service", confirmation: "MUTER CE PERSONNEL", ...overrides } };
}

describe("mutation sécurisée d'un personnel entre écoles d'une Coordination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(records).forEach((key) => delete records[key]);
    mocks.scope = ["school-a", "school-b"];
    mocks.principalAuthorized = true;
    records["users/personnel-a"] = { id: "personnel-a", name: "Personnel Test", role: "secretary", schoolId: "school-a", activeSchoolYearId: "year-a", status: "active", active: true };
    records["schools/school-a"] = { id: "school-a", status: "active", activeSchoolYearId: "year-a", educationLevels: ["Primaire"] };
    records["schools/school-b"] = { id: "school-b", status: "active", activeSchoolYearId: "year-b", educationLevels: ["Primaire"] };
    records["schoolYears/year-b"] = { id: "year-b", schoolId: "school-b", status: "active" };
    records["coordinationSchools/coord-a__school-a"] = { coordinationId: "coord-a", schoolId: "school-a", active: true };
    records["coordinationSchools/coord-a__school-b"] = { coordinationId: "coord-a", schoolId: "school-b", active: true };
    records["personnelProfiles/personnel-a"] = { id: "personnel-a", personnelId: "personnel-a", schoolId: "school-a", matricule: "PER-001" };
    mocks.auth.getUser.mockResolvedValue({ uid: "personnel-a", disabled: false, customClaims: { role: "secretary", schoolId: "school-a" } });
    mocks.auth.updateUser.mockResolvedValue(undefined);
    mocks.auth.setCustomUserClaims.mockResolvedValue(undefined);
    mocks.auth.revokeRefreshTokens.mockResolvedValue(undefined);
    mocks.db.doc.mockImplementation((path: string): Ref & { get: () => Promise<unknown> } => {
      const ref = { id: path.split("/").at(-1) ?? path, path };
      return { ...ref, get: vi.fn(async () => snapshot(ref)) };
    });
    mocks.db.collection.mockImplementation((name: string) => ({
      doc: vi.fn((): Ref => ({ id: "audit-transfer", path: `${name}/audit-transfer` })),
      where: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [] })) })),
    }));
    mocks.transaction.get.mockImplementation(async (ref: Ref) => snapshot(ref));
    mocks.db.runTransaction.mockImplementation(async (operation: (transaction: typeof mocks.transaction) => Promise<unknown>) => operation(mocks.transaction));
  });

  it("conserve le même compte, change uniquement le rattachement actif et écrit l'audit", async () => {
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.user).toEqual(expect.objectContaining({ id: "personnel-a", schoolId: "school-b", activeSchoolYearId: "year-b", role: "secretary" }));
    expect(mocks.auth.updateUser).toHaveBeenNthCalledWith(1, "personnel-a", { disabled: true });
    expect(mocks.auth.setCustomUserClaims).toHaveBeenCalledWith("personnel-a", { role: "secretary", schoolId: "school-b" });
    expect(mocks.auth.updateUser).toHaveBeenLastCalledWith("personnel-a", { disabled: false });
    expect(mocks.transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: "users/personnel-a" }), expect.objectContaining({ schoolId: "school-b", activeSchoolYearId: "year-b" }));
    expect(mocks.transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: "personnelProfiles/personnel-a" }), expect.objectContaining({ schoolId: "school-b" }));
    expect(mocks.transaction.create).toHaveBeenCalledWith(expect.objectContaining({ path: "auditLogs/audit-transfer" }), expect.objectContaining({ eventType: "coordination.personnel.transferred", metadata: expect.objectContaining({ sourceSchoolId: "school-a", destinationSchoolId: "school-b", mutationDate: "2026-08-27", reason: "Besoin de service" }) }));
  });

  it("refuse une destination hors du périmètre actif sans mutation", async () => {
    mocks.scope = ["school-a"];
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("school-outside-coordination");
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
    expect(mocks.db.runTransaction).not.toHaveBeenCalled();
  });

  it("refuse un Sous-coordinateur avant toute lecture ou mutation du personnel", async () => {
    mocks.principalAuthorized = false;
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("not-authorized");
    expect(mocks.db.doc).not.toHaveBeenCalled();
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuse un texte de confirmation inexact", async () => {
    const res = response();
    await handler(request({ confirmation: "MUTER" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("invalid-confirmation");
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuse si l'école source déclarée ne correspond plus au profil", async () => {
    records["users/personnel-a"] = { ...records["users/personnel-a"], schoolId: "school-b" };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(404);
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuse une école de destination qui ne possède pas les sections du personnel", async () => {
    records["users/personnel-a"] = { ...records["users/personnel-a"], section: "Secondaire", sectionIds: ["Secondaire"] };
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("incompatible-sections");
    expect(mocks.transaction.update).not.toHaveBeenCalled();
    expect(mocks.auth.setCustomUserClaims).toHaveBeenLastCalledWith("personnel-a", { role: "secretary", schoolId: "school-a" });
  });

  it("restaure les claims et réactive le compte si la transaction échoue", async () => {
    mocks.db.runTransaction.mockRejectedValueOnce(new Error("transaction failed"));
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(500);
    expect(mocks.auth.setCustomUserClaims).toHaveBeenLastCalledWith("personnel-a", { role: "secretary", schoolId: "school-a" });
    expect(mocks.auth.updateUser).toHaveBeenLastCalledWith("personnel-a", { disabled: false });
    expect(mocks.auth.revokeRefreshTokens).toHaveBeenCalledTimes(2);
  });
});
