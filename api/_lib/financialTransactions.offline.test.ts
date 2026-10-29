import { describe, expect, it } from "vitest";
import { executeFinancialOperation } from "./financialTransactions.js";

const caller = { uid: "cashier-e2e", role: "cashier", schoolId: "school-e2e" };
const body = { action: "create-payment", schoolYearId: "year-e2e", studentId: "student-e2e",
  feeTypeId: "fee-e2e", amount: 10, note: "Proposition hors connexion",
  expectedCurrency: "CDF", expectedFeeAmount: 50, clientRequestId: "offline-payment-e2e" };

function fixture(currency = "CDF", feeAmount = 50) {
  const records: Record<string, Record<string, unknown>> = {
    "schools/school-e2e": { status: "active", currency },
    "schoolYears/year-e2e": { schoolId: "school-e2e", status: "active", currency },
    "users/cashier-e2e": { role: "cashier", schoolId: "school-e2e", status: "active" },
    "students/student-e2e": { schoolId: "school-e2e", schoolYearId: "year-e2e", status: "ACTIVE" },
    "feeTypes/fee-e2e": { schoolId: "school-e2e", schoolYearId: "year-e2e", amount: feeAmount },
  };
  let writes = 0;
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: async (run: (transaction: { get: (ref: { path: string }) => Promise<unknown>; create: () => void }) => Promise<unknown>) => run({
      get: async (ref) => ({ exists: Boolean(records[ref.path]), data: () => records[ref.path] }),
      create: () => { writes += 1; },
    }),
  };
  return { db, writes: () => writes };
}

describe("paiement provisoire hors connexion", () => {
  it("refuse le paiement si le montant du frais a changé et n'écrit rien", async () => {
    const state = fixture("CDF", 60);
    await expect(executeFinancialOperation({ db: state.db, caller, body })).rejects.toMatchObject({ status: 409, code: "offline-conflict" });
    expect(state.writes()).toBe(0);
  });

  it("refuse le paiement si la devise a changé et n'écrit rien", async () => {
    const state = fixture("USD", 50);
    await expect(executeFinancialOperation({ db: state.db, caller, body })).rejects.toMatchObject({ status: 409, code: "offline-conflict" });
    expect(state.writes()).toBe(0);
  });
});
