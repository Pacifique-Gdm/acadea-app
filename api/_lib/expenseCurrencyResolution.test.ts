import { describe, expect, it } from "vitest";
import { listResolvedExpenseCurrencies } from "./expenseCurrencyResolution.js";

function fakeDb(documents: Record<string, Record<string, unknown>>) {
  const snapshot = (path: string) => ({ id: path.split("/").at(-1), exists: !!documents[path],
    data: () => documents[path] });
  return {
    doc: (path: string) => ({ path, get: async () => snapshot(path) }),
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
    collection: (name: string) => ({ where: (field: string, _operator: string, value: string) => ({
      get: async () => ({ docs: Object.entries(documents).filter(([path, data]) => path.startsWith(`${name}/`)
        && data[field] === value).map(([path, data]) => ({ id: path.split("/").at(-1), data: () => data })) }),
    }) }),
  } as never;
}

const payroll = { schoolId: "school-a", schoolYearId: "year-a", expenseId: "expense-a",
  currency: "USD", netPaid: 25 };
const expense = { schoolId: "school-a", schoolYearId: "year-a", amount: 25,
  personnelPaymentId: "payroll-a" };
const actor = { uid: "admin-a", role: "school_admin", schoolId: "school-a" };

describe("linked historical expense currency", () => {
  it("returns only the currency proved by a reciprocal payroll link", async () => {
    const db = fakeDb({ "expenses/expense-a": expense, "personnelPayments/payroll-a": payroll });
    await expect(listResolvedExpenseCurrencies({ db, caller: actor, body: { expenseIds: ["expense-a"] } }))
      .resolves.toEqual({ resolvedCurrencies: { "expense-a": "USD" } });
  });

  it("keeps an expense unresolved when the link or amount is inconsistent", async () => {
    const db = fakeDb({ "expenses/expense-a": expense,
      "personnelPayments/payroll-a": { ...payroll, netPaid: 26 } });
    await expect(listResolvedExpenseCurrencies({ db, caller: actor, body: { expenseIds: ["expense-a"] } }))
      .resolves.toEqual({ resolvedCurrencies: {} });
  });

  it("rejects another school and roles without financial access", async () => {
    const db = fakeDb({ "expenses/expense-a": expense, "personnelPayments/payroll-a": payroll });
    await expect(listResolvedExpenseCurrencies({ db, caller: { ...actor, schoolId: "school-b" }, body: { expenseIds: ["expense-a"] } }))
      .rejects.toMatchObject({ status: 403 });
    await expect(listResolvedExpenseCurrencies({ db, caller: { ...actor, role: "secretary" }, body: { expenseIds: ["expense-a"] } }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("limits Coordination to its currently assigned schools", async () => {
    const db = fakeDb({ "expenses/expense-a": expense, "personnelPayments/payroll-a": payroll,
      "coordinationSchools/link-a": { coordinationId: "coordination-a", schoolId: "school-a", active: true } });
    const coordinator = { uid: "coord-a", role: "coordination_admin", coordinationId: "coordination-a" };
    await expect(listResolvedExpenseCurrencies({ db, caller: coordinator, body: { expenseIds: ["expense-a"] } }))
      .resolves.toEqual({ resolvedCurrencies: { "expense-a": "USD" } });
    await expect(listResolvedExpenseCurrencies({ db, caller: { ...coordinator, coordinationId: "coordination-b" }, body: { expenseIds: ["expense-a"] } }))
      .rejects.toMatchObject({ status: 403 });
  });
});
