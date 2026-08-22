import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceApiRateLimit: vi.fn(),
  auth: { verifyIdToken: vi.fn(async () => ({ uid: "coord-user", role: "coordination_admin", coordinationId: "coord-a" })) },
}));

vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: mocks.auth, db: {} }) }));
vi.mock("../../api/_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { FINANCE_CREATE: {}, FINANCE_MUTATE: {} }, enforceApiRateLimit: mocks.enforceApiRateLimit, sendRateLimitError: () => false }));

import handler from "../../api/manage-financial-transaction.js";

describe("endpoint financier appelé par Coordination", () => {
  it("répond permission-denied avant rate limit ou transaction", async () => {
    const response = { statusCode: 0, body: {} as Record<string, unknown>, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value) as Record<string, unknown>; } };
    await handler({ method: "POST", headers: { authorization: "Bearer staging-token" }, body: { action: "delete-payment", transactionId: "payment-a", reason: "test", clientRequestId: "request-a" } }, response);
    expect(response.statusCode).toBe(403);
    expect(response.body.code).toBe("permission-denied");
    expect(mocks.enforceApiRateLimit).not.toHaveBeenCalled();
  });
});
