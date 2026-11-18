import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../firebase", () => ({ auth: { currentUser: { uid: "user-a" } }, db: undefined }));
vi.mock("../../services/clientFailureTelemetry", () => ({ reportClientFailure: vi.fn() }));

import { Dashboard } from "./Dashboard";
import { collectedArrearsBandHeight } from "../../utils/collectedArrearsBand";
import { CoordinationDashboard } from "../coordination/CoordinationDashboard";
import { DashboardArrearsValue } from "../../components/financial/DashboardArrearsValue";
import { clearExpenseCurrencyCache, pendingExpenseCurrencyIds, resolvePendingExpenseCurrencies, type ExpenseCurrencyRequest } from "../../services/expenseCurrencyCache";
import type { AppUser, Coordination, Expense, FeeType, Payment, School, SchoolYear, Student } from "../../types";

const school: School = { id: "school", name: "École test", address: "", phone: "", email: "", currency: "USD", activeSchoolYearId: "year", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 };
const year: SchoolYear = { id: "year", schoolId: "school", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-01", status: "active" };
const student: Student = { id: "student", schoolId: "school", schoolYearId: "year", matricule: "E1", nom: "Test", postnom: "", prenom: "Élève", sexe: "F", birthDate: "2015-01-01", address: "", phone: "", className: "2ème Primaire", parentId: "", status: "ACTIVE" };
const fee: FeeType = { id: "fee", schoolId: "school", schoolYearId: "year", name: "Minerval", amount: 100 };
const payment = { id: "p1", schoolId: "school", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 40, paidAt: "2026-10-01", currency: "USD", cashierName: "Caisse" } as Payment;
// Ancienne dépense de paie sans devise : sa devise doit être vérifiée par le serveur.
const payrollExpense = { id: "e1", schoolId: "school", schoolYearId: "year", amount: 15, category: "Salaire", description: "Paie", spentAt: "2026-10-01", personnelPaymentId: "pay-1", cashierName: "Caisse" } as Expense;
const data = (expenses: Expense[]) => ({ students: [student], parents: [], users: [], feeTypes: [fee], payments: [payment], expenses });
const renderAdmin = (expenses: Expense[], extra: { refreshing?: boolean } = {}) => renderToStaticMarkup(createElement(Dashboard, { school, year, data: data(expenses), ...extra }));
const usd: ExpenseCurrencyRequest = async (rows) => rows.map((row) => ({ ...row, currency: "USD" }));

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, String(value)); },
    removeItem: (key: string) => { items.delete(key); },
    clear: () => items.clear(),
  } as Storage;
}

/** Vérification terminée : plus aucun squelette, sauf celui de la carte « Arriérés »
 * (son calcul serveur n'est pas lancé dans ces tests). */
function expectOnlyArrearsSkeleton(html: string) {
  expect(html).not.toContain("financial-kpi-skeleton");
  expect(html).not.toContain("block-skeleton");
  expect(html.split('data-testid="value-skeleton"').length - 1).toBe(1);
}

