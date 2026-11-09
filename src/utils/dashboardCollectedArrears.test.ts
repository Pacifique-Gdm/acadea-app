import { describe, expect, it } from "vitest";
import type { Payment } from "../types";
import { buildDashboardCollectedArrears } from "./dashboardCollectedArrears";

const payment = (id: string, overrides: Partial<Payment> = {}): Payment => ({
  id, schoolId: "school-a", schoolYearId: "old-year", studentId: "old-student",
  collectionSchoolYearId: "current-year", currentStudentId: "student-a",
  feeTypeId: "old-fee", amount: 10, currency: "USD", paidAt: "2026-10-03",
  createdAt: "2026-09-01", cashierName: "Fictif", ...overrides,
});
const payments = [
  payment("yesterday", { paidAt: "2026-10-02", amount: 10 }),
  payment("today", { paidAt: "2026-10-03T23:59:59Z", amount: 25 }),
  payment("cdf", { paidAt: "2026-10-03", amount: 1000, currency: "CDF" }),
  payment("other-school", { schoolId: "school-b", amount: 50000 }),
  payment("other-section", { currentStudentId: "student-hidden", amount: 40000 }),
  payment("current-fee", { schoolYearId: "current-year", amount: 90000 }),
  payment("not-collected-here", { collectionSchoolYearId: "other-year", amount: 80000 }),
  payment("old-date", { paidAt: "2025-10-03", createdAt: "2026-10-03", amount: 70000 }),
];

function collected(startDate: string, endDate: string, preferred: readonly ("USD" | "CDF")[] = ["USD"]) {
  return buildDashboardCollectedArrears(payments, {
    currentYearBySchoolId: new Map([["school-a", "current-year"]]),
    visibleStudentKeys: new Set(["school-a:student-a"]),
    startDate, endDate, applicableCurrencies: preferred,
  });
}

describe("arriérés encaissés — filtre et périmètre Dashboard", () => {
  it("filtre sur le jour d'encaissement, pas sur la création de la dette, et sépare les devises", () => {
    expect(collected("2026-10-03", "2026-10-03")).toEqual([
      { currency: "USD", amount: 25 }, { currency: "CDF", amount: 1000 },
    ]);
    expect(collected("2026-10-02", "2026-10-02")).toEqual([{ currency: "USD", amount: 10 }]);
    expect(collected("2026-10-02", "2026-10-03")).toEqual([
      { currency: "USD", amount: 35 }, { currency: "CDF", amount: 1000 },
    ]);
  });

  it("supprime tout l'indicateur pour une période sans encaissement, sans réutiliser l'ancien total", () => {
    expect(collected("2026-09-01", "2026-09-30", ["USD", "CDF"])).toEqual([]);
    expect(collected("2026-10-03", "2026-10-03", ["USD", "CDF"])).toEqual([
      { currency: "USD", amount: 25 }, { currency: "CDF", amount: 1000 },
    ]);
  });

  it("distingue l'existence d'un encaissement corrigé à zéro de l'absence d'opération", () => {
    expect(buildDashboardCollectedArrears([payment("corrected", { amount: 0 })], {
      currentYearBySchoolId: new Map([["school-a", "current-year"]]),
      visibleStudentKeys: new Set(["school-a:student-a"]),
      startDate: "2026-10-03", endDate: "2026-10-03", applicableCurrencies: ["USD"],
    })).toEqual([{ currency: "USD", amount: 0 }]);
  });

  it("exclut frais courants, autres écoles et sections, même avec des identifiants d'élève égaux", () => {
    const result = collected("2026-01-01", "2026-12-31");
    expect(result).toEqual([{ currency: "USD", amount: 35 }, { currency: "CDF", amount: 1000 }]);
  });

  it("prend le montant corrigé et les paiements partiels sans convertir USD et CDF", () => {
    const rows = [payment("partial-1", { amount: 4.25 }), payment("partial-2", { amount: 5.75 }),
      payment("corrected", { amount: 17, updatedAt: "2026-10-03" }), payment("cdf", { amount: 1500000, currency: "CDF" })];
    expect(buildDashboardCollectedArrears(rows, {
      currentYearBySchoolId: new Map([["school-a", "current-year"]]),
      visibleStudentKeys: new Set(["school-a:student-a"]),
      startDate: "2026-10-03", endDate: "2026-10-03", applicableCurrencies: ["USD", "CDF"],
    })).toEqual([{ currency: "USD", amount: 27 }, { currency: "CDF", amount: 1500000 }]);
  });
});
