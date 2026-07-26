import { describe, expect, it } from "vitest";
import type { FeeType, Payment, Student } from "../types";
import { generateReceiptNumber } from "./finance";
import { getStudentFeeSummaries } from "./studentFeeSummary";

const student = {
  id: "student-a",
  schoolId: "school-a",
  schoolYearId: "year-a",
  className: "1ère Primaire",
} as Student;

describe("finance", () => {
  it("génère le prochain numéro de reçu pour l'année", () => {
    expect(generateReceiptNumber([{} as Payment, {} as Payment], "2026-2027")).toBe("REC-2026-0003");
  });

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
});
