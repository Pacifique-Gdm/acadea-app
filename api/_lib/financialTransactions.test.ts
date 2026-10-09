import { describe, expect, it } from "vitest";
import { executeFinancialOperation } from "./financialTransactions.js";

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
