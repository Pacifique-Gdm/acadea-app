export type ArrearsTotals = Record<string, { USD: number; CDF: number }>;
export type ArrearsFilter = { minimum: string; maximum: string; currency: "USD" | "CDF" };
export const emptyArrearsFilter: ArrearsFilter = { minimum: "", maximum: "", currency: "USD" };
export const arrearsFilterActive = (filter: ArrearsFilter) => filter.minimum !== "" || filter.maximum !== "";
export function matchesArrearsFilter(total: { USD: number; CDF: number } | undefined, filter: ArrearsFilter) {
  if (!arrearsFilterActive(filter)) return true;
  if (!total) return false; // unknown is never silently treated as zero
  const value = total[filter.currency];
  return Number.isFinite(value) && (filter.minimum === "" || value >= Number(filter.minimum)) && (filter.maximum === "" || value < Number(filter.maximum));
}
export function validateArrearsTotals(totals: ArrearsTotals | undefined, ids: readonly string[]): ArrearsTotals {
  if (!totals || ids.some((id) => !totals[id] || ![totals[id].USD, totals[id].CDF].every((value) => Number.isFinite(value) && value >= 0))) throw new Error("Réponse des arriérés incomplète.");
  return totals;
}
