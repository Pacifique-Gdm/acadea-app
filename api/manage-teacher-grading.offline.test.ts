import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), active: vi.fn(), rate: vi.fn(), attendance: vi.fn(), grading: vi.fn() }));
vi.mock("./_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: {}, db: {} }) }));
vi.mock("./_lib/activeUser.js", () => ({ verifyActorIdToken: mocks.verify, requireActiveApiUser: mocks.active }));
vi.mock("./_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { FINANCE_CREATE: { limit: 60, windowMs: 60000 } },
  enforceApiRateLimit: mocks.rate, sendRateLimitError: () => false }));
vi.mock("./_lib/offlineAttendance.js", () => ({ OfflineAttendanceError: class extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}, syncOfflineAttendance: mocks.attendance }));
vi.mock("./_lib/teacherGrading.js", () => ({ GradingApiError: class extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}, executeTeacherGrading: mocks.grading }));
vi.mock("./_lib/gradePublication.js", () => ({ executeGradePublication: vi.fn() }));
vi.mock("./_lib/schoolYearArchive.js", () => ({ executeSchoolYearArchive: vi.fn() }));
vi.mock("./_lib/timetableWorkflow.js", () => ({ executeTimetableWorkflow: vi.fn() }));
vi.mock("./_lib/pedagogicalActivity.js", () => ({ PedagogicalHistoryError: class extends Error {}, listPedagogicalActivity: vi.fn() }));
import handler from "./manage-teacher-grading.js";

function response() {
  return { code: 0, body: {} as Record<string, unknown>, status(value: number) { this.code = value; return this; },
    json(value: Record<string, unknown>) { this.body = value; } };
}
const caller = { uid: "director-a", role: "discipline_director", schoolId: "school-a" };
const request = (action: string, authorization = "Bearer local-test") => ({ method: "POST", headers: { authorization },
  body: { action, operationId: "7e791e6d-cf08-43b9-8dc4-3ca61f3e54ff", schoolId: "school-a" } });

describe("route partagée de présence locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue(caller);
    mocks.attendance.mockResolvedValue({ ok: true, attendanceId: "attendance-a" });
    mocks.grading.mockResolvedValue({ ok: true });
  });

  it("exige un jeton et un profil actif avant la présence", async () => {
    const missing = response();
    await handler(request("sync-offline-attendance", ""), missing);
    expect(missing.code).toBe(401);
    expect(mocks.attendance).not.toHaveBeenCalled();
    mocks.active.mockRejectedValueOnce(Object.assign(new Error("Compte inactif."), { statusCode: 403, code: "permission-denied" }));
    const denied = response();
    await handler(request("sync-offline-attendance"), denied);
    expect(denied.code).toBe(403);
    expect(mocks.attendance).not.toHaveBeenCalled();
  });

  it("applique la limite et transmet au service transactionnel sans nouvelle fonction Vercel", async () => {
    const res = response();
    await handler(request("sync-offline-attendance"), res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, attendanceId: "attendance-a" });
    expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ actorId: caller.uid, schoolId: caller.schoolId,
      action: "offline.attendance", idempotencyKey: "7e791e6d-cf08-43b9-8dc4-3ca61f3e54ff" }));
    expect(mocks.attendance).toHaveBeenCalledWith({ db: expect.anything(), caller, body: request("sync-offline-attendance").body });
  });

  it("préserve les actions de cotation existantes", async () => {
    const res = response();
    await handler(request("load"), res);
    expect(res.code).toBe(200);
    expect(mocks.grading).toHaveBeenCalledOnce();
    expect(mocks.attendance).not.toHaveBeenCalled();
  });
});
