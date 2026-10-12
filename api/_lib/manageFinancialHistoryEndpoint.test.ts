import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "coordination_admin", rateScope: "" }));
vi.mock("./firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: {}, db: {} }) }));
vi.mock("./activeUser.js", () => ({
  verifyActorIdToken: async () => ({ uid: "actor-a", role: state.role, ...(state.role === "cashier" ? { schoolId: "school-a" } : { coordinationId: "coord-a" }) }),
  requireActiveApiUser: async (_db: unknown, actor: unknown) => actor,
}));
vi.mock("./coordination.js", () => ({
  requireActiveCoordinationActor: async () => ({ uid: "actor-a", role: state.role, coordinationId: "coord-a" }),
}));
vi.mock("./personnelPayrollHistory.js", () => ({ listPersonnelPayrollHistory: async () => ({ payments: [] }) }));
vi.mock("./rateLimit.js", () => ({
  API_RATE_LIMITS: { FINANCE_MUTATE: { limit: 15, windowMs: 60_000 } },
  enforceApiRateLimit: async ({ schoolId }: { schoolId: string }) => {
    state.rateScope = schoolId;
    if (!schoolId) throw new Error("Configuration du rate limiter invalide.");
  },
  sendRateLimitError: () => false,
}));

import handler from "../manage-financial-transaction.js";

describe("API historique financier — portée du limiteur", () => {
  it.each([
    ["coordination_admin", "coord-a"],
    ["sub_coordination_admin", "coord-a"],
    ["cashier", "school-a"],
  ])("sert l'historique à %s avec une portée non vide", async (role, expectedScope) => {
    state.role = role;
    state.rateScope = "";
    const response = { statusCode: 0, body: "", setHeader: vi.fn(), end(value: string) { this.body = value; } };
    await handler({ method: "POST", headers: { authorization: "Bearer test-token" }, body: { action: "list-payroll-history" } }, response);
    expect(response.statusCode).toBe(200);
    expect(state.rateScope).toBe(expectedScope);
  });
});
