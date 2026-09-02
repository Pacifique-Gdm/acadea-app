import type { School, SchoolYear } from "../types";

export type SchoolCurrency = "USD" | "CDF";
const frenchMoneyFormatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function resolveSchoolCurrency(school: Pick<School, "currency">): SchoolCurrency {
  return school.currency === "CDF" ? "CDF" : "USD";
}

/** Les années historiques sans devise conservent le fallback de leur école. */
export function resolveSchoolYearCurrency(year: Pick<SchoolYear, "currency"> | undefined, school: Pick<School, "currency">): SchoolCurrency {
  return year?.currency === "CDF" || year?.currency === "USD" ? year.currency : resolveSchoolCurrency(school);
}

export function schoolWithYearCurrency<T extends School>(school: T, year: Pick<SchoolYear, "currency"> | undefined): T {
  return { ...school, currency: resolveSchoolYearCurrency(year, school) };
}

export function schoolCurrencySymbol(school: Pick<School, "currency">) {
  return resolveSchoolCurrency(school) === "CDF" ? "FC" : "$";
}

export function formatCurrencyMoney(value: number, currency: SchoolCurrency) {
  const formatted = frenchMoneyFormatter.format(value);
  return currency === "CDF" ? `${formatted} FC` : `$${formatted}`;
}

export function formatSchoolMoney(value: number, school: Pick<School, "currency">) {
  return formatCurrencyMoney(value, resolveSchoolCurrency(school));
}
