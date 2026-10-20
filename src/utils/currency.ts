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

export function parseMoneyInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withoutCurrency = trimmed.replace(/\s*(?:FC|CDF|USD|\$)$/i, "").trim();
  // Spaces alone group thousands. A dot or comma is always a decimal separator.
  // Return invalid text unchanged so the form can display an error instead of 0.
  if (!/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d{0,2})?$/.test(withoutCurrency)) return trimmed;
  const compact = withoutCurrency.replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
  const [integer, decimals] = compact.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "") || "0";
  return decimals === undefined ? normalizedInteger : `${normalizedInteger}.${decimals}`;
}

export function formatMoneyInput(value: string) {
  const canonical = parseMoneyInput(value);
  if (!canonical) return "";
  if (!/^\d+(?:\.\d{0,2})?$/.test(canonical)) return value;
  const [integer, decimals] = canonical.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return decimals === undefined ? grouped : `${grouped},${decimals}`;
}
