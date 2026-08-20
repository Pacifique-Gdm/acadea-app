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
    runTransaction: vi.fn(),
  },
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({
  initAdmin: () => ({ auth: mocks.auth, db: mocks.db }),
  firebaseAdminPublicError: (error: { code?: string }) => error?.code === "auth/email-already-exists"
    ? { code: error.code, message: "Cette adresse email est déjà utilisée" }
    : { code: "internal", message: "Service indisponible.", correlationId: "acadea-test" },
}));
vi.mock("../../api/_lib/rateLimit.js", () => ({
  API_RATE_LIMITS: { PROVISION_SCHOOL: {}, PROVISION_ACCOUNT: {}, PROVISION_DESTRUCTIVE: {} },
  enforceApiRateLimit: vi.fn(),
  sendRateLimitError: () => false,
}));

// @ts-expect-error The Vercel endpoint is intentionally implemented in JavaScript.
import provisionSchoolAccount, { unlinkParentFromStudent } from "../../api/provision-school-account.js";
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
  expect(normalizeSectionIds(["maternelle", "Primaire", "SECONDAIRE"])).toEqual(["Maternelle", "Primaire", "Secondaire"]);
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
    mocks.db.runTransaction.mockImplementation(async (operation: (transaction: { get: (reference: { get: () => Promise<unknown> }) => Promise<unknown>; set: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }) => Promise<unknown>) => operation({ get: (reference) => reference.get(), set: vi.fn(), update: vi.fn() }));
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

  function configureParentUnlinkScenario({
    callerRole = "school_admin",
    callerSchoolId = "school-1",
    callerActive = true,
    studentExists = true,
    parentExists = true,
    studentSchoolId = "school-1",
    parentSchoolId = "school-1",
    studentParentId = "parent-1",
    parentStudentIds = ["student-1", "student-2"],
  }: {
    callerRole?: string;
    callerSchoolId?: string;
    callerActive?: boolean;
    studentExists?: boolean;
    parentExists?: boolean;
    studentSchoolId?: string;
    parentSchoolId?: string;
    studentParentId?: string | null;
    parentStudentIds?: string[];
  } = {}) {
    const parentUserRef = { path: "users/parent-user-1" };
    const snapshots: Record<string, { exists: boolean; data: () => Record<string, unknown> }> = {
      "schools/school-1": { exists: true, data: () => ({ id: "school-1", status: "active" }) },
      "schoolYears/year-1": { exists: true, data: () => ({ id: "year-1", schoolId: "school-1", status: "active" }) },
      "users/actor-1": { exists: true, data: () => ({ id: "actor-1", role: callerRole, schoolId: callerSchoolId, status: callerActive ? "active" : "inactive", active: callerActive }) },
      "students/student-1": { exists: studentExists, data: () => ({ id: "student-1", schoolId: studentSchoolId, schoolYearId: "year-1", parentId: studentParentId }) },
      "parents/parent-1": { exists: parentExists, data: () => ({ id: "parent-1", schoolId: parentSchoolId, schoolYearId: "year-1", studentIds: parentStudentIds, userId: "parent-user-1" }) },
    };
    const reference = (path: string) => ({ path, get: vi.fn(async () => snapshots[path] ?? { exists: false, data: () => ({}) }) });
    const parentUsersQuery = {
      get: vi.fn(async () => ({
        docs: [{ ref: parentUserRef, data: () => ({ id: "parent-user-1", role: "parent", schoolId: "school-1", parentId: "parent-1", studentIds: ["student-1", "student-2"] }) }],
      })),
    };
    const auditRef = { id: "audit-unlink", path: "auditLogs/audit-unlink" };
    mocks.db.doc.mockImplementation(reference);
    mocks.db.collection.mockImplementation((name: string) => name === "users"
      ? { where: vi.fn(() => ({ where: vi.fn(() => parentUsersQuery) })) }
      : { doc: vi.fn(() => auditRef) });
    const transaction = {
      get: vi.fn(async (target: { get: () => Promise<unknown> }) => target.get()),
      update: vi.fn(),
      set: vi.fn(),
    };
    mocks.db.runTransaction.mockImplementation(async (operation: (value: typeof transaction) => Promise<unknown>) => operation(transaction));
    return { transaction, parentUserRef, auditRef };
  }

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

  it.each(["school_admin", "secretary"])("délie atomiquement un parent avec le rôle %s sans supprimer son compte ni ses autres enfants", async (role) => {
    const { transaction, parentUserRef, auditRef } = configureParentUnlinkScenario({ callerRole: role });
    const result = await unlinkParentFromStudent({
      db: mocks.db,
      caller: { uid: "actor-1", role, schoolId: "school-1" },
      body: { schoolId: "school-1", schoolYearId: "year-1", studentId: "student-1", parentId: "parent-1", confirmation: "DÉLIER LE PARENT" },
    });

    expect(result).toMatchObject({ studentId: "student-1", parentId: "parent-1", parentStudentIds: ["student-2"], auditLogId: "audit-unlink" });
    expect(transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: "students/student-1" }), expect.objectContaining({ parentId: null, updatedBy: "actor-1" }));
    expect(transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: "parents/parent-1" }), expect.objectContaining({ studentIds: ["student-2"], updatedBy: "actor-1" }));
    expect(transaction.update).toHaveBeenCalledWith(parentUserRef, expect.objectContaining({ studentIds: ["student-2"] }));
    expect(transaction.set).toHaveBeenCalledWith(auditRef, expect.objectContaining({ eventType: "parent.unlinked_from_student", actorId: "actor-1", schoolId: "school-1", schoolYearId: "year-1", source: "server" }));
    expect(mocks.auth.deleteUser).not.toHaveBeenCalled();
  });

  it("expose la déliaison via l'action sécurisée de l'API existante", async () => {
    configureParentUnlinkScenario();
    mocks.auth.verifyIdToken.mockResolvedValue({ uid: "actor-1", role: "school_admin", schoolId: "school-1" });
    const res = response();
    await provisionSchoolAccount(request({
      action: "unlink-parent-from-student",
      schoolId: "school-1",
      schoolYearId: "year-1",
      studentId: "student-1",
      parentId: "parent-1",
      confirmation: "DÉLIER LE PARENT",
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ studentId: "student-1", parentId: "parent-1", parentStudentIds: ["student-2"] });
  });

  it("refuse toute écriture lorsque la confirmation n'est pas strictement exacte", async () => {
    configureParentUnlinkScenario();
    await expect(unlinkParentFromStudent({
      db: mocks.db,
      caller: { uid: "actor-1", role: "school_admin", schoolId: "school-1" },
      body: { schoolId: "school-1", schoolYearId: "year-1", studentId: "student-1", parentId: "parent-1", confirmation: "DÉLIER LE PARENT " },
    })).rejects.toMatchObject({ code: "invalid-confirmation", statusCode: 400 });
    expect(mocks.db.runTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["cashier", "school-1"],
    ["school_admin", "school-2"],
  ])("refuse le rôle ou l'école non autorisés (%s, %s)", async (role, callerSchoolId) => {
    configureParentUnlinkScenario({ callerRole: role, callerSchoolId });
    await expect(unlinkParentFromStudent({
      db: mocks.db,
      caller: { uid: "actor-1", role, schoolId: callerSchoolId },
      body: { schoolId: "school-1", schoolYearId: "year-1", studentId: "student-1", parentId: "parent-1", confirmation: "DÉLIER LE PARENT" },
    })).rejects.toMatchObject({ code: "permission-denied", statusCode: 403 });
    expect(mocks.db.runTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["acteur inactif", { callerActive: false }, "permission-denied"],
    ["élève absent", { studentExists: false }, "student-not-found"],
    ["parent absent", { parentExists: false }, "parent-not-found"],
    ["relation absente", { studentParentId: null }, "parent-link-not-found"],
    ["relation incohérente", { parentStudentIds: ["student-2"] }, "parent-link-not-found"],
    ["élève d'une autre école", { studentSchoolId: "school-2" }, "permission-denied"],
    ["parent d'une autre école", { parentSchoolId: "school-2" }, "permission-denied"],
  ])("refuse le cas %s sans écriture partielle", async (_label, scenario, code) => {
    const { transaction } = configureParentUnlinkScenario(scenario);
    await expect(unlinkParentFromStudent({
      db: mocks.db,
      caller: { uid: "actor-1", role: "school_admin", schoolId: "school-1" },
      body: { schoolId: "school-1", schoolYearId: "year-1", studentId: "student-1", parentId: "parent-1", confirmation: "DÉLIER LE PARENT" },
    })).rejects.toMatchObject({ code });
    expect(transaction.update).not.toHaveBeenCalled();
    expect(transaction.set).not.toHaveBeenCalled();
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

  it("persiste les options initiales dédupliquées avec Sciences comme libellé canonique", async () => {
    mocks.auth.verifyIdToken.mockResolvedValue({ uid: "super-1", role: "super_admin", email: "super@example.invalid" });
    const res = response();
    await provisionSchoolAdmin(request({
      schoolName: "École options", adminName: "Administrateur test", adminEmail: "options@example.invalid", adminPassword: "test-password",
      educationLevels: ["Secondaire"], schoolOptions: ["Scientifique", " SCIENCES ", "Littéraire"], currency: "CDF",
    }), res);
    expect(res.statusCode).toBe(200);
    const schoolRef = mocks.db.doc.mock.results.map((result) => result.value as { path?: string; set?: ReturnType<typeof vi.fn> }).find((ref) => ref.path?.startsWith("schools/school-"));
    expect(schoolRef?.set).toHaveBeenCalledWith(expect.objectContaining({ schoolOptions: ["Sciences", "Littéraire"], currency: "CDF" }));
  });

  it("refuse une devise arbitraire lors du provisionnement", async () => {
    mocks.auth.verifyIdToken.mockResolvedValue({ uid: "super-1", role: "super_admin", email: "super@example.invalid" });
    const res = response();
    await provisionSchoolAdmin(request({ schoolName: "École", adminName: "Admin", adminEmail: "invalid@example.invalid", adminPassword: "test-password", currency: "EUR" }), res);
    expect(res.statusCode).toBe(400);
    expect(mocks.auth.createUser).not.toHaveBeenCalled();
  });

  it("normalise l’email et refuse proprement un doublon garanti par Firebase Auth", async () => {
    mocks.auth.createUser.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "auth/email-already-exists" }));
    const res = response();
    await provisionSchoolAccount(request({ role: "cashier", schoolId: "school-1", schoolYearId: "year-1", name: "Utilisateur test", email: " USER@ECOLE.CD ", password: "test-password", phone: "0991234567" }), res);
    expect(mocks.auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "user@ecole.cd" }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: "Cette adresse email est déjà utilisée", code: "auth/email-already-exists" });
    expect(mocks.db.doc).not.toHaveBeenCalledWith("users/created-user");
  });

  it("autorise la conservation de son propre email lors d’une modification", async () => {
    mocks.db.doc.mockImplementation((path: string) => ({ path, get: vi.fn().mockResolvedValue({ exists: true, data: () => path === "users/admin-1" ? { role: "school_admin", schoolId: "school-1", status: "active" } : path === "schools/school-1" ? { educationLevels: ["Primaire"] } : { role: "teacher", schoolId: "school-1", status: "active", email: "same@example.invalid" } }) }));
    const res = response();
    await provisionSchoolAccount(request({ action: "update-personnel", schoolId: "school-1", personnelId: "teacher-1", name: "Enseignant", phone: "099", email: " SAME@EXAMPLE.INVALID ", sectionIds: ["Primaire"] }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.auth.updateUser).toHaveBeenCalledWith("teacher-1", expect.objectContaining({ email: "same@example.invalid" }));
  });

  it("alloue un matricule stable dans la transaction tenantée et conserve createdAt", async () => {
    const reads = new Map<string, { exists: boolean; data: () => Record<string, unknown> }>([
      ["personnelProfiles/teacher-1", { exists: false, data: () => ({}) }],
      ["schools/school-1/counters/personnelMatricules", { exists: true, data: () => ({ lastNumber: 4 }) }],
    ]);
    const transaction = { get: vi.fn(async (reference: { path: string }) => reads.get(reference.path) ?? { exists: false, data: () => ({}) }), set: vi.fn(), update: vi.fn() };
    mocks.db.runTransaction.mockImplementationOnce(async (operation: (value: typeof transaction) => Promise<unknown>) => operation(transaction));
    mocks.db.doc.mockImplementation((path: string) => ({ path, get: vi.fn().mockResolvedValue({ exists: true, data: () => path === "users/admin-1" ? { role: "school_admin", schoolId: "school-1", status: "active" } : path === "schools/school-1" ? { educationLevels: ["Primaire"] } : { role: "teacher", schoolId: "school-1", status: "active" } }) }));
    const res = response();
    await provisionSchoolAccount(request({ action: "update-personnel", schoolId: "school-1", personnelId: "teacher-1", name: "Kabeya Ilunga Alice", phone: "099", email: "teacher@example.test", sectionIds: ["Primaire"], profile: { lastName: "Kabeya", middleName: "Ilunga", firstName: "Alice", jobTitle: "Professeure", birthPlace: "Kinshasa" } }), res);
    expect(res.statusCode).toBe(200);
    expect(transaction.set).toHaveBeenCalledWith(expect.objectContaining({ path: "personnelProfiles/teacher-1" }), expect.objectContaining({ matricule: "PER-000005", createdAt: expect.any(String), schoolId: "school-1", lastName: "Kabeya", middleName: "Ilunga", firstName: "Alice", jobTitle: "Professeure" }));
    expect(transaction.set).toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-1/counters/personnelMatricules" }), expect.objectContaining({ lastNumber: 5 }), { merge: true });
  });

  it("compense Auth si la transaction Firestore échoue", async () => {
    mocks.db.runTransaction.mockRejectedValueOnce(new Error("transaction failed"));
    mocks.db.doc.mockImplementation((path: string) => ({ path, get: vi.fn().mockResolvedValue({ exists: true, data: () => path === "users/admin-1" ? { role: "school_admin", schoolId: "school-1", status: "active" } : path === "schools/school-1" ? { educationLevels: ["Primaire"] } : { role: "teacher", schoolId: "school-1", status: "active" } }) }));
    const res = response();
    await provisionSchoolAccount(request({ action: "update-personnel", schoolId: "school-1", personnelId: "teacher-1", name: "Nouveau", phone: "099", email: "new@example.test", sectionIds: ["Primaire"] }), res);
    expect(res.statusCode).toBe(500);
    expect(mocks.auth.updateUser).toHaveBeenNthCalledWith(1, "teacher-1", { displayName: "Nouveau", email: "new@example.test" });
    expect(mocks.auth.updateUser).toHaveBeenNthCalledWith(2, "teacher-1", { displayName: "Ancien nom", email: "old@example.invalid" });
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

  it("réactive un enseignant avec des claims restaurés et un contexte pédagogique réinitialisé", async () => {
    const oldTeacherRef = { path: "teachers/old-teacher" };
    const assignmentRef = { path: "pedagogicalAssignments/old-assignment" };
    const teacherSnapshot = { id: "old-teacher", ref: oldTeacherRef, data: () => ({ userId: "teacher-1", schoolId: "school-1", schoolYearId: "year-1", status: "active", active: true }) };
    const assignmentSnapshot = { id: "old-assignment", ref: assignmentRef, data: () => ({ teacherId: "old-teacher", schoolId: "school-1", schoolYearId: "year-1", active: true }) };
    mocks.auth.getUser.mockResolvedValue({ uid: "teacher-1", customClaims: {} });
    mocks.db.doc.mockImplementation((path: string) => ({
      path,
      get: vi.fn().mockResolvedValue(path === "users/admin-1"
        ? { exists: true, data: () => ({ role: "school_admin", schoolId: "school-1", status: "active" }) }
        : path === "users/teacher-1"
          ? { exists: true, data: () => ({ role: "teacher", schoolId: "school-1", status: "inactive", active: false, activeSchoolYearId: "year-1" }) }
          : { exists: false }),
    }));
    mocks.db.collection.mockImplementation((name: string) => ({
      doc: vi.fn(() => ({ id: "audit-test", set: vi.fn().mockResolvedValue(undefined) })),
      where: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: name === "teachers" ? [teacherSnapshot] : name === "pedagogicalAssignments" ? [assignmentSnapshot] : [] }) })),
    }));
    const res = response();
    await provisionSchoolAccount(request({ action: "reactivate-personnel", schoolId: "school-1", personnelId: "teacher-1" }), res);

    expect(res.statusCode).toBe(200);
    expect(mocks.auth.setCustomUserClaims).toHaveBeenCalledWith("teacher-1", { role: "teacher", schoolId: "school-1" });
    const batch = mocks.db.batch.mock.results[0]?.value;
    expect(batch.update).toHaveBeenCalledWith(oldTeacherRef, expect.objectContaining({ status: "active", active: true }));
    expect(batch.update).toHaveBeenCalledWith(assignmentRef, expect.objectContaining({ active: false }));
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
