import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  schoolGet: vi.fn(),
  deleteSchoolCompletely: vi.fn(),
  batchUpdate: vi.fn(),
  batchSet: vi.fn(),
  batchCommit: vi.fn(),
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({
  initAdmin: () => ({
    auth: { verifyIdToken: mocks.verifyIdToken },
    db: {
      doc: (path: string) => ({ path, get: mocks.schoolGet }),
      collection: () => ({ doc: () => ({ id: "audit-school-update" }) }),
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
    mocks.schoolGet.mockResolvedValue({ exists: true, data: () => ({ id: "school-a", status: "active" }) });
    mocks.deleteSchoolCompletely.mockResolvedValue({ status: "complete", firestore: { deleted: 5, collections: [] }, auth: { found: 1, deleted: 1, alreadyMissing: 0, failed: [], skipped: 0 }, storageDeleted: 2 });
    mocks.batchCommit.mockResolvedValue(undefined);
  });

  it("réserve la suppression au Super Administrateur", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "admin", role: "school_admin", schoolId: "school-a" });
    const res = response(); await handler(request({ action: "delete", schoolId: "school-a", confirmation: "SUPPRIMER ECOLE" }), res);
    expect(res.statusCode).toBe(403); expect(mocks.deleteSchoolCompletely).not.toHaveBeenCalled();
  });

  it("exige la confirmation textuelle exacte", async () => {
    const res = response(); await handler(request({ action: "delete", schoolId: "school-a", confirmation: "supprimer ecole" }), res);
    expect(res.statusCode).toBe(400); expect(mocks.deleteSchoolCompletely).not.toHaveBeenCalled();
  });

  it("refuse une devise hors du référentiel USD/CDF", async () => {
    const res = response(); await handler(request({ action: "update", schoolId: "school-a", patch: { currency: "EUR" } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid-argument" });
  });

  it("persiste une devise canonique avec l'identité du Super Administrateur", async () => {
    mocks.schoolGet.mockResolvedValue({ exists: true, id: "school-a", data: () => ({ id: "school-a", status: "active", currency: "CDF" }) });
    const res = response(); await handler(request({ action: "update", schoolId: "school-a", patch: { currency: "CDF" } }), res);
    expect(res.statusCode).toBe(200);
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-a" }), expect.objectContaining({ currency: "CDF", updatedBy: "super-1" }));
    expect(res.body).toMatchObject({ school: { id: "school-a", currency: "CDF" } });
  });

  it("rend le second appel idempotent lorsque l'école est déjà absente", async () => {
    mocks.schoolGet.mockResolvedValue({ exists: false });
    const res = response(); await handler(request({ action: "delete", schoolId: "school-a", confirmation: "SUPPRIMER ECOLE" }), res);
    expect(res.statusCode).toBe(200); expect(res.body).toMatchObject({ schoolId: "school-a", status: "complete", alreadyDeleted: true });
  });
});
