import type { School } from "../types";

export type SchoolCurrency = "USD" | "CDF";

export function resolveSchoolCurrency(school: Pick<School, "currency">): SchoolCurrency {
  return school.currency === "CDF" ? "CDF" : "USD";
}

export function schoolCurrencySymbol(school: Pick<School, "currency">) {
  return resolveSchoolCurrency(school) === "CDF" ? "FC" : "$";
}

export function formatSchoolMoney(value: number, school: Pick<School, "currency">) {
  return schoolCurrencySymbol(school) === "$" ? `$${value.toFixed(2)}` : `${value.toFixed(2)} FC`;
}
