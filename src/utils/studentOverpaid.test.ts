import { describe, expect, it } from "vitest";
import type { FeeType, Payment, Student } from "../types";
import { buildDashboardFinancialStats } from "./dashboardStats";
import { overpaidMoney } from "./money";
import { getStudentDetachedPaid, getStudentFeeSummaries, getStudentOverpaid } from "./studentFeeSummary";

// Lot D du caissier : le trop-perçu devient visible au lieu d'être caché par un solde bloqué à 0.
const student = { id: "eleve-a", schoolId: "ecole-a", schoolYearId: "annee-a", className: "2ème Primaire" } as Student;
const fees = [
  { id: "minerval-2p", schoolId: "ecole-a", schoolYearId: "annee-a", name: "Minerval", amount: 100, className: "2ème Primaire" },
  { id: "minerval-1p", schoolId: "ecole-a", schoolYearId: "annee-a", name: "Minerval", amount: 80, className: "1ère Primaire" },
] as FeeType[];
const pay = (feeTypeId: string, amount: number, extra: Partial<Payment> = {}) =>
  ({ id: `${feeTypeId}-${amount}`, schoolId: "ecole-a", schoolYearId: "annee-a", studentId: "eleve-a", feeTypeId, amount, paidAt: "2026-11-01", cashierName: "Caissier", ...extra }) as Payment;

describe("trop-perçu d'un élève", () => {
  it("overpaidMoney rend ce qui dépasse le montant dû, jamais un nombre négatif", () => {
    expect(overpaidMoney(100, 120.5)).toBe(20.5);
    expect(overpaidMoney(100, 60)).toBe(0);
  });

  it("donne le trop-perçu de chaque frais, sans rendre le reste négatif", () => {
    const [summary] = getStudentFeeSummaries(student, fees, [pay("minerval-2p", 130)]);
    expect(summary).toMatchObject({ expected: 100, paid: 130, remaining: 0, overpaid: 30 });
  });

  it("compte comme trop-perçu un paiement de l'année sur un frais qui ne concerne plus l'élève (ancienne classe)", () => {
    const payments = [pay("minerval-2p", 40), pay("minerval-1p", 60)];
    expect(getStudentDetachedPaid(student, fees, payments)).toBe(60);
    expect(getStudentOverpaid(student, fees, payments)).toBe(60);
    // Le reste dû sur la classe actuelle ne change pas.
    expect(getStudentFeeSummaries(student, fees, payments)[0].remaining).toBe(60);
  });

  it("ne compte ni un paiement d'une autre année, ni un paiement d'ancien élève, ni un frais inconnu", () => {
    const payments = [pay("minerval-1p", 10, { schoolYearId: "annee-b" }), pay("minerval-1p", 20, { formerStudent: true }), pay("frais-inconnu", 30)];
    expect(getStudentDetachedPaid(student, fees, payments)).toBe(0);
  });

  it("le tableau de bord additionne le trop-perçu élève par élève, sans changer l'encaissé ni le reste", () => {
    const other = { ...student, id: "eleve-b" } as Student;
    const payments = [pay("minerval-2p", 130), pay("minerval-2p", 50, { studentId: "eleve-b", id: "b" })];
    const stats = buildDashboardFinancialStats([student, other], fees, payments);
    expect(stats).toMatchObject({ expected: 200, paid: 180, remaining: 20, overpaid: 30 });
  });
});
