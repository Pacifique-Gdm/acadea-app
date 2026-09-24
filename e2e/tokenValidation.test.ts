import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn().mockRejectedValue(Object.assign(new Error("Invalid token"), { code: "auth/invalid-id-token" })),
  enforceApiRateLimit: vi.fn().mockResolvedValue(undefined),
  profileData: {} as Record<string, unknown>,
}));

vi.mock("../api/_lib/firebaseAdmin.js", async (importOriginal) => ({
  ...await importOriginal(),
  initAdmin: () => ({ auth: { verifyIdToken: mocks.verifyIdToken }, db: { doc: () => ({ get: async () => ({ exists: true, data: () => ({ status: "active", active: true, ...mocks.profileData }) }) }) } }),
}));

vi.mock("../api/_lib/rateLimit.js", async (importOriginal) => ({
  ...await importOriginal(),
  enforceApiRateLimit: mocks.enforceApiRateLimit,
}));

import coordinationRecipients from "../api/coordination-message-recipients.js";
import coordinationYears from "../api/manage-coordination-school-years.js";
import manageCoordination from "../api/manage-coordination.js";
import manageFinance from "../api/manage-financial-transaction.js";
import manageSchool from "../api/manage-school.js";
import manageAvailability from "../api/manage-teacher-availability-request.js";
import manageGrading from "../api/manage-teacher-grading.js";
import messageRecipients from "../api/message-recipients.js";
import provisionAccount from "../api/provision-school-account.js";
import provisionAdmin from "../api/provision-school-admin.js";
import sendParentMessage from "../api/send-parent-message.js";
import sendSchoolMessage from "../api/send-school-message.js";

const endpoints = [
  ["coordination-message-recipients", coordinationRecipients, "GET"],
  ["manage-coordination-school-years", coordinationYears, "POST"],
  ["manage-coordination", manageCoordination, "POST"],
  ["manage-financial-transaction", manageFinance, "POST"],
  ["manage-school", manageSchool, "POST"],
  ["manage-teacher-availability-request", manageAvailability, "POST"],
  ["manage-teacher-grading", manageGrading, "POST"],
  ["message-recipients", messageRecipients, "GET"],
  ["provision-school-account", provisionAccount, "POST"],
  ["provision-school-admin", provisionAdmin, "POST"],
  ["send-parent-message", sendParentMessage, "GET"],
  ["send-school-message", sendSchoolMessage, "POST"],
];

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(body) { this.body = JSON.parse(body); return this; },
  };
}

describe("authentification des 12 API Vercel", () => {
  it.each(endpoints)("%s répond 401 sans jeton", async (_name, handler, method) => {
    const res = response();
    await handler({ method, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it.each(endpoints)("%s répond 401 à un jeton invalide", async (_name, handler, method) => {
    const res = response();
    await handler({ method, headers: { authorization: "Bearer invalid-token" }, body: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("Invalid token");
  });

  it.each(endpoints)("%s répond 401 à un jeton expiré", async (_name, handler, method) => {
    mocks.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error("Expired token"), { code: "auth/id-token-expired" }));
    const res = response();
    await handler({ method, headers: { authorization: "Bearer expired-token" }, body: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("Expired token");
  });
});

describe("entrée invalide de l’API des indisponibilités", () => {
  it("répond 400 à un JSON malformé après authentification", async () => {
    mocks.verifyIdToken.mockResolvedValueOnce({ uid: "director", role: "study_director", schoolId: "school-a" });
    const res = response();
    await manageAvailability({ method: "POST", headers: { authorization: "Bearer valid-token" }, body: "{" }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid-argument" });
  });
});

describe("corps JSON malformé des API protégées", () => {
  it.each([
    ["manage-financial-transaction", manageFinance, "school_admin"],
    ["manage-school", manageSchool, "super_admin"],
    ["provision-school-admin", provisionAdmin, "super_admin"],
  ])("%s répond 400 sans mutation", async (_name, handler, role) => {
    mocks.verifyIdToken.mockResolvedValueOnce({ uid: "e2e-user", role, schoolId: "school-a" });
    const res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer valid-token" }, body: "{" }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid-argument" });
  });

  it.each([
    ["manage-financial-transaction", manageFinance, "school_admin"],
    ["manage-school", manageSchool, "super_admin"],
    ["manage-teacher-availability-request", manageAvailability, "study_director"],
    ["manage-teacher-grading", manageGrading, "teacher"],
    ["provision-school-admin", provisionAdmin, "super_admin"],
  ])("%s traite le getter JSON invalide du runtime Vercel", async (_name, handler, role) => {
    mocks.verifyIdToken.mockResolvedValueOnce({ uid: "e2e-user", role, schoolId: "school-a" });
    const req = { method: "POST", headers: { authorization: "Bearer valid-token" } };
    Object.defineProperty(req, "body", { get() { throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 }); } });
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid-argument" });
  });

  it.each([
    ["manage-financial-transaction", manageFinance, "school_admin"],
    ["manage-school", manageSchool, "super_admin"],
    ["provision-school-account", provisionAccount, "school_admin"],
  ])("%s refuse le JSON null sans erreur serveur", async (_name, handler, role) => {
    mocks.verifyIdToken.mockResolvedValueOnce({ uid: "e2e-user", role, schoolId: "school-a" });
    const res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer valid-token" }, body: null }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid-argument" });
  });

  it("manage-coordination refuse le JSON null avant la vérification du jeton", async () => {
    const res = response();
    await manageCoordination({ method: "POST", headers: { authorization: "Bearer valid-token" }, body: null }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid-argument" });
  });

  it.each([
    ["send-parent-message", sendParentMessage, "parent"],
    ["send-school-message", sendSchoolMessage, "school_admin"],
  ])("%s refuse JSON null et le getter invalide sans 500", async (_name, handler, role) => {
    mocks.profileData = { role, schoolId: "school-a", parentId: "parent-a" };
    try {
      for (const body of [null, "{"]) {
        mocks.verifyIdToken.mockResolvedValueOnce({ uid: "e2e-user", role, schoolId: "school-a", parentId: "parent-a" });
        const res = response();
        await handler({ method: "POST", headers: { authorization: "Bearer valid-token" }, body }, res);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ error: "invalid-argument" });
      }
    } finally {
      mocks.profileData = {};
    }
  });
});
