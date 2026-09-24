import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn().mockRejectedValue(Object.assign(new Error("Invalid token"), { code: "auth/invalid-id-token" })),
}));

vi.mock("../api/_lib/firebaseAdmin.js", async (importOriginal) => ({
  ...await importOriginal(),
  initAdmin: () => ({ auth: { verifyIdToken: mocks.verifyIdToken }, db: {} }),
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
  it.each(endpoints)("%s répond 401 à un jeton invalide", async (_name, handler, method) => {
    const res = response();
    await handler({ method, headers: { authorization: "Bearer invalid-token" }, body: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("Invalid token");
  });
});
