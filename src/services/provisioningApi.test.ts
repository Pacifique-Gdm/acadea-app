import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    verifyIdToken: vi.fn(),
    createUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
    deleteUser: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    revokeRefreshTokens: vi.fn(),
  },
  db: {
    doc: vi.fn(),
    collection: vi.fn(),
    batch: vi.fn(),
  },
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({
  initAdmin: () => ({ auth: mocks.auth, db: mocks.db }),
  firebaseAdminPublicError: () => ({
    code: "internal",
    message: "Service indisponible.",
    correlationId: "acadea-test",
  }),
}));
vi.mock("../../api/_lib/rateLimit.js", () => ({
  API_RATE_LIMITS: { PROVISION_SCHOOL: {}, PROVISION_ACCOUNT: {}, PROVISION_DESTRUCTIVE: {} },
  enforceApiRateLimit: vi.fn(),
  sendRateLimitError: () => false,
}));

import provisionSchoolAccount from "../../api/provision-school-account.js";
import provisionSchoolAdmin from "../../api/provision-school-admin.js";

type JsonResponse = { statusCode: number; body?: Record<string, unknown>; setHeader: ReturnType<typeof vi.fn>; end: (value: string) => void };

function response(): JsonResponse {
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end(value) { this.body = JSON.parse(value) as Record<string, unknown>; },
  };
}

function request(body: Record<string, unknown>) {
  return { method: "POST", headers: { authorization: "Bearer diagnostic-token" }, body };
}

it("normalise les alias CETB/CTEB dans l'API", async () => {
  const { normalizeSectionIds } = await import("../../api/provision-school-account.js");
  expect(normalizeSectionIds(["CTEB", "CETB", "cteb", "cetb"])).toEqual(["CTEB"]);
  expect(() => normalizeSectionIds(["INVENTEE"])).toThrow("Section invalide");
});

