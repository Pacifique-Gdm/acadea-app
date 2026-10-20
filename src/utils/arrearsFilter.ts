export type ArrearsTotals = Record<string, { USD: number; CDF: number }>;
import { resolveSchoolCurrency } from "./currency";
import type { School } from "../types";
import { toMoneyMinor } from "./money";

function thresholdMinor(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  try { return toMoneyMinor(Number(value)); } catch { return null; }
}

export type ArrearsFilter = { minimum: string; maximum: string };
export const emptyArrearsFilter: ArrearsFilter = { minimum: "", maximum: "" };
export const arrearsFilterActive = (filter: ArrearsFilter) => filter.minimum !== "" || filter.maximum !== "";
export function arrearsFilterForCriterion(comparator: string, threshold: string): ArrearsFilter {
  if (thresholdMinor(threshold) === null) return emptyArrearsFilter;
  if (comparator === "arrears-gte" || /^school:[^:]+:arrears:gte$/.test(comparator)) return { minimum: threshold, maximum: "" };
  if (comparator === "arrears-lt" || /^school:[^:]+:arrears:lt$/.test(comparator)) return { minimum: "", maximum: threshold };
  return emptyArrearsFilter;
}
export function matchesArrearsFilter(total: { USD: number; CDF: number } | undefined, filter: ArrearsFilter, school: Pick<School, "currency">) {
  if (!arrearsFilterActive(filter)) return true;
  if (!total) return false; // unknown is never silently treated as zero
  // Historical debts remain separate by currency; a school's configured currency
  // selects the comparable total without converting or summing the other one.
  const value = total[resolveSchoolCurrency(school)];
  try {
    const minor = toMoneyMinor(value);
    const minimum = filter.minimum === "" ? null : thresholdMinor(filter.minimum);
    const maximum = filter.maximum === "" ? null : thresholdMinor(filter.maximum);
    return (filter.minimum === "" || minimum !== null && minor >= minimum) && (filter.maximum === "" || maximum !== null && minor < maximum);
  } catch { return false; }
}
export function validateArrearsTotals(totals: ArrearsTotals | undefined, ids: readonly string[]): ArrearsTotals {
  if (!totals || ids.some((id) => !totals[id] || ![totals[id].USD, totals[id].CDF].every((value) => Number.isFinite(value) && value >= 0))) throw new Error("Réponse des arriérés incomplète.");
  return totals;
}
