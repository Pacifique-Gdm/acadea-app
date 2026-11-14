import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "../types";

vi.mock("./financialTransactions", () => ({ resolveHistoricalExpenseCurrencies: vi.fn(() => { throw new Error("appel réel interdit dans ce test"); }) }));

import { applyCachedExpenseCurrencies, clearExpenseCurrencyCache, pendingExpenseCurrencyIds, resolvePendingExpenseCurrencies, type ExpenseCurrencyRequest } from "./expenseCurrencyCache";

const expense = (id: string, overrides: Partial<Expense> = {}) => ({ id, schoolId: "school-a", schoolYearId: "year-a", amount: 10, category: "Salaire", description: "Paie", personnelPaymentId: `pay-${id}`, ...overrides }) as Expense;
const resolver = (currency: "USD" | "CDF" | null = "USD") => vi.fn<ExpenseCurrencyRequest>(async (rows) => rows.map((row) => (currency ? { ...row, currency } : row)));

describe("devises des anciennes dépenses de paie", () => {
  beforeEach(() => clearExpenseCurrencyCache());

  it("ne redemande rien quand la liste est recréée avec les mêmes dépenses (rafraîchissement d'écran)", async () => {
    const request = resolver();
    const snapshot = [expense("e1"), expense("e2"), expense("e3", { currency: "CDF" })];
    expect(pendingExpenseCurrencyIds(snapshot, "user-a")).toEqual(["e1", "e2"]);
    await resolvePendingExpenseCurrencies(snapshot, "user-a", request);
    expect(request).toHaveBeenCalledTimes(1);
    const recreated = snapshot.map((row) => ({ ...row }));
    expect(pendingExpenseCurrencyIds(recreated, "user-a")).toEqual([]);
    await resolvePendingExpenseCurrencies(recreated, "user-a", request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(applyCachedExpenseCurrencies(recreated, "user-a").map((row) => row.currency)).toEqual(["USD", "USD", "CDF"]);
  });

  it("ne demande que la nouvelle dépense", async () => {
    const request = resolver();
    await resolvePendingExpenseCurrencies([expense("e1")], "user-a", request);
    await resolvePendingExpenseCurrencies([expense("e1"), expense("e2")], "user-a", request);
    expect(request.mock.calls[1][0].map((row) => row.id)).toEqual(["e2"]);
  });

  it("mémorise une dépense non résolue sans lui inventer de devise", async () => {
    const request = resolver(null);
    await resolvePendingExpenseCurrencies([expense("e1")], "user-a", request);
    expect(pendingExpenseCurrencyIds([expense("e1")], "user-a")).toEqual([]);
    expect(applyCachedExpenseCurrencies([expense("e1")], "user-a")[0].currency).toBeUndefined();
  });

  it("redemande si la dépense pointe vers une autre pièce de paie, et isole les comptes", async () => {
    await resolvePendingExpenseCurrencies([expense("e1")], "user-a", resolver());
    expect(pendingExpenseCurrencyIds([expense("e1", { personnelPaymentId: "autre" })], "user-a")).toEqual(["e1"]);
    expect(pendingExpenseCurrencyIds([expense("e1")], "user-b")).toEqual(["e1"]);
  });

  it("n'enregistre rien quand le serveur échoue : la vérification sera relancée", async () => {
    const failing = vi.fn<ExpenseCurrencyRequest>(async () => { throw Object.assign(new Error("Trop de tentatives."), { status: 429 }); });
    await expect(resolvePendingExpenseCurrencies([expense("e1")], "user-a", failing)).rejects.toThrow();
    expect(pendingExpenseCurrencyIds([expense("e1")], "user-a")).toEqual(["e1"]);
  });
});
