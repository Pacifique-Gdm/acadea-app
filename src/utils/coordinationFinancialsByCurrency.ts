import type { CashInflow, Expense, FeeType, Payment, School, Student } from "../types";
import { buildDashboardFeeShares, buildDashboardFinancialAggregates } from "./dashboardStats";
import type { DashboardFeeProgressRow, DashboardFeeShare } from "./dashboardStats";
import { resolveSchoolCurrency, type SchoolCurrency } from "./currency";
import { remainingMoney, sumMoney } from "./money";

export type CoordinationCurrencyFinancialGroup = {
  currency: SchoolCurrency;
  unknownCurrencyCount?: number;
  official: number;
  reduction: number;
  expected: number;
  paid: number;
  expenses: number;
  cashInflows: number;
  remaining: number;
  recoveryRate: number;
  feeProgressRows: DashboardFeeProgressRow[];
  feeShares: DashboardFeeShare[];
  payments: Payment[];
  expenseRows: Expense[];
  cashInflowRows: CashInflow[];
};

function mergeFeeRows(groups: DashboardFeeProgressRow[][]) {
  const rows = new Map<string, { name: string; official: number; reduction: number; expected: number; paid: number }>();
  groups.flat().forEach((row) => {
    const key = row.name.trim().toLocaleLowerCase("fr");
    const current = rows.get(key) ?? { name: row.name, official: 0, reduction: 0, expected: 0, paid: 0 };
    rows.set(key, {
      name: current.name,
      official: sumMoney([current.official, row.official ?? row.expected]),
      reduction: sumMoney([current.reduction, row.reduction ?? 0]),
      expected: sumMoney([current.expected, row.expected]),
      paid: sumMoney([current.paid, row.paid]),
    });
  });
  return [...rows.values()].map((row) => ({
    ...row,
    remaining: remainingMoney(row.expected, row.paid),
    rate: row.expected > 0 ? Math.round((row.paid / row.expected) * 100) : 0,
  }));
}

export function groupCoordinationFinancialsByCurrency({
  schools,
  students,
  feeTypes,
  payments,
  expenses,
  cashInflows = [],
}: {
  schools: School[];
  students: Student[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
  cashInflows?: CashInflow[];
}): CoordinationCurrencyFinancialGroup[] {
  const scopedSchoolIds = new Set(schools.map((school) => school.id));
  const currencyOrder = [...new Set([
    ...schools.map(resolveSchoolCurrency),
    ...payments.filter((payment) => scopedSchoolIds.has(payment.schoolId)).map((payment) => payment.currency).filter((currency): currency is SchoolCurrency => currency === "CDF" || currency === "USD"),
    ...expenses.filter((expense) => scopedSchoolIds.has(expense.schoolId)).map((expense) => expense.currency).filter((currency): currency is SchoolCurrency => currency === "CDF" || currency === "USD"),
    ...cashInflows.filter((inflow) => scopedSchoolIds.has(inflow.schoolId)).map((inflow) => inflow.currency).filter((currency): currency is SchoolCurrency => currency === "CDF" || currency === "USD"),
  ])];
  const schoolCurrency = new Map(schools.map((school) => [school.id, resolveSchoolCurrency(school)]));
  const unknownCurrencyCount = [...payments, ...expenses, ...cashInflows].filter((operation) => scopedSchoolIds.has(operation.schoolId)
    && operation.currency !== "CDF" && operation.currency !== "USD").length;

  return currencyOrder.map((currency) => {
    const currencySchools = schools.filter((school) => resolveSchoolCurrency(school) === currency);
    const schoolAggregates = currencySchools.map((school) => buildDashboardFinancialAggregates(
      students.filter((student) => student.schoolId === school.id),
      feeTypes.filter((fee) => fee.schoolId === school.id),
      payments.filter((payment) => payment.schoolId === school.id && payment.currency === currency),
    ));
    const feeProgressRows = mergeFeeRows(schoolAggregates.map((aggregate) => aggregate.feeProgressRows));
    const expected = sumMoney(schoolAggregates.map((aggregate) => aggregate.financialStats.expected));
    const official = sumMoney(schoolAggregates.map((aggregate) => aggregate.financialStats.official));
    const reduction = sumMoney(schoolAggregates.map((aggregate) => aggregate.financialStats.reduction));
    const paid = sumMoney(schoolAggregates.map((aggregate) => aggregate.financialStats.paid));
    const currencyPayments = payments.filter((payment) => scopedSchoolIds.has(payment.schoolId) && payment.currency === currency);
    const currencyExpenses = expenses.filter((expense) => scopedSchoolIds.has(expense.schoolId) && expense.currency === currency);
    const currencyCashInflows = cashInflows.filter((inflow) => scopedSchoolIds.has(inflow.schoolId) && inflow.currency === currency);

    return {
      currency,
      official,
      reduction,
      unknownCurrencyCount,
      expected,
      paid: sumMoney([paid, ...currencyPayments.filter((payment) => schoolCurrency.get(payment.schoolId) !== currency).map((payment) => payment.amount)]),
      expenses: sumMoney(currencyExpenses.map((expense) => expense.amount)),
      cashInflows: sumMoney(currencyCashInflows.map((inflow) => inflow.amount)),
      remaining: remainingMoney(expected, paid),
      recoveryRate: expected > 0 ? Math.round((paid / expected) * 100) : 0,
      feeProgressRows,
      feeShares: buildDashboardFeeShares(feeProgressRows),
      payments: currencyPayments,
      expenseRows: currencyExpenses,
      cashInflowRows: currencyCashInflows,
    };
  });
}
