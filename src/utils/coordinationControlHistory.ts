import type { Expense, Payment } from "../types";
import { getTransactionPeriodDates, isInDashboardDateRange } from "./dashboardDates";

export function defaultControlHistoryDate() {
  return getTransactionPeriodDates("today")[0];
}

export type ControlHistoryFilters = { schoolId: string; startDate: string; endDate: string };
export function matchesControlHistory(operation: Payment | Expense, filters: ControlHistoryFilters) {
  return (!filters.schoolId || operation.schoolId === filters.schoolId)
    && isInDashboardDateRange("paidAt" in operation ? operation.paidAt : operation.spentAt, filters.startDate, filters.endDate);
}
export function controlHistoryCurrency(operation: Payment | Expense) {
  return operation.currency === "CDF" || operation.currency === "USD" ? operation.currency : null;
}
