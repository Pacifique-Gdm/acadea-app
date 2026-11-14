import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense, Payment, Student } from "../types";

const calls = vi.hoisted(() => ({ arrears: 0, currencies: 0 }));
vi.mock("../firebase", () => ({ auth: { currentUser: { uid: "user-a" } }, db: undefined }));
vi.mock("../services/clientFailureTelemetry", () => ({ reportClientFailure: vi.fn() }));
vi.mock("../services/financialTransactions", () => ({
  loadStudentArrearsBatch: vi.fn(async (_year: string, ids: string[]) => { calls.arrears += 1; return Object.fromEntries(ids.map((id) => [id, { USD: 2, CDF: 0 }])); }),
  resolveHistoricalExpenseCurrencies: vi.fn(async (rows: Expense[]) => { calls.currencies += 1; return rows.map((row) => ({ ...row, currency: "USD" })); }),
}));
vi.mock("../services/coordinationService", () => ({ loadCoordinationStudentArrearsBatch: vi.fn() }));

import { useDashboardArrears } from "./useDashboardArrears";
import { useExpenseCurrencyResolution } from "./useResolvedExpenseCurrencies";
import { clearDashboardArrearsCache, readCachedArrears, refreshStaleArrears } from "../services/dashboardArrearsCache";
import { clearExpenseCurrencyCache, resolvePendingExpenseCurrencies } from "../services/expenseCurrencyCache";

const students = Array.from({ length: 120 }, (_, index) => ({ id: `s${index}`, schoolId: "school-a", schoolYearId: "year-a", nom: "N", className: "1ère Primaire" })) as Student[];
const payments = [{ id: "p1", schoolId: "school-a", schoolYearId: "year-a", studentId: "s1", amount: 5 }] as Payment[];
const expenses = [{ id: "e1", schoolId: "school-a", schoolYearId: "year-a", amount: 10, category: "Salaire", description: "Paie", personnelPaymentId: "pay-1" }] as Expense[];

/** Reproduit l'écran : chaque retour sur le Dashboard recrée le composant et des tableaux neufs. */
function DashboardProbe({ list, ledger, spend }: { list: Student[]; ledger: Payment[]; spend: Expense[] }) {
  const arrears = useDashboardArrears(list, ledger);
  const currencies = useExpenseCurrencyResolution(spend);
  return createElement("output", null, `arriérés=${arrears.totals ? arrears.totals.USD : "chargement"};devises=${currencies.status}`);
}
const renderDashboard = () => renderToString(createElement(DashboardProbe, { list: students.map((row) => ({ ...row })), ledger: payments.map((row) => ({ ...row })), spend: expenses.map((row) => ({ ...row })) }));

describe("retour sur le tableau de bord", () => {
  beforeEach(() => { clearDashboardArrearsCache(); clearExpenseCurrencyCache(); calls.arrears = 0; calls.currencies = 0; });

  it("affiche immédiatement les derniers résultats vérifiés, sans appel serveur, quand rien n'a changé", async () => {
    expect(renderDashboard()).toContain("arriérés=chargement;devises=loading");
    // Première visite : le calcul effectué par l'écran (paquets de 50 → 3 appels, 1 vérification de devises).
    const first = readCachedArrears(students, payments, "user-a", false);
    await refreshStaleArrears(first.stale, first.prints, "user-a", false);
    await resolvePendingExpenseCurrencies(expenses, "user-a");
    expect(calls).toEqual({ arrears: 3, currencies: 1 });

    // Aller sur un autre onglet puis revenir : nouveau composant, tableaux recréés.
    expect(renderDashboard()).toContain("arriérés=240;devises=ready");
    expect(renderDashboard()).toContain("arriérés=240;devises=ready");
    expect(calls).toEqual({ arrears: 3, currencies: 1 });
  });

  it("n'affiche jamais l'ancien total quand un paiement a changé entre-temps", async () => {
    const first = readCachedArrears(students, payments, "user-a", false);
    await refreshStaleArrears(first.stale, first.prints, "user-a", false);
    const html = renderToString(createElement(DashboardProbe, { list: students, ledger: [...payments, { ...payments[0], id: "p2", studentId: "s7" }], spend: [] }));
    expect(html).toContain("arriérés=chargement");
  });
});
