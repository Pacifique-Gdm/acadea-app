import { afterEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "../types";

vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "fictional-test-token" }));
vi.mock("../config/apiUrl", () => ({ resolveApiUrl: (route: string) => route }));

import { resolveHistoricalExpenseCurrencies } from "./financialTransactions";

const linkedExpense = { id: "expense-a", schoolId: "school-a", schoolYearId: "year-a",
  amount: 25, personnelPaymentId: "payroll-a" } as Expense;

afterEach(() => vi.unstubAllGlobals());

describe("devises des dépenses historiques côté navigateur", () => {
  it("applique uniquement la devise prouvée par l'API au résultat en mémoire", async () => {
    const request = vi.fn(async (_url: string, options: { body: string }) => {
      expect(JSON.parse(options.body)).toEqual({ action: "list-resolved-expense-currencies", expenseIds: ["expense-a"] });
      return { ok: true, json: async () => ({ resolvedCurrencies: { "expense-a": "USD" } }) };
    });
    vi.stubGlobal("fetch", request);
    const result = await resolveHistoricalExpenseCurrencies([linkedExpense]);
    expect(result[0]).toMatchObject({ id: "expense-a", currency: "USD" });
    expect(linkedExpense.currency).toBeUndefined();
    expect(request).toHaveBeenCalledOnce();
  });

  it("reste bloqué si l'API refuse ou ne peut pas prouver le lien", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403,
      json: async () => ({ code: "permission-denied" }) })));
    expect((await resolveHistoricalExpenseCurrencies([linkedExpense]))[0].currency).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true,
      json: async () => ({ resolvedCurrencies: {} }) })));
    expect((await resolveHistoricalExpenseCurrencies([linkedExpense]))[0].currency).toBeUndefined();
  });
});
