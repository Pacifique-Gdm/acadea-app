import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>() }));
vi.mock("./firebaseAdmin.js", () => ({
  initAdmin: () => ({
    auth: {},
    db: {
      doc: (path: string) => ({ path, id: path.split("/").pop() }),
      runTransaction: async (callback: (transaction: { get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }> }) => Promise<unknown>) => callback({
        get: async (ref) => {
          const value = state.records.get(ref.path);
          return { exists: Boolean(value), data: () => value };
        },
      }),
    },
  }),
}));
vi.mock("./activeUser.js", () => ({
  verifyActorIdToken: async () => ({ uid: "cashier-a", role: "cashier", schoolId: "school-a" }),
  requireActiveApiUser: async () => undefined,
}));
vi.mock("./rateLimit.js", () => ({
  API_RATE_LIMITS: { FINANCE_CREATE: {}, FINANCE_MUTATE: {} },
  enforceApiRateLimit: async () => undefined,
  sendRateLimitError: () => false,
}));

import handler from "../manage-financial-transaction.js";

describe("API financière — bénéficiaire archivé", () => {
  beforeEach(() => {
    state.records.clear();
    state.records.set("schools/school-a", { status: "active", currency: "CDF" });
    state.records.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "CDF" });
    state.records.set("users/cashier-a", { role: "cashier", schoolId: "school-a", status: "active" });
    state.records.set("personnelProfiles/worker-a", { kind: "service", schoolId: "school-a", status: "inactive", active: false });
  });

  it.each(["advance", "bonus", "salary"])("renvoie 409 pour un appel direct %s", async (kind) => {
    const response = { statusCode: 0, body: "", setHeader: vi.fn(), end(value: string) { this.body = value; } };
    await handler({
      method: "POST", headers: { authorization: "Bearer test-token" },
      body: {
        action: "create-personnel-payment", schoolYearId: "year-a", beneficiaryId: "worker-a", kind,
        periodMonth: 9, periodYear: 2026, paidAt: "2026-10-09", amount: 100,
        clientRequestId: `direct-${kind}-archive-0001`,
      },
    }, response);
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ code: "failed-precondition" });
    expect([...state.records.keys()].filter((path) => path.startsWith("personnelPayments/") || path.startsWith("expenses/"))).toHaveLength(0);
  });
});
