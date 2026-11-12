import { afterEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "../types";

vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "fictional-test-token" }));
vi.mock("../config/apiUrl", () => ({ resolveApiUrl: (route: string) => route }));

import { FinancialRequestError, resolveHistoricalExpenseCurrencies } from "./financialTransactions";

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

  it("permet à l'interface de distinguer une erreur API d'une devise réellement non résolue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503,
      json: async () => ({ code: "unavailable" }) })));
    await expect(resolveHistoricalExpenseCurrencies([linkedExpense], true)).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true,
      json: async () => ({ resolvedCurrencies: {} }) })));
    expect((await resolveHistoricalExpenseCurrencies([linkedExpense], true))[0].currency).toBeUndefined();
  });

  it("conserve le statut HTTP 429 et le code serveur sans exposer la réponse brute", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429,
      json: async () => ({ code: "resource-exhausted", error: "_rateLimits/private" }) })));
    await expect(resolveHistoricalExpenseCurrencies([linkedExpense], true)).rejects.toMatchObject({
      name: "FinancialRequestError", status: 429, code: "resource-exhausted",
    });
    await expect(resolveHistoricalExpenseCurrencies([linkedExpense], true)).rejects.toBeInstanceOf(FinancialRequestError);
    await expect(resolveHistoricalExpenseCurrencies([linkedExpense], true)).rejects.not.toThrow("_rateLimits/private");
  });

  it("préserve aussi le statut 500 et le code interne pour le diagnostic", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500,
      json: async () => ({ code: "internal" }) })));
    await expect(resolveHistoricalExpenseCurrencies([linkedExpense], true)).rejects.toMatchObject({
      name: "FinancialRequestError", status: 500, code: "internal",
    });
  });
});
