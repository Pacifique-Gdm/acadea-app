import { describe, expect, it } from "vitest";
import type { AppUser, Expense, FeeType, Payment, School, SchoolYear, Student } from "../types";
import { buildCoordinationDashboardStats } from "./coordinationDashboardStats";

const schools: School[] = [
  { id: "school-a", name: "École A", address: "", phone: "", email: "", currency: "USD", activeSchoolYearId: "year-a", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 },
  { id: "school-b", name: "École B", address: "", phone: "", email: "", currency: "CDF", activeSchoolYearId: "year-b", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 },
  { id: "school-outside", name: "Hors périmètre", address: "", phone: "", email: "", currency: "USD", activeSchoolYearId: "year-outside", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 },
];
const schoolYears: SchoolYear[] = [
  { id: "year-a", schoolId: "school-a", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-01", status: "active" },
  { id: "year-b", schoolId: "school-b", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-01", status: "active" },
  { id: "year-outside", schoolId: "school-outside", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-01", status: "active" },
  { id: "year-old", schoolId: "school-a", name: "2025-2026", startsAt: "2025-09-01", endsAt: "2026-07-01", status: "archived" },
];
const student = (id: string, schoolId: string, schoolYearId: string, sexe: "M" | "F", parentId: string): Student => ({ id, schoolId, schoolYearId, matricule: id, nom: id, postnom: "", prenom: "", sexe, birthDate: "2015-01-01", address: "", phone: "", className: "2ème Primaire", parentId, status: "ACTIVE" });
const students: Student[] = [
  student("student-a", "school-a", "year-a", "F", "parent-shared"),
  student("student-b", "school-b", "year-b", "M", "parent-shared"),
  student("student-outside", "school-outside", "year-outside", "M", "parent-outside"),
  student("student-old", "school-a", "year-old", "M", "parent-old"),
];
const feeTypes: FeeType[] = [
  { id: "fee-a", schoolId: "school-a", schoolYearId: "year-a", name: "Minerval", amount: 100 },
  { id: "fee-b", schoolId: "school-b", schoolYearId: "year-b", name: "Minerval", amount: 20000 },
  { id: "fee-outside", schoolId: "school-outside", schoolYearId: "year-outside", name: "Minerval", amount: 999 },
];
const payment = (id: string, schoolId: string, schoolYearId: string, studentId: string, feeTypeId: string, amount: number): Payment => ({ id, schoolId, schoolYearId, studentId, feeTypeId, amount, paidAt: "2026-10-10", cashierName: "Caissier" });
const payments: Payment[] = [payment("payment-a", "school-a", "year-a", "student-a", "fee-a", 50), payment("payment-b", "school-b", "year-b", "student-b", "fee-b", 5000), payment("payment-outside", "school-outside", "year-outside", "student-outside", "fee-outside", 999)];
const expenses: Expense[] = [
  { id: "expense-a", schoolId: "school-a", schoolYearId: "year-a", amount: 10, category: "Bureau", description: "", spentAt: "2026-10-10", createdAt: "2026-10-10", cashierName: "A" },
  { id: "expense-b", schoolId: "school-b", schoolYearId: "year-b", amount: 1000, category: "Bureau", description: "", spentAt: "2026-10-10", createdAt: "2026-10-10", cashierName: "B" },
];
const personnel: AppUser[] = [
  { id: "admin-a", name: "Admin A", email: "a@test", role: "school_admin", schoolId: "school-a" },
  { id: "cashier-a", name: "Caissier A", email: "c@test", role: "cashier", schoolId: "school-a" },
  { id: "discipline-b", name: "Discipline B", email: "d@test", role: "discipline_director", schoolId: "school-b" },
  { id: "admin-outside", name: "Admin hors scope", email: "o@test", role: "school_admin", schoolId: "school-outside" },
];
const model = { students, feeTypes, payments, expenses, personnel, schoolYears };

describe("agrégations du Dashboard Coordination", () => {
  it("agrège toutes les écoles autorisées sans fusionner classes ni parents homonymes entre écoles", () => {
    const result = buildCoordinationDashboardStats(schools.slice(0, 2), model, { referenceSchoolYear: "2026-2027" });
    expect(result.totalStudents).toBe(2);
    expect(result.totalClasses).toBe(2);
    expect(result.totalParents).toBe(2);
    expect(result.classRows.map((row) => `${row.schoolName}:${row.className}`)).toEqual(["École A:2ème Primaire", "École B:2ème Primaire"]);
    expect(result.totalGirls).toBe(1);
    expect(result.totalBoys).toBe(1);
    expect(result.administrators).toBe(1);
    expect(result.cashiers).toBe(1);
    expect(result.disciplineDirectors).toBe(1);
  });

  it("limite une école et le périmètre Sous-coordinateur sans lire l'école extérieure", () => {
    const result = buildCoordinationDashboardStats([schools[1]], model, { referenceSchoolYear: "2026-2027" });
    expect(result.totalStudents).toBe(1);
    expect(result.classRows).toHaveLength(1);
    expect(result.classRows[0].schoolId).toBe("school-b");
    expect(result.administrators).toBe(0);
    expect(result.disciplineDirectors).toBe(1);
    expect(result.payments.map((row) => row.id)).toEqual(["payment-b"]);
  });

  it("sépare strictement USD et CDF et réutilise attendu, encaissé, reste, dépenses et recouvrement", () => {
    const result = buildCoordinationDashboardStats(schools.slice(0, 2), model, { referenceSchoolYear: "2026-2027" });
    expect(result.financialGroups).toHaveLength(2);
    expect(result.financialGroups[0]).toMatchObject({ currency: "USD", expected: 100, paid: 50, expenses: 10, remaining: 50, recoveryRate: 50 });
    expect(result.financialGroups[1]).toMatchObject({ currency: "CDF", expected: 20000, paid: 5000, expenses: 1000, remaining: 15000, recoveryRate: 25 });
    expect(result.financialGroups[0].feeShares).toEqual([{ name: "Minerval", amount: 50, percentage: 50 }, { name: "Impayés", amount: 50, percentage: 50, color: "#dc2626" }]);
  });

  it("exclut les années archivées et les écoles non alignées au lieu de mélanger les années", () => {
    const nonAlignedYears = schoolYears.map((year) => year.id === "year-b" ? { ...year, name: "2027-2028" } : year);
    const result = buildCoordinationDashboardStats(schools.slice(0, 2), { ...model, schoolYears: nonAlignedYears }, { referenceSchoolYear: "2026-2027" });
    expect(result.alignedSchoolIds).toEqual(["school-a"]);
    expect(result.excludedSchoolIds).toEqual(["school-b"]);
    expect(result.students.map((row) => row.id)).toEqual(["student-a"]);
    expect(result.students.some((row) => row.id === "student-old")).toBe(false);
  });

  it("applique section et dates sans modifier les données sources", () => {
    const result = buildCoordinationDashboardStats(schools.slice(0, 2), model, { referenceSchoolYear: "2026-2027", section: "Primaire", dateFilterActive: true, startDate: "2026-10-11", endDate: "2026-10-12" });
    expect(result.totalStudents).toBe(2);
    expect(result.payments).toEqual([]);
    expect(result.expenses).toEqual([]);
    expect(model.payments).toHaveLength(3);
  });
});
