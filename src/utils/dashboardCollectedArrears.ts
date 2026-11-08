import type { Payment } from "../types";
import type { SchoolCurrency } from "./currency";
import { isInDashboardDateRange } from "./dashboardDates";
import { sumMoney } from "./money";

/** Collections of debts from earlier school years, by the actual payment day.
 * A zero for an applicable currency is intentional: the date indicator must
 * remain visible when a selected period has no eligible collection. */
export function buildDashboardCollectedArrears(payments: readonly Payment[], options: {
  currentYearBySchoolId: ReadonlyMap<string, string>;
  visibleStudentKeys: ReadonlySet<string>;
  startDate: string;
  endDate: string;
  applicableCurrencies: readonly SchoolCurrency[];
}) {
  const totals: Record<SchoolCurrency, number> = { USD: 0, CDF: 0 };
  for (const payment of payments) {
    const collectionYear = options.currentYearBySchoolId.get(payment.schoolId);
    if (!collectionYear || payment.collectionSchoolYearId !== collectionYear
      || payment.schoolYearId === collectionYear
      || !options.visibleStudentKeys.has(`${payment.schoolId}:${payment.currentStudentId ?? ""}`)
      || !isInDashboardDateRange(payment.paidAt, options.startDate, options.endDate)
      || (payment.currency !== "USD" && payment.currency !== "CDF")) continue;
    totals[payment.currency] = sumMoney([totals[payment.currency], payment.amount]);
  }
  return (["USD", "CDF"] as const)
    .filter((currency) => options.applicableCurrencies.includes(currency) || totals[currency] > 0)
    .map((currency) => ({ currency, amount: totals[currency] }));
}
