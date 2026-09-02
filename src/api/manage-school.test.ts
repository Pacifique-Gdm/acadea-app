import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  documentGet: vi.fn(),
  yearsGet: vi.fn(),
  deleteSchoolCompletely: vi.fn(),
  batchUpdate: vi.fn(),
  batchSet: vi.fn(),
  batchCommit: vi.fn(),
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({
  initAdmin: () => ({
    auth: { verifyIdToken: mocks.verifyIdToken },
    db: {
      doc: (path: string) => ({ path, get: () => mocks.documentGet(path) }),
      collection: (name: string) => name === "schoolYears"
        ? { where: () => ({ get: mocks.yearsGet }) }
        : { doc: () => ({ id: "audit-school-update" }) },
      batch: () => ({ update: mocks.batchUpdate, set: mocks.batchSet, commit: mocks.batchCommit }),
    },
    bucket: {},
  }),
  firebaseAdminPublicError: () => ({ code: "internal", message: "Service indisponible.", correlationId: "acadea-test" }),
}));
vi.mock("../../api/_lib/schoolDeletion.js", () => ({ deleteSchoolCompletely: mocks.deleteSchoolCompletely }));
vi.mock("../../api/_lib/rateLimit.js", () => ({
  API_RATE_LIMITS: { SCHOOL_DELETE: {}, SCHOOL_ADMIN: {} },
  enforceApiRateLimit: vi.fn(),
  sendRateLimitError: () => false,
}));

// @ts-expect-error API JavaScript handler has no declaration file.
import handler from "../../api/manage-school.js";

function response() {
  return { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value); } };
}

function request(body: Record<string, unknown>) {
  return { method: "POST", headers: { authorization: "Bearer test-token" }, body };
}

