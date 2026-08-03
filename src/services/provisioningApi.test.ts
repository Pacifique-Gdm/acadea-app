import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    verifyIdToken: vi.fn(),
    createUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
    deleteUser: vi.fn(),
  },
  db: {
    doc: vi.fn(),
    collection: vi.fn(),
  },
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({
  initAdmin: () => ({ auth: mocks.auth, db: mocks.db }),
  firebaseAdminPublicError: (error: unknown) => ({
    code: "internal",
    details: error instanceof Error ? error.message : String(error),
  }),
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

describe("API de provisionnement Acadéa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.verifyIdToken.mockResolvedValue({ uid: "admin-1", role: "school_admin", schoolId: "school-1" });
    mocks.auth.createUser.mockResolvedValue({ uid: "created-user" });
    mocks.auth.setCustomUserClaims.mockResolvedValue(undefined);
    mocks.auth.deleteUser.mockResolvedValue(undefined);
    mocks.db.doc.mockImplementation((path: string) => ({
      path,
      get: vi.fn().mockResolvedValue(path === "schools/school-1" ? { exists: true, data: () => ({ id: "school-1" }) } : { exists: false }),
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

  for (const role of ["cashier", "secretary", "discipline_director"] as const) {
    it(`crée Firebase Auth, le profil Firestore et les claims pour ${role}`, async () => {
      const res = response();
      await provisionSchoolAccount(request({
        role, schoolId: "school-1", schoolYearId: "year-1", name: "Utilisateur test",
        email: `${role}@example.invalid`, password: "test-password", phone: "",
      }), res);

      expect(res.statusCode).toBe(200);
      expect(mocks.auth.createUser).toHaveBeenCalledOnce();
      expect(mocks.db.doc).toHaveBeenCalledWith("users/created-user");
      expect(mocks.auth.setCustomUserClaims).toHaveBeenCalledWith("created-user", { role, schoolId: "school-1" });
    });
  }

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
});
