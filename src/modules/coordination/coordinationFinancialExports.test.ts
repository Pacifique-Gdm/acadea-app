import { describe, expect, it } from "vitest";
import type { Expense, Payment, Student } from "../../types";
import {
  selectCoordinationExpensesForStudentScope,
  selectCoordinationPaymentsForStudents,
} from "./coordinationFinancialExports";

const student = (id: string, schoolId: string): Student => ({
  id,
  schoolId,
  schoolYearId: `year-${schoolId}`,
  matricule: `M-${schoolId}-${id}`,
  nom: "Élève",
  postnom: "Test",
  prenom: id,
  sexe: "F",
  birthDate: "2012-01-01",
  address: "Adresse fictive",
  phone: "000000000",
  className: "1ère Primaire",
});

const payment = (id: string, schoolId: string, studentId: string): Payment => ({
  id,
  schoolId,
  schoolYearId: `year-${schoolId}`,
  studentId,
  feeTypeId: `fee-${schoolId}`,
  amount: 10,
  paidAt: "2026-08-01",
  cashierName: "Caissier E2E",
});

const expense = (id: string, schoolId: string): Expense => ({
  id,
  schoolId,
  schoolYearId: `year-${schoolId}`,
  amount: 5,
  category: "Fournitures",
  description: "Dépense fictive",
  spentAt: "2026-08-01",
  createdAt: "2026-08-01T10:00:00.000Z",
  cashierName: "Caissier E2E",
});

describe("exports financiers filtrés de la Coordination", () => {
  it("retient uniquement les paiements des élèves visibles avec isolation école + identifiant", () => {
    const visibleStudents = [student("same-id", "school-a")];
    const result = selectCoordinationPaymentsForStudents([
      payment("payment-a", "school-a", "same-id"),
      payment("payment-b", "school-b", "same-id"),
      payment("payment-c", "school-a", "other-id"),
    ], visibleStudents);
    expect(result.map((item) => item.id)).toEqual(["payment-a"]);
  });

  it("retient les dépenses des seules écoles représentées par la vue filtrée", () => {
    const visibleStudents = [student("student-a", "school-a"), student("student-c", "school-c")];
    const result = selectCoordinationExpensesForStudentScope([
      expense("expense-a", "school-a"),
      expense("expense-b", "school-b"),
      expense("expense-c", "school-c"),
    ], visibleStudents);
    expect(result.map((item) => item.id)).toEqual(["expense-a", "expense-c"]);
  });

  it("ne retourne aucune transaction lorsqu'aucun élève n'est visible", () => {
    expect(selectCoordinationPaymentsForStudents([payment("payment-a", "school-a", "student-a")], [])).toEqual([]);
    expect(selectCoordinationExpensesForStudentScope([expense("expense-a", "school-a")], [])).toEqual([]);
  });
});