describe("API de provisionnement Acadéa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.verifyIdToken.mockResolvedValue({ uid: "admin-1", role: "school_admin", schoolId: "school-1" });
    mocks.auth.createUser.mockResolvedValue({ uid: "created-user" });
    mocks.auth.setCustomUserClaims.mockResolvedValue(undefined);
    mocks.auth.deleteUser.mockResolvedValue(undefined);
    mocks.auth.getUser.mockResolvedValue({ uid: "target-user", email: "old@example.invalid", displayName: "Ancien nom", disabled: false });
    mocks.auth.updateUser.mockResolvedValue(undefined);
    mocks.auth.revokeRefreshTokens.mockResolvedValue(undefined);
    mocks.db.batch.mockReturnValue({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) });
    mocks.db.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ id: "audit-test", set: vi.fn().mockResolvedValue(undefined) })),
      where: vi.fn(() => ({ where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [], empty: true }) })), get: vi.fn().mockResolvedValue({ docs: [], empty: true }) })),
    }));
    mocks.db.doc.mockImplementation((path: string) => ({
      path,
      get: vi.fn().mockResolvedValue(path === "schools/school-1"
        ? { exists: true, data: () => ({ id: "school-1" }) }
        : path === "schoolYears/year-1"
          ? { exists: true, data: () => ({ id: "year-1", schoolId: "school-1", status: "active" }) }
        : path === "students/student-1"
          ? { exists: true, data: () => ({ id: "student-1", schoolId: "school-1", schoolYearId: "year-1", status: "ACTIVE" }), ref: { path } }
          : { exists: false }),
      set: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }));
  });

  it("retourne le vrai code unauthenticated sans appeler Firebase Admin", async () => {
    const res = response();
    await provisionSchoolAccount({ method: "POST", headers: {}, body: {} }, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Authentification requise.", code: "unauthenticated" });
    expect(mocks.auth.verifyIdToken).not.toHaveBeenCalled();
  });

  for (const role of ["cashier", "secretary", "discipline_director", "study_director", "teacher"] as const) {
    it(`crée Firebase Auth, le profil Firestore et les claims pour ${role}`, async () => {
      const res = response();
      await provisionSchoolAccount(request({
        role, schoolId: "school-1", schoolYearId: "year-1", name: "Utilisateur test",
        email: `${role}@example.invalid`, password: "0991234567", phone: "0991234567",
      }), res);

      expect(res.statusCode).toBe(200);
      expect(mocks.auth.createUser).toHaveBeenCalledOnce();
      expect(mocks.auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ password: "0991234567" }));
      expect(res.body?.user).not.toHaveProperty("password");
      expect(mocks.db.doc).toHaveBeenCalledWith("users/created-user");
      expect(mocks.auth.setCustomUserClaims).toHaveBeenCalledWith("created-user", { role, schoolId: "school-1" });
      if (role === "teacher") {
        expect(mocks.db.doc).toHaveBeenCalledWith("teachers/school-1__year-1__created-user");
        const batch = mocks.db.batch.mock.results[0]?.value;
        expect(batch.set).toHaveBeenCalledWith(expect.objectContaining({ path: "teachers/school-1__year-1__created-user" }), expect.objectContaining({ userId: "created-user", schoolId: "school-1", schoolYearId: "year-1", status: "active" }));
      }
    });
  }

  it("accepte un mot de passe métier personnalisé différent du téléphone", async () => {
    const res = response();
    await provisionSchoolAccount(request({
      role: "cashier", schoolId: "school-1", schoolYearId: "year-1", name: "Utilisateur test",
      email: "cashier@example.invalid", password: "different", phone: "0991234567",
    }), res);

    expect(res.statusCode).toBe(200);
    expect(mocks.auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ password: "different" }));
  });

  it("crée le parent, son profil utilisateur et ses claims tenantés", async () => {
    const res = response();
    await provisionSchoolAccount(request({
      role: "parent", schoolId: "school-1", schoolYearId: "year-1", parentId: "parent-1",
      name: "Parent test", email: "parent@example.invalid", password: "test-password",
      phone: "", address: "", studentIds: ["student-1"], status: "active",
    }), res);

    expect(res.statusCode).toBe(200);
    expect(mocks.db.doc).toHaveBeenCalledWith("parents/parent-1");
    expect(mocks.db.doc).toHaveBeenCalledWith("users/created-user");
    expect(mocks.auth.setCustomUserClaims).toHaveBeenCalledWith("created-user", {
      role: "parent", schoolId: "school-1", parentId: "parent-1",
    });
    const batch = mocks.db.batch.mock.results[0]?.value;
    expect(batch.set).toHaveBeenCalledTimes(3);
    expect(batch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "user.created", actorId: "admin-1", actorRole: "school_admin", schoolId: "school-1", source: "server" }));
    expect(batch.update).toHaveBeenCalledWith(expect.objectContaining({ path: "students/student-1" }), { parentId: "parent-1" });
    expect(batch.commit).toHaveBeenCalledOnce();
  });

  it("autorise le Secrétaire à créer un parent uniquement dans son école", async () => {
    mocks.auth.verifyIdToken.mockResolvedValue({ uid: "secretary-1", role: "secretary", schoolId: "school-1" });
    const allowed = response();
    await provisionSchoolAccount(request({ role: "parent", schoolId: "school-1", schoolYearId: "year-1", parentId: "parent-1", name: "Parent test", email: "parent@example.invalid", password: "test-password", studentIds: [] }), allowed);
    expect(allowed.statusCode).toBe(200);

    const refused = response();
    await provisionSchoolAccount(request({ role: "parent", schoolId: "school-2", schoolYearId: "year-1", parentId: "parent-2", name: "Parent test", email: "parent2@example.invalid", password: "test-password", studentIds: [] }), refused);
    expect(refused.statusCode).toBe(403);
  });

  it("refuse atomiquement un élève d'une autre école avant de créer Auth", async () => {
    mocks.db.doc.mockImplementation((path: string) => ({
      path,
      get: vi.fn().mockResolvedValue(path === "schools/school-1"
        ? { exists: true, data: () => ({ id: "school-1" }) }
        : { exists: true, data: () => ({ id: "student-foreign", schoolId: "school-2", schoolYearId: "year-1", status: "ACTIVE" }), ref: { path } }),
    }));
    const res = response();
    await provisionSchoolAccount(request({ role: "parent", schoolId: "school-1", schoolYearId: "year-1", parentId: "parent-1", name: "Parent test", email: "parent@example.invalid", password: "test-password", studentIds: ["student-foreign"] }), res);
    expect(res.statusCode).toBe(400);
    expect(mocks.auth.createUser).not.toHaveBeenCalled();
    expect(mocks.db.batch).not.toHaveBeenCalled();
  });

  it("crée une école, son administrateur et les claims school_admin", async () => {
    mocks.auth.verifyIdToken.mockResolvedValue({ uid: "super-1", role: "super_admin", email: "super@example.invalid" });
    const res = response();
    await provisionSchoolAdmin(request({
      schoolName: "École test", adminName: "Administrateur test",
      adminEmail: "admin@example.invalid", adminPassword: "test-password",
      subscriptionPlan: "Standard", educationLevels: ["Primaire"], schoolOptions: [],
    }), res);

    expect(res.statusCode).toBe(200);
    expect(mocks.auth.createUser).toHaveBeenCalledOnce();
    expect(mocks.auth.setCustomUserClaims).toHaveBeenCalledWith("created-user", expect.objectContaining({ role: "school_admin" }));
    expect(mocks.db.doc).toHaveBeenCalledWith(expect.stringMatching(/^schools\/school-/));
    expect(mocks.db.doc).toHaveBeenCalledWith("users/created-user");
  });

  it("enregistre uniquement la valeur canonique CTEB lors de la création d'une école", async () => {
    mocks.auth.verifyIdToken.mockResolvedValue({ uid: "super-1", role: "super_admin", email: "super@example.invalid" });
    const res = response();

    await provisionSchoolAdmin(request({
      schoolName: "École CTEB", adminName: "Administrateur test",
      adminEmail: "admin-cteb@example.invalid", adminPassword: "test-password",
      subscriptionPlan: "Standard", educationLevels: ["CETB", "cteb", "Primaire"], schoolOptions: [],
    }), res);

    expect(res.statusCode).toBe(200);
    const schoolRef = mocks.db.doc.mock.results
      .map((result) => result.value as { path?: string; set?: ReturnType<typeof vi.fn> })
      .find((ref) => ref.path?.startsWith("schools/school-"));
    expect(schoolRef?.set).toHaveBeenCalledWith(expect.objectContaining({ educationLevels: ["CTEB", "Primaire"] }));
  });

  it("normalise la section du personnel en CTEB avant l'écriture", async () => {
    mocks.db.doc.mockImplementation((path: string) => ({
      path,
      get: vi.fn().mockResolvedValue(path === "schools/school-1"
        ? { exists: true, data: () => ({ id: "school-1", educationLevels: ["Primaire", "CETB"] }) }
        : path === "schoolYears/year-1"
          ? { exists: true, data: () => ({ id: "year-1", schoolId: "school-1", status: "active" }) }
          : { exists: false }),
      set: vi.fn().mockResolvedValue(undefined),
    }));
    const res = response();

    await provisionSchoolAccount(request({
      role: "study_director", schoolId: "school-1", schoolYearId: "year-1",
      name: "Direction CTEB", email: "direction-cteb@example.invalid",
      password: "test-password", sectionIds: ["cteb"],
    }), res);

    expect(res.statusCode).toBe(200);
    const userRef = mocks.db.doc.mock.results
      .map((result) => result.value as { path?: string; set?: ReturnType<typeof vi.fn> })
      .find((ref) => ref.path === "users/created-user");
    expect(userRef?.set).toHaveBeenCalledWith(expect.objectContaining({ section: "CTEB", sectionIds: ["CTEB"] }));
  });

  it("archive logiquement un personnel de la même école sans supprimer Auth ni Firestore", async () => {
    mocks.db.doc.mockImplementation((path: string) => ({
      path,
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => path === "users/admin-1"
          ? { role: "school_admin", schoolId: "school-1", status: "active" }
          : { role: "teacher", schoolId: "school-1", status: "active", active: true, name: "Enseignant" },
      }),
    }));
    const res = response();
    await provisionSchoolAccount(request({ action: "archive-personnel", schoolId: "school-1", personnelId: "teacher-1" }), res);

    expect(res.statusCode).toBe(200);
    expect(mocks.auth.updateUser).toHaveBeenCalledWith("teacher-1", { disabled: true });
    expect(mocks.auth.revokeRefreshTokens).toHaveBeenCalledWith("teacher-1");
    expect(mocks.auth.deleteUser).not.toHaveBeenCalled();
    const batch = mocks.db.batch.mock.results[0]?.value;
    expect(batch.update).toHaveBeenCalledWith(expect.objectContaining({ path: "users/teacher-1" }), expect.objectContaining({ status: "inactive", active: false, archivedBy: "admin-1" }));
    expect(batch.delete).not.toHaveBeenCalled();
  });

  it("refuse l’auto-archivage, les parents, les autres écoles et les autres rôles", async () => {
    async function run(caller: Record<string, unknown>, target: Record<string, unknown>, personnelId = "target") {
      mocks.auth.verifyIdToken.mockResolvedValueOnce(caller);
      mocks.db.doc.mockImplementation((path: string) => ({
        path,
        get: vi.fn().mockResolvedValue({ exists: true, data: () => path === `users/${String(caller.uid)}` ? caller : target }),
      }));
      const res = response();
      await provisionSchoolAccount(request({ action: "archive-personnel", schoolId: "school-1", personnelId }), res);
      return res;
    }

    expect((await run({ uid: "admin-1", role: "school_admin", schoolId: "school-1", status: "active" }, { role: "school_admin", schoolId: "school-1" }, "admin-1")).statusCode).toBe(403);
    expect((await run({ uid: "admin-1", role: "school_admin", schoolId: "school-1", status: "active" }, { role: "school_admin", schoolId: "school-1" }, "admin-2")).statusCode).toBe(403);
    expect((await run({ uid: "admin-1", role: "school_admin", schoolId: "school-1", status: "active" }, { role: "parent", schoolId: "school-1" })).statusCode).toBe(403);
    expect((await run({ uid: "admin-1", role: "school_admin", schoolId: "school-1", status: "active" }, { role: "teacher", schoolId: "school-2" })).statusCode).toBe(403);
    expect((await run({ uid: "director-1", role: "study_director", schoolId: "school-1", status: "active" }, { role: "teacher", schoolId: "school-1" })).statusCode).toBe(403);
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });
});
