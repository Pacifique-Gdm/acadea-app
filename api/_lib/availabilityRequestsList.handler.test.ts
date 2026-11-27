import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot B : lecture des demandes d'indisponibilité par l'API existante (aucun nouveau fichier api/*.js).
const mocks = vi.hoisted(() => ({ verify: vi.fn(), active: vi.fn(), rate: vi.fn(), list: vi.fn(), read: vi.fn() }));
vi.mock("./firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: {}, db: {} }) }));
vi.mock("./activeUser.js", () => ({ verifyActorIdToken: mocks.verify, requireActiveApiUser: mocks.active }));
vi.mock("./publishedTimetableRead.js", () => ({ PublishedTimetableReadError: class extends Error {}, readPublishedTimetable: mocks.read }));
vi.mock("./rateLimit.js", () => ({ API_RATE_LIMITS: { PUBLISHED_TIMETABLE: { limit: 60, windowMs: 60000 } }, enforceApiRateLimit: mocks.rate, sendRateLimitError: () => false }));
vi.mock("./teacherAvailabilityRequests.js", () => ({
  AvailabilityRequestApiError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
  createAvailabilityRequest: vi.fn(), reviewAvailabilityRequest: vi.fn(), listAvailabilityRequests: mocks.list,
}));
import handler from "./teacherAvailabilityHandler.js";

function response() {
  const result = { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end: vi.fn(function (this: typeof result, body: string) { this.body = JSON.parse(body); }) };
  return result;
}
const get = (query: Record<string, unknown>, authorization?: string) => ({ method: "GET", query, headers: { authorization } });

describe("Lot B — GET view=availability-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ uid: "d", role: "study_director", schoolId: "s" });
    mocks.list.mockResolvedValue([{ id: "r" }]);
  });
  it("renvoie la liste calculée par le serveur pour l'école du jeton", async () => {
    const res = response();
    await handler(get({ view: "availability-requests", schoolYearId: "y" }, "Bearer jeton"), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ requests: [{ id: "r" }] });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(mocks.list).toHaveBeenCalledWith({ db: expect.anything(), caller: { uid: "d", role: "study_director", schoolId: "s" }, schoolYearId: "y" });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("refuse sans jeton, un paramètre en trop et un autre rôle, sans lecture", async () => {
    const noToken = response();
    await handler(get({ view: "availability-requests", schoolYearId: "y" }), noToken);
    expect(noToken.statusCode).toBe(401);
    const extra = response();
    await handler(get({ view: "availability-requests", schoolYearId: "y", schoolId: "autre" }, "Bearer jeton"), extra);
    expect(extra.statusCode).toBe(400);
    mocks.verify.mockResolvedValueOnce({ uid: "t", role: "teacher", schoolId: "s" });
    const teacher = response();
    await handler(get({ view: "availability-requests", schoolYearId: "y" }, "Bearer jeton"), teacher);
    expect(teacher.statusCode).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
