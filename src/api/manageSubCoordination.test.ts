import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    createUser: vi.fn(), setCustomUserClaims: vi.fn(), deleteUser: vi.fn(),
    getUser: vi.fn(), updateUser: vi.fn(), revokeRefreshTokens: vi.fn(), verifyIdToken: vi.fn(),
  },
  db: { doc: vi.fn(), collection: vi.fn(), runTransaction: vi.fn(), batch: vi.fn() },
  transaction: { get: vi.fn(), create: vi.fn(), set: vi.fn(), update: vi.fn() },
  batch: { update: vi.fn(), set: vi.fn(), commit: vi.fn() },
  caller: { uid: "coord-user", role: "coordination_admin", coordinationId: "coord-a", profile: { name: "Coordinateur" }, coordination: { status: "active" } },
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: mocks.auth, db: mocks.db }), firebaseAdminPublicError: () => ({ code: "internal", message: "Service indisponible." }) }));
vi.mock("../../api/_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { PROVISION_SCHOOL: {} }, enforceApiRateLimit: vi.fn(), sendRateLimitError: () => false }));
vi.mock("../../api/_lib/coordination.js", () => ({
  coordinationHttpError: (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code }),
  requireActiveCoordinator: vi.fn(async () => mocks.caller),
}));

import handler from "../../api/manage-coordination.js";

type Ref = { id: string; path: string; kind?: "query"; get?: () => Promise<unknown> };

function response() {
  return { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value) as Record<string, unknown>; } };
}

function request(input: Record<string, unknown>) {
  return { method: "POST", headers: { authorization: "Bearer staging-token" }, body: input };
}

