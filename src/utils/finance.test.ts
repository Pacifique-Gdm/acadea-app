import { describe, expect, it } from "vitest";
import type { FeeType, Payment, Student } from "../types";
import { getStudentFeeSummaries } from "./studentFeeSummary";

const student = {
  id: "student-a",
  schoolId: "school-a",
  schoolYearId: "year-a",
  className: "1ère Primaire",
} as Student;

describe("finance", () => {
  it("calcule payé et restant sans mélanger élèves ou frais", () => {
    const fees = [{ id: "fee-a", name: "Minerval", amount: 100, className: "1ère Primaire" }] as FeeType[];
    const payments = [
      { studentId: "student-a", feeTypeId: "fee-a", amount: 35 },
      { studentId: "student-b", feeTypeId: "fee-a", amount: 80 },
      { studentId: "student-a", feeTypeId: "fee-b", amount: 50 },
    ] as Payment[];

    expect(getStudentFeeSummaries(student, fees, payments)).toEqual([
      { feeTypeId: "fee-a", feeName: "Minerval", expected: 100, paid: 35, remaining: 65 },
    ]);
  });

  it("ne produit jamais un reste négatif en cas de surpaiement historique", () => {
    const fees = [{ id: "fee-a", name: "Minerval", amount: 100 }] as FeeType[];
    const payments = [{ studentId: "student-a", feeTypeId: "fee-a", amount: 120 }] as Payment[];
    expect(getStudentFeeSummaries(student, fees, payments)[0].remaining).toBe(0);
  });

  it("solde exactement plusieurs paiements décimaux et conserve une vraie dette de 0,01", () => {
    const fees = [{ id: "fee-a", name: "Minerval", amount: 150.75 }] as FeeType[];
    const payments = [100.5, 50.25].map((amount) => ({ studentId: "student-a", feeTypeId: "fee-a", amount })) as Payment[];
    expect(getStudentFeeSummaries(student, fees, payments)[0]).toMatchObject({ paid: 150.75, remaining: 0 });
    expect(getStudentFeeSummaries(student, [{ ...fees[0], amount: 100 }], [{ ...payments[0], amount: 99.99 }])[0].remaining).toBe(0.01);
  });
});
