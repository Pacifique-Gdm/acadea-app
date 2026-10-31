import { describe, expect, it } from "vitest";
import { buildDashboardFeeShares, buildDashboardFinancialAggregates } from "./dashboardStats";
import { buildStats, getStudentBalance } from "./stats";
import type { FeeType, Payment, Student } from "../types";

const pupil = (id: string, financialSupport?: Student["financialSupport"]): Student => ({
  id, schoolId: "school-a", schoolYearId: "year-a", matricule: id, nom: id,
  postnom: "", prenom: "", sexe: "F", birthDate: "2015-01-01", address: "",
  phone: "", className: "1ère Primaire", status: "ACTIVE", financialSupport,
});
const fees: FeeType[] = [
  { id: "minerval", schoolId: "school-a", schoolYearId: "year-a", name: "Minerval", amount: 300 },
  { id: "examen", schoolId: "school-a", schoolYearId: "year-a", name: "Examen", amount: 50 },
];
const paid = (id: string, studentId: string, feeTypeId: string, amount: number): Payment => ({
  id, schoolId: "school-a", schoolYearId: "year-a", studentId, feeTypeId,
  amount, currency: "USD", paidAt: "2026-10-10", cashierName: "Caissier",
});

describe("créances financières de tous les élèves", () => {
  it("inclut les élèves sans versement dans les cartes et chaque frais", () => {
    const students = Array.from({ length: 500 }, (_, index) => pupil(`pupil-${index}`));
    const payments = Array.from({ length: 200 }, (_, index) => paid(`payment-${index}`, `pupil-${index}`, "minerval", 300));
    const result = buildDashboardFinancialAggregates(students, [fees[0]], payments);
    expect(result.financialStats).toEqual({ official: 150000, reduction: 0, expected: 150000, paid: 60000, remaining: 90000 });
    expect(result.feeProgressRows).toEqual([{ name: "Minerval", official: 150000, reduction: 0, expected: 150000, paid: 60000, remaining: 90000, rate: 40 }]);
    expect(getStudentBalance("pupil-499", [fees[0]], payments, students)).toEqual({ expected: 300, paid: 0, remaining: 300 });
  });

  it("réduit uniquement le frais concerné et ne transforme pas l'exonération en recette", () => {
    const support = { decision: { id: "decision", schoolYearId: "year-a", thirdPartyName: "", lines: { minerval: { reductionMinor: 10000, commitmentMinor: 0 } } } };
    const students = [pupil("partiel", support), pupil("sans-paiement")];
    const payments = [paid("payment", "partiel", "minerval", 50)];
    const result = buildDashboardFinancialAggregates(students, fees, payments);
    expect(result.financialStats).toEqual({ official: 700, reduction: 100, expected: 600, paid: 50, remaining: 550 });
    expect(result.feeProgressRows).toEqual([
      { name: "Minerval", official: 600, reduction: 100, expected: 500, paid: 50, remaining: 450, rate: 10 },
      { name: "Examen", official: 100, reduction: 0, expected: 100, paid: 0, remaining: 100, rate: 0 },
    ]);
    expect(buildStats(students, [], fees, payments)).toMatchObject({ expected: 600, paid: 50, remaining: 550 });
  });
  it("garde visible un frais totalement exonéré sans division par zéro ni recette fictive", () => {
    const exempt = pupil("exempt", { full: { id: "full", schoolYearId: "year-a", thirdPartyName: "", lines: { minerval: { reductionMinor: 30000, commitmentMinor: 0 } } } });
    const result = buildDashboardFinancialAggregates([exempt], [fees[0]], []);
    expect(result.financialStats).toEqual({ official: 300, reduction: 300, expected: 0, paid: 0, remaining: 0 });
    expect(result.feeProgressRows).toEqual([{ name: "Minerval", official: 300, reduction: 300, expected: 0, paid: 0, remaining: 0, rate: 0 }]);
  });
});

describe("répartition financière du dashboard", () => {
  it("calcule les encaissements et les impayés sur le total attendu", () => {
    const shares = buildDashboardFeeShares([
      { name: "Minerval", expected: 500, paid: 300, remaining: 200, rate: 60 },
      { name: "Transport", expected: 200, paid: 100, remaining: 100, rate: 50 },
    ]);
    expect(shares).toEqual([
      { name: "Minerval", amount: 300, percentage: (300 / 700) * 100 },
      { name: "Transport", amount: 100, percentage: (100 / 700) * 100 },
      { name: "Impayés", amount: 300, percentage: (300 / 700) * 100, color: "#dc2626" },
    ]);
  });

  it("affiche uniquement les impayés en l'absence de paiement", () => {
    expect(buildDashboardFeeShares([{ name: "Minerval", expected: 500, paid: 0, remaining: 500, rate: 0 }])).toEqual([{ name: "Impayés", amount: 500, percentage: 100, color: "#dc2626" }]);
  });

  it("gère le total nul et plafonne un surpaiement sans montant négatif", () => {
    expect(buildDashboardFeeShares([{ name: "Minerval", expected: 0, paid: 100, remaining: 0, rate: 0 }])).toEqual([]);
    expect(buildDashboardFeeShares([{ name: "Minerval", expected: 100, paid: 150, remaining: 0, rate: 150 }])).toEqual([{ name: "Minerval", amount: 100, percentage: 100 }]);
  });
});
