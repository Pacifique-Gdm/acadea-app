import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {},
  db: { doc: vi.fn() },
  actor: { uid: "coord-user", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a" },
  scope: ["school-a"],
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: mocks.auth, db: mocks.db }), firebaseAdminPublicError: () => ({ code: "internal", message: "Service indisponible." }) }));
vi.mock("../../api/_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { PROVISION_SCHOOL: {} }, enforceApiRateLimit: vi.fn(), sendRateLimitError: () => false }));
vi.mock("../../api/_lib/coordination.js", () => ({
  coordinationHttpError: (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code }),
  requireActiveCoordinator: vi.fn(),
  requireActiveCoordinationActor: vi.fn(async () => mocks.actor),
  resolveCoordinationSchoolScope: vi.fn(async () => mocks.scope),
}));

import handler from "../../api/manage-coordination.js";

const records: Record<string, Record<string, unknown> | undefined> = {};
function response() { return { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value) as Record<string, unknown>; } }; }
function request(studentId: string) { return { method: "POST", headers: { authorization: "Bearer staging-token" }, body: { action: "read-student-parent", studentId } }; }
function personnelRequest(personnelId: string) { return { method: "POST", headers: { authorization: "Bearer staging-token" }, body: { action: "read-personnel-profile", personnelId } }; }

describe("lecture parent bornée pour la fiche Élève Coordination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(records).forEach((key) => delete records[key]);
    mocks.scope = ["school-a"];
    mocks.db.doc.mockImplementation((path: string) => ({ id: path.split("/").at(-1), get: vi.fn(async () => ({ id: path.split("/").at(-1), exists: Boolean(records[path]), data: () => records[path] })) }));
  });

  it("retourne uniquement le parent de l'élève appartenant au périmètre", async () => {
    records["students/student-a"] = { schoolId: "school-a", schoolYearId: "year-a", parentId: "parent-a" };
    records["parents/parent-a"] = { schoolId: "school-a", schoolYearId: "year-a", userId: "user-parent", fullName: "Parent Test", phone: "099", email: "parent@test", address: "Adresse", studentIds: ["student-a", "student-other"], status: "active", privateField: "excluded" };
    const res = response();
    await handler(request("student-a"), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.parent).toEqual(expect.objectContaining({ id: "parent-a", schoolId: "school-a", studentIds: ["student-a"] }));
    expect(res.body.parent).not.toHaveProperty("privateField");
  });

  it("refuse un élève d'une école extérieure", async () => {
    records["students/student-b"] = { schoolId: "school-b", schoolYearId: "year-b", parentId: "parent-b" };
    const res = response();
    await handler(request("student-b"), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe("not-found");
    expect(mocks.db.doc).not.toHaveBeenCalledWith("parents/parent-b");
  });

  it("retourne un profil Personnel interne sans chemin Storage ni métadonnées d'audit", async () => {
    records["users/personnel-a"] = { schoolId: "school-a", role: "teacher" };
    records["personnelProfiles/personnel-a"] = { schoolId: "school-a", personnelId: "personnel-a", matricule: "PER-1", photoUrl: "https://example.test/photo.png", photoPath: "private/path", lastName: "Test", createdAt: "2026-01-01", createdBy: "admin", updatedAt: "2026-01-02", updatedBy: "admin" };
    const res = response();
    await handler(personnelRequest("personnel-a"), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.profile).toEqual(expect.objectContaining({ id: "personnel-a", matricule: "PER-1", lastName: "Test" }));
    expect(res.body.profile).not.toHaveProperty("photoPath");
    expect(res.body.profile).not.toHaveProperty("createdBy");
  });

  it("refuse le profil d'un rôle Parent même dans une école autorisée", async () => {
    records["users/parent-a"] = { schoolId: "school-a", role: "parent" };
    const res = response();
    await handler(personnelRequest("parent-a"), res);
    expect(res.statusCode).toBe(404);
    expect(mocks.db.doc).not.toHaveBeenCalledWith("personnelProfiles/parent-a");
  });
});
