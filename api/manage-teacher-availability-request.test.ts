import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), active: vi.fn(), read: vi.fn(), rate: vi.fn(), create: vi.fn(), review: vi.fn(),
}));
vi.mock("./_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: {}, db: {} }) }));
vi.mock("./_lib/activeUser.js", () => ({ verifyActorIdToken: mocks.verify, requireActiveApiUser: mocks.active }));
vi.mock("./_lib/publishedTimetableRead.js", () => ({ PublishedTimetableReadError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }, readPublishedTimetable: mocks.read }));
vi.mock("./_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { PUBLISHED_TIMETABLE: { limit: 60, windowMs: 60000 } }, enforceApiRateLimit: mocks.rate, sendRateLimitError: () => false }));
vi.mock("./_lib/teacherAvailabilityRequests.js", () => ({ AvailabilityRequestApiError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }, createAvailabilityRequest: mocks.create, reviewAvailabilityRequest: mocks.review }));
import handler from "./manage-teacher-availability-request.js";

function response() {
  const result = { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end: vi.fn(function (this: typeof result, body: string) { this.body = JSON.parse(body); }) };
  return result;
}
const request = (query: Record<string, unknown>, authorization?: string) => ({ method: "GET", query, headers: { authorization } });

describe("frontière HTTP de l'horaire publié", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ uid: "admin-a", role: "school_admin", schoolId: "school-a" });
    mocks.read.mockResolvedValue({ version: 1, rows: [] });
  });

  it("refuse l'absence de jeton et les paramètres d'école ou de vue falsifiés", async () => {
    const unauthenticated = response();
    await handler(request({ view: "published-timetable", schoolYearId: "year-a" }), unauthenticated);
    expect(unauthenticated.statusCode).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    for (const query of [
      { view: "published-timetable", schoolYearId: "year-a", schoolId: "school-b" },
      { view: "draft", schoolYearId: "year-a" },
    ]) {
      const res = response();
      await handler(request(query, "Bearer test-token"), res);
      expect(res.statusCode).toBe(400);
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("refuse un rôle non autorisé avant la lecture et ne transmet pas d'école issue des paramètres", async () => {
    mocks.verify.mockResolvedValueOnce({ uid: "cashier-a", role: "cashier", schoolId: "school-a" });
    const denied = response();
    await handler(request({ view: "published-timetable", schoolYearId: "year-a" }, "Bearer test-token"), denied);
    expect(denied.statusCode).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    const allowed = response();
    await handler(request({ view: "published-timetable", schoolYearId: "year-a" }, "Bearer test-token"), allowed);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(mocks.read).toHaveBeenCalledWith({ db: expect.anything(), caller: { uid: "admin-a", role: "school_admin", schoolId: "school-a" }, schoolYearId: "year-a" });
  });

  it("refuse un jeton invalide ou expiré sans lecture sensible", async () => {
    for (const message of ["Session invalide.", "Session expirée."]) {
      mocks.verify.mockRejectedValueOnce(Object.assign(new Error(message), { statusCode: 401, code: "unauthenticated" }));
      const res = response();
      await handler(request({ view: "published-timetable", schoolYearId: "year-a" }, "Bearer test-token"), res);
      expect(res.statusCode).toBe(401);
      expect(res.body).toMatchObject({ code: "unauthenticated" });
      expect(mocks.read).not.toHaveBeenCalled();
    }
  });

  it("renvoie une erreur serveur contrôlée sans divulguer sa cause", async () => {
    const diagnostic = "internal-test-diagnostic";
    const logging = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mocks.read.mockRejectedValueOnce(new Error(diagnostic));
      const res = response();
      await handler(request({ view: "published-timetable", schoolYearId: "year-a" }, "Bearer test-token"), res);
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: "Horaire publié indisponible.", code: "internal" });
      expect(JSON.stringify(res.body)).not.toContain(diagnostic);
    } finally {
      logging.mockRestore();
    }
  });

  it("préserve le POST de création et refuse les autres méthodes", async () => {
    const created = { id: "request-a" };
    mocks.create.mockResolvedValueOnce(created);
    const res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer test-token" }, body: { action: "CREATE", request: { reason: "Test" } } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ request: created });
    expect(mocks.create).toHaveBeenCalledWith({ db: expect.anything(), caller: { uid: "admin-a", role: "school_admin", schoolId: "school-a" }, request: { reason: "Test" } });
    expect(mocks.read).not.toHaveBeenCalled();
    const denied = response();
    await handler({ method: "DELETE" }, denied);
    expect(denied.statusCode).toBe(405);
  });
});
