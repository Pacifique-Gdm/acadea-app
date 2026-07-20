import type { Expense, FeeType, Payment, Student } from "../types";
import { buildSchoolYearDataIndexes, getPaymentsForStudentFee, sumPayments } from "./dataIndexes";
import type { SchoolYearDataIndexes } from "./dataIndexes";
import { feeAppliesToStudent } from "./stats";

export type DashboardFinancialStats = {
  expected: number;
  paid: number;
  remaining: number;
};

export type DashboardFeeProgressRow = DashboardFinancialStats & {
  name: string;
  rate: number;
};

export type DashboardFinancialAggregates = {
  financialStats: DashboardFinancialStats;
  feeProgressRows: DashboardFeeProgressRow[];
};

export type DashboardTransactionDayRow = {
  date: string;
  payments: number;
  expenses: number;
  paymentsForDate: Payment[];
  expensesForDate: Expense[];
};

function resolveIndexes(students: Student[], feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes) {
  return indexes ?? buildSchoolYearDataIndexes(students, feeTypes, payments);
}

export function buildDashboardFinancialAggregates(students: Student[], feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes): DashboardFinancialAggregates {
  const dataIndexes = resolveIndexes(students, feeTypes, payments, indexes);
  const rowsByFeeName = new Map<string, { name: string; expected: number; paid: number }>();
  const totals = { expected: 0, paid: 0 };

  students.forEach((student) => {
    const applicableFeeTypes = dataIndexes.applicableFeeTypesByStudentId.get(student.id) ?? feeTypes.filter((fee) => feeAppliesToStudent(fee, student));

    applicableFeeTypes.forEach((fee) => {
      const feePayments = getPaymentsForStudentFee(dataIndexes, student.id, fee.id);
      if (feePayments.length === 0) return;

      const paid = sumPayments(feePayments);
      totals.expected += fee.amount;
      totals.paid += paid;

      const key = fee.name.trim().toLowerCase();
      const current = rowsByFeeName.get(key) ?? { name: fee.name, expected: 0, paid: 0 };
      rowsByFeeName.set(key, {
        ...current,
        expected: current.expected + fee.amount,
        paid: current.paid + paid,
      });
    });
  });

  const feeProgressRows = Array.from(rowsByFeeName.values())
    .map((row, index) => {
      const remaining = Math.max(row.expected - row.paid, 0);
      const rate = row.expected > 0 ? Math.round((row.paid / row.expected) * 100) : 0;
      return { ...row, remaining, rate, originalIndex: index };
    })
    .filter((row) => row.expected > 0)
    .sort((first, second) => {
      const firstIsMinerval = first.name.trim().toLowerCase() === "minerval";
      const secondIsMinerval = second.name.trim().toLowerCase() === "minerval";
      if (firstIsMinerval !== secondIsMinerval) return firstIsMinerval ? -1 : 1;
      return first.originalIndex - second.originalIndex;
    })
    .map((row) => ({
      name: row.name,
      expected: row.expected,
      paid: row.paid,
      remaining: row.remaining,
      rate: row.rate,
    }));

  return {
    financialStats: {
      ...totals,
      remaining: Math.max(totals.expected - totals.paid, 0),
    },
    feeProgressRows,
  };
}

export function buildDashboardFinancialStats(students: Student[], feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes): DashboardFinancialStats {
  return buildDashboardFinancialAggregates(students, feeTypes, payments, indexes).financialStats;
}

export function buildDashboardFeeProgressRows(students: Student[], feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes): DashboardFeeProgressRow[] {
  return buildDashboardFinancialAggregates(students, feeTypes, payments, indexes).feeProgressRows;
}

export function buildDashboardTransactionDayRows({
  dates,
  payments,
  expenses,
  studentIds,
  includeExpenses,
}: {
  dates: string[];
  payments: Payment[];
  expenses: Expense[];
  studentIds: Set<string>;
  includeExpenses: boolean;
}): DashboardTransactionDayRow[] {
  const rowsByDate = new Map<string, DashboardTransactionDayRow>();

  dates.forEach((date) => {
    rowsByDate.set(date, { date, payments: 0, expenses: 0, paymentsForDate: [], expensesForDate: [] });
  });

  payments.forEach((payment) => {
    if (!studentIds.has(payment.studentId)) return;
    const row = rowsByDate.get(payment.paidAt.slice(0, 10));
    if (!row) return;
    row.payments += payment.amount;
    row.paymentsForDate.push(payment);
  });

  if (includeExpenses) {
    expenses.forEach((expense) => {
      const row = rowsByDate.get(expense.spentAt.slice(0, 10));
      if (!row) return;
      row.expenses += expense.amount;
      row.expensesForDate.push(expense);
    });
  }

  return dates.map((date) => rowsByDate.get(date) ?? { date, payments: 0, expenses: 0, paymentsForDate: [], expensesForDate: [] });
}
