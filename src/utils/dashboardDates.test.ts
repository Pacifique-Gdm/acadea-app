import { describe, expect, it } from "vitest";
import { buildDashboardTransactionDayRows } from "./dashboardStats";
import { getTransactionPeriodDates, isInDashboardDateRange } from "./dashboardDates";

describe("périodes partagées du Dashboard", () => {
  it.each([
    ["2026-10-02", true], ["2026-10-02T23:59:59.999Z", true],
    ["2026-10-02T00:00:00+01:00", true], ["2026-10-01T23:59:59Z", false],
    ["2026-10-03T00:00:00Z", false], ["", false],
  ])("filtre le jour d'encaissement enregistré %s, bornes inclusives sans décalage navigateur", (value, expected) => {
    expect(isInDashboardDateRange(value, "2026-10-02", "2026-10-02")).toBe(expected);
  });
  it("accepte les plages et bornes ouvertes sans regarder l'année d'origine de la dette", () => {
    expect(isInDashboardDateRange("2026-10-04T18:30:00Z", "2026-10-02", "2026-10-04")).toBe(true);
    expect(isInDashboardDateRange("2026-10-02", "", "2026-10-02")).toBe(true);
    expect(isInDashboardDateRange("2026-10-02", "2026-10-02", "")).toBe(true);
    expect(isInDashboardDateRange("2026-10-02", "2026-10-03", "2026-10-01")).toBe(false);
  });
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
