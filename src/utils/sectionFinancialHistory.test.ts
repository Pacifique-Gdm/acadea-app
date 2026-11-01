import { describe, expect, it } from "vitest";
import type { CashInflow, Expense, Payment, Student } from "../types";
import { buildSectionFinancialHistoryItems } from "./sectionFinancialHistory";

describe("historique financier des administrateurs de section", () => {
  it("borne les paiements à l'élève visible et conserve les opérations générales globales", () => {
    const students = [{ id: "own", schoolId: "school-a", schoolYearId: "year-a", section: "Primaire", nom: "Élève autorisé" }] as Student[];
    const payment = { id: "p1", schoolId: "school-a", schoolYearId: "year-a", studentId: "own", amount: 10, currency: "USD", paidAt: "2026-11-01", cashierName: "Caissier" } as Payment;
    const expense = { id: "e1", schoolId: "school-a", schoolYearId: "year-a", amount: 20, currency: "CDF", category: "Fonctionnement", spentAt: "2026-11-01", cashierName: "Caissier" } as Expense;
    const inflow = { id: "i1", schoolId: "school-a", schoolYearId: "year-a", amount: 30, currency: "CDF", category: "Don", entryDate: "2026-11-01", cashierName: "Caissier" } as CashInflow;
    const items = buildSectionFinancialHistoryItems({ payments: [payment, { ...payment, id: "p2", studentId: "foreign" }], expenses: [expense], cashInflows: [inflow] }, students);
    expect(items.map((item) => item.id).sort()).toEqual(["expense-e1", "inflow-i1", "payment-p1"]);
    expect(items.find((item) => item.id === "expense-e1")?.title).toContain("établissement");
    expect(items.find((item) => item.id === "inflow-i1")?.title).toContain("établissement");
    expect(items.find((item) => item.id === "payment-p1")?.details).toContain("Élève autorisé");
  });
});
