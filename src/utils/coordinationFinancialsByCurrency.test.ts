import { describe, expect, it } from "vitest";
import type { Expense, FeeType, Payment, School, Student } from "../types";
import { groupCoordinationFinancialsByCurrency } from "./coordinationFinancialsByCurrency";

const school = (id: string, currency?: "USD" | "CDF"): School => ({
  id,
  name: id,
  address: "",
  phone: "",
  email: "",
  currency,
  activeSchoolYearId: `year-${id}`,
  status: "active",
  subscriptionPlan: "Standard",
  subscriptionAmount: 0,
});
const student = (id: string, schoolId: string): Student => ({ id, schoolId, schoolYearId: `year-${schoolId}`, matricule: id, nom: id, postnom: "", prenom: "", sexe: "F", birthDate: "2015-01-01", address: "", phone: "", className: "2ème Primaire", status: "ACTIVE" });
const fee = (id: string, schoolId: string, amount: number): FeeType => ({ id, schoolId, schoolYearId: `year-${schoolId}`, name: "Minerval", amount });
const payment = (id: string, schoolId: string, studentId: string, feeTypeId: string, amount: number): Payment => ({ id, schoolId, schoolYearId: `year-${schoolId}`, studentId, feeTypeId, amount, paidAt: "2026-10-10", cashierName: "Caissier" });
const expense = (id: string, schoolId: string, amount: number): Expense => ({ id, schoolId, schoolYearId: `year-${schoolId}`, amount, category: "Bureau", description: "", spentAt: "2026-10-10", createdAt: "2026-10-10", cashierName: "Caissier" });

describe("agrégation financière canonique par devise", () => {
  it("conserve le comportement mono-devise USD, y compris le fallback historique explicite", () => {
    const groups = groupCoordinationFinancialsByCurrency({
      schools: [school("school-a")],
      students: [student("student-a", "school-a")],
      feeTypes: [fee("fee-a", "school-a", 100)],
      payments: [payment("payment-a", "school-a", "student-a", "fee-a", 60)],
      expenses: [expense("expense-a", "school-a", 10)],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ currency: "USD", expected: 100, paid: 60, expenses: 10, remaining: 40, recoveryRate: 60 });
  });

  it("conserve le comportement mono-devise CDF", () => {
    const groups = groupCoordinationFinancialsByCurrency({
      schools: [school("school-b", "CDF")],
      students: [student("student-b", "school-b")],
      feeTypes: [fee("fee-b", "school-b", 20000)],
      payments: [payment("payment-b", "school-b", "student-b", "fee-b", 5000)],
      expenses: [expense("expense-b", "school-b", 1000)],
    });
    expect(groups[0]).toMatchObject({ currency: "CDF", expected: 20000, paid: 5000, expenses: 1000, remaining: 15000, recoveryRate: 25 });
  });

  it("n'additionne jamais USD et CDF et sépare le même type de frais", () => {
    const groups = groupCoordinationFinancialsByCurrency({
      schools: [school("school-a", "USD"), school("school-b", "CDF")],
      students: [student("student-a", "school-a"), student("student-b", "school-b")],
      feeTypes: [fee("fee-a", "school-a", 100), fee("fee-b", "school-b", 20000)],
      payments: [payment("payment-a", "school-a", "student-a", "fee-a", 60), payment("payment-b", "school-b", "student-b", "fee-b", 5000)],
      expenses: [expense("expense-a", "school-a", 10), expense("expense-b", "school-b", 1000)],
    });
    expect(groups.map((group) => group.currency)).toEqual(["USD", "CDF"]);
    expect(groups[0].feeProgressRows).toEqual([{ name: "Minerval", expected: 100, paid: 60, remaining: 40, rate: 60 }]);
    expect(groups[1].feeProgressRows).toEqual([{ name: "Minerval", expected: 20000, paid: 5000, remaining: 15000, rate: 25 }]);
    expect(groups.some((group) => group.expected === 20100 || group.paid === 5060)).toBe(false);
  });

  it("agrège plusieurs écoles uniquement dans leur devise et respecte un sous-périmètre", () => {
    const allSchools = [school("school-a", "USD"), school("school-b", "USD"), school("school-c", "CDF")];
    const students = allSchools.map((item) => student(`student-${item.id}`, item.id));
    const feeTypes = allSchools.map((item, index) => fee(`fee-${item.id}`, item.id, [100, 200, 30000][index]));
    const payments = allSchools.map((item, index) => payment(`payment-${item.id}`, item.id, `student-${item.id}`, `fee-${item.id}`, [50, 100, 10000][index]));
    const all = groupCoordinationFinancialsByCurrency({ schools: allSchools, students, feeTypes, payments, expenses: [] });
    expect(all.find((group) => group.currency === "USD")).toMatchObject({ expected: 300, paid: 150, remaining: 150 });
    const delegated = groupCoordinationFinancialsByCurrency({ schools: [allSchools[2]], students, feeTypes, payments, expenses: [] });
    expect(delegated).toHaveLength(1);
    expect(delegated[0]).toMatchObject({ currency: "CDF", expected: 30000, paid: 10000, remaining: 20000 });
    expect(delegated[0].payments.map((item) => item.schoolId)).toEqual(["school-c"]);
  });
});
