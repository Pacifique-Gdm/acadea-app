import type { Expense, FeeType, Payment, School, Student } from "../types";
import { buildDashboardFeeShares, buildDashboardFinancialAggregates } from "./dashboardStats";
import type { DashboardFeeProgressRow, DashboardFeeShare } from "./dashboardStats";
import { resolveSchoolCurrency, type SchoolCurrency } from "./currency";

export type CoordinationCurrencyFinancialGroup = {
  currency: SchoolCurrency;
  expected: number;
  paid: number;
  expenses: number;
  remaining: number;
  recoveryRate: number;
  feeProgressRows: DashboardFeeProgressRow[];
  feeShares: DashboardFeeShare[];
  payments: Payment[];
  expenseRows: Expense[];
};

function mergeFeeRows(groups: DashboardFeeProgressRow[][]) {
  const rows = new Map<string, { name: string; expected: number; paid: number }>();
  groups.flat().forEach((row) => {
    const key = row.name.trim().toLocaleLowerCase("fr");
    const current = rows.get(key) ?? { name: row.name, expected: 0, paid: 0 };
    rows.set(key, {
      name: current.name,
      expected: current.expected + row.expected,
      paid: current.paid + row.paid,
    });
  });
  return [...rows.values()].map((row) => ({
    ...row,
    remaining: Math.max(row.expected - row.paid, 0),
    rate: row.expected > 0 ? Math.round((row.paid / row.expected) * 100) : 0,
  }));
}

export function groupCoordinationFinancialsByCurrency({
  schools,
  students,
  feeTypes,
  payments,
  expenses,
}: {
  schools: School[];
  students: Student[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
}): CoordinationCurrencyFinancialGroup[] {
  const currencyOrder = [...new Set(schools.map(resolveSchoolCurrency))];
  const schoolCurrency = new Map(schools.map((school) => [school.id, resolveSchoolCurrency(school)]));

  return currencyOrder.map((currency) => {
    const currencySchools = schools.filter((school) => resolveSchoolCurrency(school) === currency);
    const schoolAggregates = currencySchools.map((school) => buildDashboardFinancialAggregates(
      students.filter((student) => student.schoolId === school.id),
      feeTypes.filter((fee) => fee.schoolId === school.id),
      payments.filter((payment) => payment.schoolId === school.id),
    ));
    const feeProgressRows = mergeFeeRows(schoolAggregates.map((aggregate) => aggregate.feeProgressRows));
    const expected = schoolAggregates.reduce((sum, aggregate) => sum + aggregate.financialStats.expected, 0);
    const paid = schoolAggregates.reduce((sum, aggregate) => sum + aggregate.financialStats.paid, 0);
    const currencyPayments = payments.filter((payment) => schoolCurrency.get(payment.schoolId) === currency);
    const currencyExpenses = expenses.filter((expense) => schoolCurrency.get(expense.schoolId) === currency);

    return {
      currency,
      expected,
      paid,
      expenses: currencyExpenses.reduce((sum, expense) => sum + expense.amount, 0),
      remaining: Math.max(expected - paid, 0),
      recoveryRate: expected > 0 ? Math.round((paid / expected) * 100) : 0,
      feeProgressRows,
      feeShares: buildDashboardFeeShares(feeProgressRows),
      payments: currencyPayments,
      expenseRows: currencyExpenses,
    };
  });
}
