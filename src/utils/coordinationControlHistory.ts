import type { Expense, Payment, School, SchoolYear } from "../types";
import { isInDashboardDateRange } from "./dashboardDates";
import { resolveSchoolCurrency } from "./currency";

export type ControlHistoryFilters = { schoolId: string; startDate: string; endDate: string };
export function matchesControlHistory(operation: Payment | Expense, filters: ControlHistoryFilters) {
  return (!filters.schoolId || operation.schoolId === filters.schoolId)
    && isInDashboardDateRange("paidAt" in operation ? operation.paidAt : operation.spentAt, filters.startDate, filters.endDate);
}
export function controlHistoryCurrency(operation: Payment | Expense, schools: readonly School[], years: readonly SchoolYear[]) {
  const school = schools.find((item) => item.id === operation.schoolId);
  const year = years.find((item) => item.id === operation.schoolYearId && item.schoolId === operation.schoolId);
  return resolveSchoolCurrency({ currency: ("currency" in operation ? operation.currency : undefined) ?? year?.currency ?? school?.currency });
}
