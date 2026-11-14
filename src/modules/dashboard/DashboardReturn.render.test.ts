import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense, FeeType, Payment, School, SchoolYear, Student } from "../../types";

const counters = vi.hoisted(() => ({ aggregates: 0, classRows: 0, indexes: 0 }));
vi.mock("../../utils/dashboardStats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/dashboardStats")>();
  return { ...actual, buildDashboardFinancialAggregates: (...args: Parameters<typeof actual.buildDashboardFinancialAggregates>) => { counters.aggregates += 1; return actual.buildDashboardFinancialAggregates(...args); } };
});
vi.mock("../../utils/dashboardClassStats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/dashboardClassStats")>();
  return { ...actual, buildDashboardClassRows: (...args: Parameters<typeof actual.buildDashboardClassRows>) => { counters.classRows += 1; return actual.buildDashboardClassRows(...args); } };
});
vi.mock("../../utils/dataIndexes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/dataIndexes")>();
  return { ...actual, buildSchoolYearDataIndexes: (...args: Parameters<typeof actual.buildSchoolYearDataIndexes>) => { counters.indexes += 1; return actual.buildSchoolYearDataIndexes(...args); } };
});

import { Dashboard } from "./Dashboard";
import { clearPersistentMemo } from "../../hooks/usePersistentMemo";

const school: School = { id: "school", name: "École test", address: "", phone: "", email: "", currency: "USD", activeSchoolYearId: "year", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 };
const year: SchoolYear = { id: "year", schoolId: "school", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-01", status: "active" };
const students = [1, 2, 3].map((index) => ({ id: `s${index}`, schoolId: "school", schoolYearId: "year", matricule: `M${index}`, nom: "Nom", postnom: "", prenom: `P${index}`, sexe: index % 2 ? "F" : "M", birthDate: "2015-01-01", address: "", phone: "", className: "1ère Primaire", status: "ACTIVE" }) as Student);
const feeTypes = [{ id: "fee", schoolId: "school", schoolYearId: "year", name: "Minerval", amount: 100, className: "1ère Primaire" }] as FeeType[];
const payments = [{ id: "p1", schoolId: "school", schoolYearId: "year", studentId: "s1", feeTypeId: "fee", amount: 40, currency: "USD", paidAt: "2026-10-03T09:00:00Z", cashierName: "Caissier" }] as Payment[];
const expenses: Expense[] = [];
/** Même données : mêmes tableaux (comme le fournit App après le lot 6), nouvel objet `data`. */
const data = () => ({ students, feeTypes, payments, expenses, cashInflows: [], parents: [], users: [] });
const show = (override: Partial<ReturnType<typeof data>> = {}) => renderToStaticMarkup(createElement(Dashboard, { school, year, data: { ...data(), ...override } }));

describe("retour sur le Dashboard sans changement", () => {
  beforeEach(() => { clearPersistentMemo(); counters.aggregates = 0; counters.classRows = 0; counters.indexes = 0; vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00")); });
  afterEach(() => vi.useRealTimers());

  it("aller-retour : le tableau de bord réaffiche les mêmes résultats sans refaire ses calculs", () => {
    const first = show();
    const computed = { ...counters };
    expect(computed.aggregates).toBeGreaterThan(0);
    const back = show(); // l'onglet est quitté puis rouvert : nouveau composant, mêmes données
    expect(back).toBe(first);
    expect(counters).toEqual(computed);
  });

  it("recalcule dès qu'un paiement change (par exemple saisi par un autre utilisateur)", () => {
    show();
    const before = counters.aggregates;
    const html = show({ payments: [...payments, { ...payments[0], id: "p2", studentId: "s2", amount: 25 }] });
    expect(counters.aggregates).toBeGreaterThan(before);
    expect(html).not.toBe(show());
  });

  it("recalcule les dates du graphique après minuit", () => {
    const today = show();
    vi.setSystemTime(new Date("2026-10-04T08:00:00"));
    expect(show()).not.toBe(today);
  });
});
