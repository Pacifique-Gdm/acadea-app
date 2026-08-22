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