describe("API SEC-004 manage-school", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIdToken.mockResolvedValue({ uid: "super-1", role: "super_admin", email: "super@test" });
    mocks.documentGet.mockImplementation(async (path: string) => path === "schools/school-a"
      ? { exists: true, id: "school-a", data: () => ({ id: "school-a", status: "active", activeSchoolYearId: "year-active", currency: "USD", motto: "Toujours plus haut" }) }
      : { exists: true, id: "year-active", data: () => ({ id: "year-active", schoolId: "school-a", status: "active", currency: "USD" }) });
    mocks.yearsGet.mockResolvedValue({ docs: [
      { id: "year-legacy", ref: { path: "schoolYears/year-legacy" }, data: () => ({ schoolId: "school-a", status: "archived" }) },
      { id: "year-active", ref: { path: "schoolYears/year-active" }, data: () => ({ schoolId: "school-a", status: "active", currency: "USD" }) },
    ] });
    mocks.deleteSchoolCompletely.mockResolvedValue({ status: "complete", firestore: { deleted: 5, collections: [] }, auth: { found: 1, deleted: 1, alreadyMissing: 0, failed: [], skipped: 0 }, storageDeleted: 2 });
    mocks.batchCommit.mockResolvedValue(undefined);
  });

  it("réserve la suppression au Super Administrateur", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "admin", role: "school_admin", schoolId: "school-a" });
    const res = response(); await handler(request({ action: "delete", schoolId: "school-a", confirmation: "SUPPRIMER ECOLE" }), res);
    expect(res.statusCode).toBe(403); expect(mocks.deleteSchoolCompletely).not.toHaveBeenCalled();
  });

  it("réserve aussi le changement de devise au Super Administrateur", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "admin", role: "school_admin", schoolId: "school-a" });
    const res = response(); await handler(request({ action: "change-currency", schoolId: "school-a", schoolYearId: "year-active", currency: "CDF", confirmation: "CHANGER LA DEVISE" }), res);
    expect(res.statusCode).toBe(403);
    expect(mocks.batchCommit).not.toHaveBeenCalled();
  });

  it("exige la confirmation textuelle exacte", async () => {
    const res = response(); await handler(request({ action: "delete", schoolId: "school-a", confirmation: "supprimer ecole" }), res);
    expect(res.statusCode).toBe(400); expect(mocks.deleteSchoolCompletely).not.toHaveBeenCalled();
  });

  it("refuse de contourner l'action sécurisée via la mise à jour générique", async () => {
    const res = response(); await handler(request({ action: "update", schoolId: "school-a", patch: { currency: "CDF" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid-argument" });
  });

  it.each(["changer la devise", "Changer la devise", "CHANGER LA DEVISE ", " CHANGER LA DEVISE", "CHANGER  LA DEVISE"])("refuse la variante de confirmation %s", async (confirmation) => {
    const res = response(); await handler(request({ action: "change-currency", schoolId: "school-a", schoolYearId: "year-active", currency: "CDF", confirmation }), res);
    expect(res.statusCode).toBe(400);
    expect(mocks.batchCommit).not.toHaveBeenCalled();
  });

  it("persiste la devise de l'année active et matérialise l'ancienne devise sans toucher au motto", async () => {
    const res = response(); await handler(request({ action: "change-currency", schoolId: "school-a", schoolYearId: "year-active", currency: "CDF", confirmation: "CHANGER LA DEVISE" }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-a" }), expect.objectContaining({ currency: "CDF", updatedBy: "super-1" }));
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "schoolYears/year-active" }), expect.objectContaining({ currency: "CDF", updatedBy: "super-1" }));
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "schoolYears/year-legacy" }), expect.objectContaining({ currency: "USD", updatedBy: "super-1" }));
    expect(mocks.batchUpdate.mock.calls.every(([reference]) => /^(schools|schoolYears)\//.test(reference.path))).toBe(true);
    expect(mocks.batchUpdate.mock.calls.flatMap((call) => Object.keys(call[1]))).not.toContain("motto");
    expect(res.body).toMatchObject({ school: { id: "school-a", motto: "Toujours plus haut" }, schoolYear: { id: "year-active" } });
  });

  it("prend aussi en charge le passage CDF vers USD", async () => {
    mocks.documentGet.mockImplementation(async (path: string) => path === "schools/school-a"
      ? { exists: true, id: "school-a", data: () => ({ id: "school-a", status: "active", activeSchoolYearId: "year-active", currency: "CDF", motto: "Toujours plus haut" }) }
      : { exists: true, id: "year-active", data: () => ({ id: "year-active", schoolId: "school-a", status: "active", currency: "CDF" }) });
    mocks.yearsGet.mockResolvedValue({ docs: [
      { id: "year-archived", ref: { path: "schoolYears/year-archived" }, data: () => ({ schoolId: "school-a", status: "archived", currency: "CDF" }) },
      { id: "year-active", ref: { path: "schoolYears/year-active" }, data: () => ({ schoolId: "school-a", status: "active", currency: "CDF" }) },
    ] });

    const res = response(); await handler(request({ action: "change-currency", schoolId: "school-a", schoolYearId: "year-active", currency: "USD", confirmation: "CHANGER LA DEVISE" }), res);

    expect(res.statusCode).toBe(200);
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-a" }), expect.objectContaining({ currency: "USD" }));
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "schoolYears/year-active" }), expect.objectContaining({ currency: "USD" }));
    expect(mocks.batchUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ path: "schoolYears/year-archived" }), expect.anything());
  });

  it("refuse une année d'une autre école ou non active", async () => {
    mocks.documentGet.mockImplementation(async (path: string) => path === "schools/school-a"
      ? { exists: true, id: "school-a", data: () => ({ activeSchoolYearId: "year-active", currency: "USD" }) }
      : { exists: true, id: "year-active", data: () => ({ schoolId: "school-b", status: "active", currency: "USD" }) });
    const res = response(); await handler(request({ action: "change-currency", schoolId: "school-a", schoolYearId: "year-active", currency: "CDF", confirmation: "CHANGER LA DEVISE" }), res);
    expect(res.statusCode).toBe(409);
    expect(mocks.batchCommit).not.toHaveBeenCalled();
  });

  it("rend le second appel idempotent lorsque l'école est déjà absente", async () => {
    mocks.documentGet.mockResolvedValue({ exists: false });
    const res = response(); await handler(request({ action: "delete", schoolId: "school-a", confirmation: "SUPPRIMER ECOLE" }), res);
    expect(res.statusCode).toBe(200); expect(res.body).toMatchObject({ schoolId: "school-a", status: "complete", alreadyDeleted: true });
  });
});
