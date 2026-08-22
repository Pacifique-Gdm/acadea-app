import { describe, expect, it } from "vitest";
import { buildDashboardTransactionDayRows } from "./dashboardStats";
import { getTransactionPeriodDates } from "./dashboardDates";

describe("périodes partagées du Dashboard", () => {
  const now = new Date("2026-08-19T12:00:00");

  it("construit aujourd'hui, les cinq derniers jours et la semaine en cours", () => {
    expect(getTransactionPeriodDates("today", now)).toEqual(["2026-08-19"]);
    expect(getTransactionPeriodDates("last5", now)).toEqual(["2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"]);
    expect(getTransactionPeriodDates("week", now)).toEqual(["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"]);
  });

  it("agrège paiements et dépenses par jour et conserve l'état vide", () => {
    const rows = buildDashboardTransactionDayRows({
      dates: ["2026-08-18", "2026-08-19"],
      payments: [{ id: "payment-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", amount: 25, paidAt: "2026-08-19", cashierName: "A" }],
      expenses: [{ id: "expense-a", schoolId: "school-a", schoolYearId: "year-a", amount: 10, category: "Bureau", description: "", spentAt: "2026-08-19", createdAt: "2026-08-19", cashierName: "A" }],
      studentIds: new Set(["student-a"]),
      includeExpenses: true,
    });
    expect(rows[0]).toMatchObject({ date: "2026-08-18", payments: 0, expenses: 0 });
    expect(rows[1]).toMatchObject({ date: "2026-08-19", payments: 25, expenses: 10 });
  });
});
