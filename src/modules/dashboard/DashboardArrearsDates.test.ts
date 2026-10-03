import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import { CoordinationDashboard } from "../coordination/CoordinationDashboard";
import { formatCurrencyMoney } from "../../utils/currency";
import type { AppUser, Coordination, Payment, School, SchoolYear, Student } from "../../types";

const school: School = { id: "school", name: "École test", address: "", phone: "", email: "", currency: "USD", activeSchoolYearId: "year", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 };
const year: SchoolYear = { id: "year", schoolId: "school", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-01", status: "active" };
const student: Student = { id: "student", schoolId: "school", schoolYearId: "year", matricule: "E2E", nom: "Test", postnom: "", prenom: "Élève", sexe: "F", birthDate: "2015-01-01", address: "", phone: "", className: "2ème Primaire", parentId: "", status: "ACTIVE" };
const payments: Payment[] = [
  { id: "today", amount: 25, paidAt: "2026-10-03T23:59:59Z", currency: "USD" },
  { id: "yesterday", amount: 10, paidAt: "2026-10-02", currency: "USD" },
  { id: "cdf", amount: 1000, paidAt: "2026-10-03", currency: "CDF" },
].map((row) => ({ ...row, schoolId: "school", schoolYearId: "old-year", studentId: "old-student", feeTypeId: "old-fee", collectionSchoolYearId: "year", currentStudentId: "student", cashierName: "Test" } as Payment));
const model = { students: [student], payments, feeTypes: [], expenses: [], personnel: [], schoolYears: [year] };

describe("Dashboard — encaissements historiques à l'ouverture", () => {
  afterEach(() => vi.useRealTimers());
  it.each(["school_admin", "cashier", "coordination_admin", "sub_coordination_admin"] as const)("%s respecte aujourd'hui même avant le premier changement de date", (role) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00"));
    const html = renderToStaticMarkup(role.includes("coordination")
      ? createElement(CoordinationDashboard, { coordination: { id: "coord", name: "Coordination", status: "active", referenceSchoolYear: "2026-2027" } as Coordination, user: { id: "user", name: "Test", email: "test@example.test", role } as AppUser, schools: [school], selectedSchoolId: "", onSchoolChange: () => undefined, model, loading: false, loadError: "" })
      : createElement(Dashboard, { school, year, data: { ...model, parents: [], users: [] } }));
    const historicCard = html.slice(html.indexOf("Arriérés encaissés"));
    expect(historicCard).toContain(formatCurrencyMoney(25, "USD"));
    expect(historicCard).toContain(formatCurrencyMoney(1000, "CDF"));
    expect(historicCard).not.toContain(formatCurrencyMoney(35, "USD"));
  });
});
