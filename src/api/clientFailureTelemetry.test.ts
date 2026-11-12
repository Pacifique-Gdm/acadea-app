import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyIdToken: vi.fn(async () => ({ uid: "fixture-user" })), runTransaction: vi.fn() }));
vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: { verifyIdToken: mocks.verifyIdToken }, db: { runTransaction: mocks.runTransaction } }) }));

import handler from "../../api/manage-financial-transaction.js";
import { allowClientFailure, validateClientFailure } from "../../api/_lib/clientFailureTelemetry.js";

const event = {
  operation: "students.page", service: "firestore", code: "resource-exhausted", status: null,
  correlationId: "e8579ed1-3d15-4f6f-87eb-2ce54070c638", durationMs: 120, attempts: 1,
};
function response() {
  return { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
}

describe("endpoint de diagnostic P0", () => {
  it("refuse les champs personnels, les valeurs hors schéma et les méthodes non prévues", async () => {
    expect(validateClientFailure({ ...event, studentName: "secret" })).toBeNull();
    expect(validateClientFailure({ ...event, status: 200 })).toBeNull();
    expect(validateClientFailure({ ...event, code: "secret@example.invalid" })).toBeNull();
    expect(validateClientFailure({ ...event, service: "storage" })).toBeNull();
    const res = response();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it("n'accepte pas de diagnostic sans Firebase Auth", async () => {
    const res = response();
    await handler({ method: "POST", headers: {}, body: event }, res);
    expect(res.statusCode).toBe(401);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it("refuse les données étrangères au schéma sans écriture Firestore", async () => {
    const res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer fixture-token" },
      body: { action: "report-client-failure", event: { ...event, studentName: "secret" } } }, res);
    expect(res.statusCode).toBe(400);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it("refuse un jeton révoqué sans consigner le diagnostic", async () => {
    mocks.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer revoked-token" }, body: { action: "report-client-failure", event } }, res);
    expect(res.statusCode).toBe(401);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("consigne uniquement les métadonnées validées sans écriture Firestore", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer fixture-token" }, body: { action: "report-client-failure", event } }, res);
    expect(res.statusCode).toBe(204);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("fixture-token", true);
    expect(warn).toHaveBeenCalledWith("[Acadéa client-failure]", expect.objectContaining(event));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-token");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("fixture-user");
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("borne les diagnostics par utilisateur sans dépendre de Firestore", () => {
    const uid = `rate-test-${crypto.randomUUID()}`;
    const now = Date.now() + 120_000;
    expect(allowClientFailure(uid, now)).toBe(true);
    expect(allowClientFailure(uid, now)).toBe(true);
    expect(allowClientFailure(uid, now)).toBe(true);
    expect(allowClientFailure(uid, now)).toBe(false);
  });
});
