import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceApiRateLimit: vi.fn(),
  auth: { verifyIdToken: vi.fn(async (): Promise<Record<string, unknown>> => ({ uid: "coord-user", role: "coordination_admin", coordinationId: "coord-a" })) },
  db: { doc: vi.fn(() => ({ get: vi.fn(async () => ({ exists: true, data: () => ({ status: "inactive" }) })) })) },
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: mocks.auth, db: mocks.db }) }));
vi.mock("../../api/_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { FINANCE_CREATE: {}, FINANCE_MUTATE: {} }, enforceApiRateLimit: mocks.enforceApiRateLimit, sendRateLimitError: () => false }));

import handler from "../../api/manage-financial-transaction.js";

describe("endpoint financier appelé par Coordination", () => {
  it("refuse un profil financier inactif avant le limiteur", async () => {
    mocks.auth.verifyIdToken.mockResolvedValueOnce({ uid: "cashier-a", role: "cashier", schoolId: "school-a" });
    const response = { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value) as Record<string, unknown>; } };
    await handler({ method: "POST", headers: { authorization: "Bearer old-token" }, body: { action: "create-payment" } }, response);
    expect(response.statusCode).toBe(403);
    expect(mocks.db.doc).toHaveBeenCalledWith("users/cashier-a");
    expect(mocks.enforceApiRateLimit).not.toHaveBeenCalled();
  });

  it("répond 401 pour un jeton invalide avant toute lecture ou limitation", async () => {
    mocks.auth.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error("Invalid token"), { code: "auth/invalid-id-token" }));
    const response = { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value) as Record<string, unknown>; } };
    await handler({ method: "POST", headers: { authorization: "Bearer invalid" }, body: {} }, response);
    expect(response.statusCode).toBe(401);
    expect(response.body.code).toBe("unauthenticated");
    expect(mocks.enforceApiRateLimit).not.toHaveBeenCalled();
  });

  it("répond permission-denied avant rate limit ou transaction", async () => {
    const response = { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value) as Record<string, unknown>; } };
    await handler({ method: "POST", headers: { authorization: "Bearer staging-token" }, body: { action: "delete-payment", transactionId: "payment-a", reason: "test", clientRequestId: "request-a" } }, response);
    expect(response.statusCode).toBe(403);
    expect(response.body.code).toBe("permission-denied");
    expect(mocks.enforceApiRateLimit).not.toHaveBeenCalled();
  });
});
