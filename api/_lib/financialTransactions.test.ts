import { afterEach, describe, expect, it, vi } from "vitest";
import { executeFinancialOperation } from "./financialTransactions.js";

afterEach(() => vi.unstubAllEnvs());

const db = { runTransaction: () => { throw new Error("La transaction ne doit jamais démarrer pour Coordination."); } };
const caller = { uid: "coord-user", role: "coordination_admin", coordinationId: "coord-a" };

describe("refus des mutations financières au rôle Coordination", () => {
  for (const action of ["create-payment", "create-expense", "update-payment", "update-expense", "delete-payment", "delete-expense"]) {
    it(`refuse ${action} avant toute transaction`, async () => {
      await expect(executeFinancialOperation({ db, caller, body: { action, clientRequestId: `${action}-request` } })).rejects.toMatchObject({ status: 403, code: "permission-denied" });
    });
  }
});

describe("protection de la dépense liée à la paie", () => {
  for (const action of ["update-expense", "delete-expense"]) {
    it(`refuse ${action} hors du ledger de paie`, async () => {
      const linkedDb = {
        doc: (path: string) => ({ path }),
        runTransaction: async (operation: (transaction: { get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> }> }) => Promise<unknown>) => operation({
          get: async (ref) => ref.path.startsWith("financialIdempotency/")
            ? { exists: false, data: () => ({}) }
            : { exists: true, data: () => ({ schoolId: "school-a", personnelPaymentId: "pay-a" }) },
        }),
      };
      await expect(executeFinancialOperation({ db: linkedDb, caller: { uid: "admin-a", role: "school_admin", schoolId: "school-a" }, body: { action, transactionId: "expense-a", reason: "Correction", clientRequestId: "payroll-protect-0001" } })).rejects.toMatchObject({ status: 409, code: "conflict" });
    });
  }
});

describe("dépenses ordinaires pendant le verrou de paie", () => {
  function expenseDb() {
    const values = new Map<string, Record<string, unknown>>([
      ["schools/school-a", { status: "active" }],
      ["schoolYears/year-a", { schoolId: "school-a", status: "active" }],
      ["users/admin-a", { role: "school_admin", schoolId: "school-a", status: "active" }],
      ["expenses/ordinary-a", { id: "ordinary-a", schoolId: "school-a", schoolYearId: "year-a", amount: 10, category: "Fournitures", description: "Papier" }],
      ["expenses/payroll-a", { id: "payroll-a", schoolId: "school-a", schoolYearId: "year-a", amount: 50, personnelPaymentId: "payment-a" }],
    ]);
    const snapshot = (path: string) => ({ exists: values.has(path), data: () => values.get(path) });
    const db = {
      doc: (path: string) => ({ path }),
      runTransaction: async (operation: (transaction: {
        get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
        set: (ref: { path: string }, value: Record<string, unknown>) => void;
        update: (ref: { path: string }, value: Record<string, unknown>) => void;
        delete: (ref: { path: string }) => void;
        create: (ref: { path: string }, value: Record<string, unknown>) => void;
      }) => Promise<unknown>) => {
        const writes: Array<() => void> = [];
        const result = await operation({
          get: async (ref) => snapshot(ref.path),
          set: (ref, value) => writes.push(() => values.set(ref.path, value)),
          update: (ref, value) => writes.push(() => values.set(ref.path, { ...values.get(ref.path), ...value })),
          delete: (ref) => writes.push(() => values.delete(ref.path)),
          create: (ref, value) => writes.push(() => values.set(ref.path, value)),
        });
        writes.forEach((write) => write());
        return result;
      },
    };
    return { db, values };
  }

  const admin = { uid: "admin-a", role: "school_admin", schoolId: "school-a" };
  for (const action of ["update-expense", "delete-expense"] as const) {
    it(`${action} reste permis pour une dépense ordinaire, pas pour une dépense liée`, async () => {
      vi.stubEnv("ACADEA_PAYROLL_WRITES_SUSPENDED", "true");
      const state = expenseDb();
      const body = { action, transactionId: "ordinary-a", reason: "Correction validée", clientRequestId: `ordinary-${action}-0001`,
        ...(action === "update-expense" ? { amount: 12, category: "Fournitures", description: "Nouveau papier" } : {}) };
      await expect(executeFinancialOperation({ db: state.db, caller: admin, body })).resolves.toMatchObject({ idempotent: false });
      expect(state.values.has("expenses/ordinary-a")).toBe(action === "update-expense");
      if (action === "update-expense") expect(state.values.get("expenses/ordinary-a")).toMatchObject({ amount: 12, description: "Nouveau papier" });
      expect([...state.values.keys()].filter((path) => path.startsWith("auditLogs/"))).toHaveLength(1);
      await expect(executeFinancialOperation({ db: state.db, caller: admin, body: {
        ...body, transactionId: "payroll-a", clientRequestId: `payroll-${action}-0001`,
      } })).rejects.toMatchObject({ status: 409, code: "conflict" });
      await expect(executeFinancialOperation({ db: state.db, caller: { ...admin, schoolId: "school-b" }, body: {
        ...body, transactionId: "payroll-a", clientRequestId: `foreign-${action}-0001`,
      } })).rejects.toMatchObject({ status: 403 });
      expect(state.values.get("expenses/payroll-a")).toMatchObject({ amount: 50, personnelPaymentId: "payment-a" });
    });
  }
});