describe("API Sous-coordination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.createUser.mockResolvedValue({ uid: "sub-user" });
    mocks.auth.setCustomUserClaims.mockResolvedValue(undefined);
    mocks.auth.deleteUser.mockResolvedValue(undefined);
    mocks.auth.getUser.mockResolvedValue({ uid: "sub-user", disabled: false });
    mocks.auth.updateUser.mockResolvedValue(undefined);
    mocks.auth.revokeRefreshTokens.mockResolvedValue(undefined);
    mocks.batch.commit.mockResolvedValue(undefined);
    mocks.db.batch.mockReturnValue(mocks.batch);
    mocks.db.doc.mockImplementation((path: string): Ref => ({ id: path.split("/").at(-1) ?? path, path, get: vi.fn(async () => ({ exists: false })) }));
    mocks.db.collection.mockImplementation((name: string) => ({
      doc: vi.fn((): Ref => ({ id: name === "subCoordinations" ? "sub-new" : "audit-new", path: `${name}/${name === "subCoordinations" ? "sub-new" : "audit-new"}` })),
      where: vi.fn((): Ref => ({ id: `${name}-query`, path: name, kind: "query" })),
    }));
    mocks.transaction.get.mockImplementation(async (target: Ref) => {
      if (target.kind === "query") return { docs: [] };
      if (target.path === "coordinationSchools/coord-a__school-a") return { exists: true, data: () => ({ coordinationId: "coord-a", schoolId: "school-a", active: true }) };
      if (target.path === "schools/school-a") return { exists: true, data: () => ({ id: "school-a", status: "active" }) };
      return { exists: false };
    });
    mocks.db.runTransaction.mockImplementation(async (operation: (transaction: typeof mocks.transaction) => Promise<unknown>) => operation(mocks.transaction));
  });

  it("crée Auth, claims minimaux, profil et relation sans persister le mot de passe", async () => {
    const res = response();
    await handler(request({ action: "create-sub-coordination", circumscription: "Commune de Gombe", schoolIds: ["school-a"], coordinator: { lastName: "Kabeya", middleName: "Ilunga", firstName: "Alice", phone: "0991234567", email: "subcoord001@example.test", password: "0991234567" } }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.auth.setCustomUserClaims).toHaveBeenCalledWith("sub-user", { role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-new" });
    expect(mocks.transaction.create).toHaveBeenCalledWith(expect.objectContaining({ path: "users/sub-user" }), expect.objectContaining({ role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-new", phone: "0991234567" }));
    const profile = mocks.transaction.create.mock.calls.find(([ref]) => ref.path === "users/sub-user")?.[1];
    expect(profile).not.toHaveProperty("password");
    expect(mocks.transaction.set).toHaveBeenCalledWith(expect.objectContaining({ path: "subCoordinationSchools/sub-new__school-a" }), expect.objectContaining({ schoolId: "school-a", active: true }));
  });

  it("refuse une école déjà déléguée et compense la création Auth", async () => {
    mocks.transaction.get.mockImplementation(async (target: Ref) => {
      if (target.kind === "query") return { docs: [{ id: "sub-other__school-a", ref: { path: "subCoordinationSchools/sub-other__school-a" }, data: () => ({ coordinationId: "coord-a", subCoordinationId: "sub-other", schoolId: "school-a", active: true }) }] };
      if (target.path === "coordinationSchools/coord-a__school-a") return { exists: true, data: () => ({ coordinationId: "coord-a", schoolId: "school-a", active: true }) };
      if (target.path === "schools/school-a") return { exists: true, data: () => ({ status: "active" }) };
      return { exists: false };
    });
    const res = response();
    await handler(request({ action: "create-sub-coordination", circumscription: "Zone A", schoolIds: ["school-a"], coordinator: { lastName: "Kabeya", phone: "0991234567", email: "subcoord001@example.test", password: "0991234567" } }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("school-already-delegated");
    expect(mocks.auth.deleteUser).toHaveBeenCalledWith("sub-user");
  });

  it("refuse une école extérieure à la Coordination principale", async () => {
    mocks.transaction.get.mockImplementation(async (target: Ref) => {
      if (target.kind === "query") return { docs: [] };
      if (target.path === "schools/school-external") return { exists: true, data: () => ({ status: "active" }) };
      return { exists: false };
    });
    const res = response();
    await handler(request({ action: "create-sub-coordination", circumscription: "Zone A", schoolIds: ["school-external"], coordinator: { lastName: "Kabeya", phone: "0991234567", email: "subcoord001@example.test", password: "0991234567" } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("school-outside-coordination");
    expect(mocks.auth.deleteUser).toHaveBeenCalledWith("sub-user");
  });

  it("ajoute une école active à une Sous-coordination sans modifier l’école", async () => {
    mocks.db.doc.mockImplementation((path: string): Ref => ({
      id: path.split("/").at(-1) ?? path,
      path,
      get: vi.fn(async () => path === "subCoordinations/sub-a"
        ? { exists: true, data: () => ({ coordinationId: "coord-a", coordinatorUserId: "sub-user", active: true, status: "active" }) }
        : { exists: false }),
    }));
    const res = response();
    await handler(request({ action: "add-sub-school", subCoordinationId: "sub-a", schoolId: "school-a" }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.transaction.set).toHaveBeenCalledWith(expect.objectContaining({ path: "subCoordinationSchools/sub-a__school-a" }), expect.objectContaining({ schoolId: "school-a", active: true }), { merge: true });
    expect(mocks.transaction.update).not.toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-a" }), expect.anything());
  });

  it("retire uniquement la relation déléguée et conserve l’école dans la Coordination", async () => {
    mocks.db.doc.mockImplementation((path: string): Ref => ({
      id: path.split("/").at(-1) ?? path,
      path,
      get: vi.fn(async () => path === "subCoordinations/sub-a"
        ? { exists: true, data: () => ({ coordinationId: "coord-a", coordinatorUserId: "sub-user", active: true, status: "active" }) }
        : { exists: false }),
    }));
    mocks.transaction.get.mockImplementation(async (target: Ref) => {
      if (target.kind === "query") return { docs: [{ id: "sub-a__school-a", ref: { path: "subCoordinationSchools/sub-a__school-a" }, data: () => ({ coordinationId: "coord-a", subCoordinationId: "sub-a", schoolId: "school-a", active: true }) }] };
      if (target.path === "coordinationSchools/coord-a__school-a") return { exists: true, data: () => ({ coordinationId: "coord-a", schoolId: "school-a", active: true }) };
      if (target.path === "schools/school-a") return { exists: true, data: () => ({ status: "active" }) };
      return { exists: false };
    });
    const res = response();
    await handler(request({ action: "remove-sub-school", subCoordinationId: "sub-a", schoolId: "school-a" }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: "subCoordinationSchools/sub-a__school-a" }), expect.objectContaining({ active: false }));
    expect(mocks.transaction.update).not.toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-a" }), expect.anything());
  });

  it("transfère atomiquement l’école de A vers B", async () => {
    mocks.db.doc.mockImplementation((path: string): Ref => ({
      id: path.split("/").at(-1) ?? path,
      path,
      get: vi.fn(async () => path === "subCoordinations/sub-a"
        ? { exists: true, data: () => ({ coordinationId: "coord-a", coordinatorUserId: "sub-user", active: true, status: "active" }) }
        : { exists: false }),
    }));
    mocks.transaction.get.mockImplementation(async (target: Ref) => {
      if (target.kind === "query") return { docs: [{ id: "sub-a__school-a", ref: { path: "subCoordinationSchools/sub-a__school-a" }, data: () => ({ coordinationId: "coord-a", subCoordinationId: "sub-a", schoolId: "school-a", active: true }) }] };
      if (target.path === "coordinationSchools/coord-a__school-a") return { exists: true, data: () => ({ coordinationId: "coord-a", schoolId: "school-a", active: true }) };
      if (target.path === "schools/school-a") return { exists: true, data: () => ({ status: "active" }) };
      if (target.path === "subCoordinations/sub-b") return { exists: true, data: () => ({ coordinationId: "coord-a", active: true }) };
      return { exists: false };
    });
    const res = response();
    await handler(request({ action: "transfer-sub-school", subCoordinationId: "sub-a", targetSubCoordinationId: "sub-b", schoolId: "school-a" }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: "subCoordinationSchools/sub-a__school-a" }), expect.objectContaining({ active: false }));
    expect(mocks.transaction.set).toHaveBeenCalledWith(expect.objectContaining({ path: "subCoordinationSchools/sub-b__school-a" }), expect.objectContaining({ subCoordinationId: "sub-b", active: true }), { merge: true });
  });

  it.each([
    ["archive-sub-coordination", true, false],
    ["reactivate-sub-coordination", false, true],
  ])("%s conserve le même UID et synchronise Auth/profil", async (action, initiallyActive, expectedActive) => {
    mocks.db.doc.mockImplementation((path: string): Ref => ({
      id: path.split("/").at(-1) ?? path,
      path,
      get: vi.fn(async () => path === "subCoordinations/sub-a"
        ? { exists: true, data: () => ({ coordinationId: "coord-a", coordinatorUserId: "sub-user", active: initiallyActive, status: initiallyActive ? "active" : "archived" }) }
        : { exists: false }),
    }));
    const res = response();
    await handler(request({ action, subCoordinationId: "sub-a" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ subCoordinationId: "sub-a", active: expectedActive, idempotent: false });
    expect(mocks.auth.updateUser).toHaveBeenCalledWith("sub-user", { disabled: !expectedActive });
    expect(mocks.auth.createUser).not.toHaveBeenCalled();
    expect(mocks.batch.update).toHaveBeenCalledWith(expect.objectContaining({ path: "users/sub-user" }), expect.objectContaining({ active: expectedActive }));
  });
});