describe("Dashboards — vérifications discrètes, sans bandeau temporaire", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00")); clearExpenseCurrencyCache(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearExpenseCurrencyCache(); });

  it("admin/caissier : pendant la vérification des devises, aucun message, des squelettes gardent la place", () => {
    const html = renderAdmin([payrollExpense]);
    expect(html).not.toContain("Vérification des devises historiques en cours");
    expect(html).not.toContain("Non calculable");
    expect(html).not.toContain("Devise historique inconnue");
    expect(html).toContain('data-testid="financial-kpi-skeleton"');
    expect(html).toContain('data-testid="value-skeleton"');
  });

  it("admin/caissier : une fois la vérification faite, les chiffres sont exactement ceux d'une dépense déjà en USD", async () => {
    await resolvePendingExpenseCurrencies([payrollExpense], "user-a", usd);
    const verified = renderAdmin([payrollExpense]);
    const reference = renderAdmin([{ ...payrollExpense, currency: "USD" }]);
    expect(verified).toBe(reference);
    expectOnlyArrearsSkeleton(verified);
    expect(verified).toContain("KPI financier");
  });

  it("admin/caissier : un vrai problème de devise reste signalé", async () => {
    await resolvePendingExpenseCurrencies([payrollExpense], "user-a", async (rows) => rows);
    const html = renderAdmin([payrollExpense]);
    expect(html).toContain("Synthèse financière et PDF indisponibles");
    expect(html).toContain("Non calculable");
    expectOnlyArrearsSkeleton(html);
  });

  it("admin/caissier : l'actualisation des arriérés encaissés ne montre plus de message", () => {
    const formerPayment = { ...payment, id: "old", schoolYearId: "old-year", studentId: "old-student", currentStudentId: "student", collectionSchoolYearId: "year", paidAt: "2026-10-03" } as Payment;
    const html = renderToStaticMarkup(createElement(Dashboard, { school, year, refreshing: true, data: { ...data([]), payments: [payment, formerPayment] } }));
    expect(html).not.toContain("Actualisation des arriérés encaissés");
    expect(html).toContain(`height:${collectedArrearsBandHeight(1)}px`);
  });

  it("carte Arriérés : squelette au lieu de « Chargement des arriérés… »", () => {
    const html = renderToStaticMarkup(createElement(DashboardArrearsValue, { currency: "USD" }));
    expect(html).not.toContain("Chargement");
    expect(html).toContain('data-testid="value-skeleton"');
    expect(renderToStaticMarkup(createElement(DashboardArrearsValue, { error: "Réseau indisponible" }))).toContain("Arriérés indisponibles");
  });

  it("coordination : premier chargement sans message, cartes en squelette ; données prêtes affichées normalement", async () => {
    const coordination = { id: "coord", name: "Coordination", status: "active", referenceSchoolYear: "2026-2027" } as Coordination;
    const user = { id: "user", name: "Test", email: "test@example.test", role: "coordination_admin" } as AppUser;
    const model = { students: [student], payments: [payment], feeTypes: [fee], expenses: [payrollExpense], personnel: [], schoolYears: [year] };
    const render = (loading: boolean) => renderToStaticMarkup(createElement(CoordinationDashboard, { coordination, user, schools: [school], selectedSchoolId: "", onSchoolChange: () => undefined, model, loading, loadError: "" }));
    const pending = render(true);
    expect(pending).not.toContain("Chargement du Dashboard");
    expect(pending).not.toContain("Vérification des devises historiques");
    expect(pending).not.toContain("Indéterminé");
    expect(pending).toContain('data-testid="financial-kpi-skeleton"');
    await resolvePendingExpenseCurrencies([payrollExpense], "user-a", usd);
    const ready = render(false);
    expectOnlyArrearsSkeleton(ready);
    expect(ready).toContain("KPI financier");
    expect(ready).toContain("40,00");
  });

  it("la devise retrouvée est gardée dans le navigateur : pas de nouvelle vérification à la prochaine ouverture", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const request = vi.fn(usd);
    await resolvePendingExpenseCurrencies([payrollExpense], "user-a", request);
    clearExpenseCurrencyCache(false); // nouvelle ouverture : la mémoire de l'onglet est vide
    expect(pendingExpenseCurrencyIds([payrollExpense], "user-a")).toEqual([]);
    expect(renderAdmin([payrollExpense])).toBe(renderAdmin([{ ...payrollExpense, currency: "USD" }]));
    // Autre compte, ou dépense liée à une autre pièce de paie : nouvelle vérification.
    expect(pendingExpenseCurrencyIds([payrollExpense], "user-b")).toEqual(["e1"]);
    expect(pendingExpenseCurrencyIds([{ ...payrollExpense, personnelPaymentId: "pay-2" }], "user-a")).toEqual(["e1"]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("cas 1 : une correction de devise faite côté serveur est revue (modification de la dépense, ou après 24 h)", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const request = vi.fn(usd);
    await resolvePendingExpenseCurrencies([payrollExpense], "user-a", request);
    clearExpenseCurrencyCache(false);
    // Dépense modifiée côté serveur (date de modification changée) : nouvelle vérification.
    expect(pendingExpenseCurrencyIds([{ ...payrollExpense, updatedAt: "2026-10-03T10:00:00Z" }], "user-a")).toEqual(["e1"]);
    // Rien de modifié, moins de 24 h : la mémoire sert.
    vi.setSystemTime(new Date("2026-10-04T11:59:00"));
    expect(pendingExpenseCurrencyIds([payrollExpense], "user-a")).toEqual([]);
    // Après 24 h, même sans aucune modification : nouvelle vérification, dans l'onglet comme à la prochaine ouverture.
    vi.setSystemTime(new Date("2026-10-04T12:00:01"));
    expect(pendingExpenseCurrencyIds([payrollExpense], "user-a")).toEqual(["e1"]);
    clearExpenseCurrencyCache(false);
    expect(pendingExpenseCurrencyIds([payrollExpense], "user-a")).toEqual(["e1"]);
    // Le serveur répond maintenant CDF : c'est la nouvelle devise qui est affichée.
    await resolvePendingExpenseCurrencies([payrollExpense], "user-a", async (rows) => rows.map((row) => ({ ...row, currency: "CDF" })));
    expect(renderAdmin([payrollExpense])).toBe(renderAdmin([{ ...payrollExpense, currency: "CDF" }]));
  });

  it("cas 2 : aucun chiffre lié à une devise non vérifiée n'est affiché, seulement des squelettes", () => {
    const today = { ...payrollExpense, spentAt: "2026-10-03" };
    for (const html of [
      renderAdmin([today]),
      renderToStaticMarkup(createElement(CoordinationDashboard, {
        coordination: { id: "coord", name: "Coordination", status: "active", referenceSchoolYear: "2026-2027" } as Coordination,
        user: { id: "user", name: "Test", email: "test@example.test", role: "coordination_admin" } as AppUser,
        schools: [school], selectedSchoolId: "", onSchoolChange: () => undefined, loading: false, loadError: "",
        model: { students: [student], payments: [payment], feeTypes: [fee], expenses: [today], personnel: [], schoolYears: [year] },
      })),
    ]) {
      const text = html.replace(/<[^>]+>/g, " ");
      // Ni le montant de la dépense non vérifiée, ni un total de dépenses, ni l'encaissé ou le reste provisoires.
      expect(text).not.toMatch(/15,00/);
      expect(text).not.toMatch(/Dépenses\s*:?\s*[\d$]/);
      expect(text).not.toMatch(/Reste/);
      expect(text).not.toContain("recouvré");
      expect(text).not.toContain("Non calculable");
      expect(text).not.toContain("Indéterminé");
      expect(html).toContain('data-testid="value-skeleton"');
    }
  });

  it("une dépense sans devise retrouvée n'est pas gardée au-delà de l'onglet", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    await resolvePendingExpenseCurrencies([payrollExpense], "user-a", async (rows) => rows);
    clearExpenseCurrencyCache(false);
    expect(pendingExpenseCurrencyIds([payrollExpense], "user-a")).toEqual(["e1"]);
  });
});
