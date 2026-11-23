import { describe, expect, it, vi } from "vitest";

/** Lot « 3 étapes » : le Super administrateur ne voit pas les données financières des écoles.
 * Toute demande de répartition venant de lui (justifications comprises) reçoit un refus clair 403,
 * et non plus une erreur interne 500 (essai staging du 23/11). */
const rateLimit = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: {}, db: { doc: (path: string) => ({ path }) }, get bucket() { throw new Error("aucun stockage"); } }) }));
vi.mock("./activeUser.js", () => ({
  verifyActorIdToken: async () => ({ uid: "platform-a", role: "super_admin" }),
  requireActiveApiUser: async (_db: unknown, caller: unknown) => caller,
}));
vi.mock("./rateLimit.js", () => ({
  API_RATE_LIMITS: { FINANCE_CREATE: {}, FINANCE_MUTATE: {} },
  enforceApiRateLimit: async ({ schoolId }: { schoolId: string }) => { rateLimit.calls += 1; if (!schoolId) throw new Error("Configuration du rate limiter invalide."); },
  sendRateLimitError: () => false,
}));

import handler from "../manage-financial-transaction.js";

describe("répartition : refus du Super administrateur", () => {
  it.each(["fee-allocation.get-justifications", "fee-allocation.get-workspace", "fee-allocation.get-activation"])("%s → 403", async (action) => {
    const response = { statusCode: 0, body: "", setHeader: vi.fn(), end(value: string) { this.body = value; } };
    await handler({ method: "POST", headers: { authorization: "Bearer test-token" }, body: { action, schoolId: "school-a" } }, response);
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({ code: "permission-denied" });
  });
});
