import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Expense, Payment } from "../types";
import { reconcileFinancialSnapshot } from "./useRealtimeFinancialTransactions";

describe("transactions financières temps réel", () => {
  it("écoute paiements et dépenses avec le même périmètre école/année", () => {
    const source = readFileSync(new URL("./useRealtimeFinancialTransactions.ts", import.meta.url), "utf8");
    expect(source).toContain('annualQuery("payments")');
    expect(source).toContain('annualQuery("expenses")');
    expect(source).toContain('where("schoolId", "==", schoolId)');
    expect(source).toContain('where("schoolYearId", "==", schoolYearId)');
    expect(source).toContain("unsubscribePayments()");
    expect(source).toContain("unsubscribeExpenses()");
  });

  it("conserve le paiement serveur au premier snapshot sans duplication", () => {
    const payment: Payment = {
      id: "pay-server",
      schoolId: "school-a",
      schoolYearId: "year-a",
      studentId: "student-a",
      feeTypeId: "fee-a",
      amount: 25,
      paidAt: "2026-08-07",
      createdAt: "2026-08-07T12:00:00.000Z",
      cashierName: "Caissier",
      provenance: "financial-api",
    };
    const firstSnapshot = reconcileFinancialSnapshot<Payment>([], [payment], { schoolId: "school-a", schoolYearId: "year-a" });
    const repeatedSnapshot = reconcileFinancialSnapshot(firstSnapshot, [payment, payment], { schoolId: "school-a", schoolYearId: "year-a" });
    expect(firstSnapshot).toEqual([payment]);
    expect(repeatedSnapshot).toEqual([payment]);
  });

  it("conserve la dépense serveur au premier snapshot et isole l'école et l'année", () => {
    const expense: Expense = {
      id: "expense-server",
      schoolId: "school-a",
      schoolYearId: "year-a",
      amount: 50,
      category: "Transport",
      description: "Déplacement",
      spentAt: "2026-08-07",
      createdAt: "2026-08-07T12:00:00.000Z",
      cashierName: "Caissier",
      provenance: "financial-api",
    };
    const otherSchool = { ...expense, id: "expense-other-school", schoolId: "school-b" };
    const otherYear = { ...expense, id: "expense-other-year", schoolYearId: "year-b" };
    const result = reconcileFinancialSnapshot([otherSchool, otherYear], [expense], { schoolId: "school-a", schoolYearId: "year-a" });
    expect(result).toEqual([otherSchool, otherYear, expense]);
  });
});
