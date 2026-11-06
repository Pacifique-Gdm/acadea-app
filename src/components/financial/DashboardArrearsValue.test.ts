import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeeType, School, SchoolYear } from "../../types";
import { formatCurrencyMoney, type SchoolCurrency } from "../../utils/currency";
import { DashboardArrearsValue } from "./DashboardArrearsValue";
import { resolveApplicableArrearsCurrencies } from "../../utils/arrearsCurrencies";

const school = (id: string, currency?: SchoolCurrency): School => ({
  id, name: id, address: "", phone: "", email: "", currency,
  activeSchoolYearId: `year-${id}`, status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0,
});
const year = (id: string, schoolId: string, currency?: SchoolCurrency): SchoolYear => ({
  id, schoolId, name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-01", status: "active", currency,
});
const fee = (id: string, schoolId: string, schoolYearId: string): FeeType => ({
  id, schoolId, schoolYearId, name: "Frais scolaire", amount: 100,
});

describe("carte Arriérés — devises applicables", () => {
  const schools = [school("usd", "USD"), school("cdf", "CDF"), school("outside", "CDF")];
  const schoolYears = schools.map((item) => year(item.activeSchoolYearId, item.id));
  const base = { schools, schoolYears, feeTypes: [] as FeeType[], totals: { USD: 0, CDF: 0 } };

  it("affiche la devise configurée même lorsque ses arriérés valent zéro, sans école extérieure", () => {
    expect(resolveApplicableArrearsCurrencies({ ...base, alignedSchoolIds: ["usd"] })).toEqual(["USD"]);
    expect(resolveApplicableArrearsCurrencies({ ...base, alignedSchoolIds: ["cdf"] })).toEqual(["CDF"]);
    expect(resolveApplicableArrearsCurrencies({ ...base, alignedSchoolIds: ["usd", "cdf"] })).toEqual(["USD", "CDF"]);
  });

  it("utilise la devise de l'année active et ignore une année non alignée", () => {
    const annualYears = schoolYears.map((item) => item.schoolId === "usd" ? { ...item, currency: "CDF" as const } : item);
    expect(resolveApplicableArrearsCurrencies({ ...base, schoolYears: annualYears, alignedSchoolIds: ["usd"] })).toEqual(["CDF"]);
    expect(resolveApplicableArrearsCurrencies({ ...base, schoolYears: annualYears, alignedSchoolIds: [] })).toEqual([]);
  });

  it("conserve une devise historique avec obligation même si la dette actuelle vaut zéro", () => {
    const oldYear = { ...year("year-old", "cdf", "USD"), status: "archived" as const };
    expect(resolveApplicableArrearsCurrencies({ ...base, schoolYears: [...schoolYears, oldYear], feeTypes: [fee("old-fee", "cdf", oldYear.id)], alignedSchoolIds: ["cdf"] })).toEqual(["USD", "CDF"]);
    expect(resolveApplicableArrearsCurrencies({ ...base, schoolYears: [...schoolYears, oldYear], feeTypes: [fee("old-fee", "cdf", oldYear.id)], alignedSchoolIds: ["usd"] })).toEqual(["USD"]);
  });

  it("préserve une dette historique confirmée d'une autre devise sans conversion", () => {
    expect(resolveApplicableArrearsCurrencies({ ...base, alignedSchoolIds: ["cdf"], totals: { USD: 1500, CDF: 0 } })).toEqual(["USD", "CDF"]);
  });

  it("n'invente pas USD pour une école sans configuration monétaire identifiable", () => {
    const unknown = school("unknown");
    expect(resolveApplicableArrearsCurrencies({ schools: [unknown], schoolYears: [year(unknown.activeSchoolYearId, unknown.id)], feeTypes: [], alignedSchoolIds: [unknown.id], totals: { USD: 0, CDF: 0 } })).toEqual([]);
  });

  it("supprime les préfixes, conserve les symboles et l'état vide", () => {
    const onlyUsd = renderToStaticMarkup(createElement(DashboardArrearsValue, { totals: { USD: 1500, CDF: 0 }, currencies: ["USD"] }));
    expect(onlyUsd).toContain(formatCurrencyMoney(1500, "USD"));
    expect(onlyUsd).not.toContain("USD :");
    expect(onlyUsd).not.toContain("FC");
    const both = renderToStaticMarkup(createElement(DashboardArrearsValue, { totals: { USD: 1500, CDF: 2500000 }, currencies: ["USD", "CDF"] }));
    expect(both).toContain(formatCurrencyMoney(2500000, "CDF"));
    expect(both).not.toContain("CDF :");
    expect(renderToStaticMarkup(createElement(DashboardArrearsValue, { totals: { USD: 0, CDF: 0 }, currencies: [] }))).toContain("Aucune devise financière applicable.");
  });

  it("conserve l'affichage Administrateur/Caissier mono-devise et toute dette historique non nulle", () => {
    const markup = renderToStaticMarkup(createElement(DashboardArrearsValue, { totals: { USD: 0, CDF: 250 }, currency: "USD" }));
    expect(markup).toContain(formatCurrencyMoney(0, "USD"));
    expect(markup).toContain(formatCurrencyMoney(250, "CDF"));
    expect(markup).not.toContain("USD :");
    expect(markup).not.toContain("CDF :");
  });
});
