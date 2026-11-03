import { supportBalance } from "../../api/_lib/socialSupportMath.js";
import type { Expense, FeeType, Payment, Student } from "../types";
import { buildSchoolYearDataIndexes, getPaymentsForStudentFee, sumPayments } from "./dataIndexes";
import type { SchoolYearDataIndexes } from "./dataIndexes";
import { feeAppliesToStudent } from "./stats";
import { remainingMoney, sumMoney } from "./money";

export type DashboardFinancialStats = {
  official: number;
  reduction: number;
  expected: number;
  paid: number;
  remaining: number;
};

export type DashboardFeeProgressRow = Pick<DashboardFinancialStats, "expected" | "paid" | "remaining"> & {
  name: string;
  rate: number;
  official?: number;
  reduction?: number;
};

export type DashboardFeeShare = {
  name: string;
  amount: number;
  percentage: number;
  color?: string;
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
  const rowsByFeeName = new Map<string, { name: string; official: number; reduction: number; expected: number; paid: number }>();
  const totals = { official: 0, reduction: 0, expected: 0, paid: 0 };

  students.forEach((student) => {
    const applicableFeeTypes = dataIndexes.applicableFeeTypesByStudentId.get(student.id) ?? feeTypes.filter((fee) => feeAppliesToStudent(fee, student));

    applicableFeeTypes.forEach((fee) => {
      const feePayments = getPaymentsForStudentFee(dataIndexes, student.id, fee.id);
      const paid = sumPayments(feePayments);
      const balance = supportBalance(student, fee);
      const net = balance.net;
      totals.official = sumMoney([totals.official, balance.official]);
      totals.reduction = sumMoney([totals.reduction, balance.reduction]);
      totals.expected = sumMoney([totals.expected, net]);
      totals.paid = sumMoney([totals.paid, paid]);

      const key = fee.name.trim().toLowerCase();
      const current = rowsByFeeName.get(key) ?? { name: fee.name, official: 0, reduction: 0, expected: 0, paid: 0 };
      rowsByFeeName.set(key, {
        ...current,
        official: sumMoney([current.official, balance.official]),
        reduction: sumMoney([current.reduction, balance.reduction]),
        expected: sumMoney([current.expected, net]),
        paid: sumMoney([current.paid, paid]),
      });
    });
  });

  const feeProgressRows = Array.from(rowsByFeeName.values())
    .map((row, index) => {
      const remaining = remainingMoney(row.expected, row.paid);
      const rate = row.expected > 0 ? Math.round((row.paid / row.expected) * 100) : 0;
      return { ...row, remaining, rate, originalIndex: index };
    })
    .filter((row) => row.official > 0 || row.paid > 0)
    .sort((first, second) => {
      const firstIsMinerval = first.name.trim().toLowerCase() === "minerval";
      const secondIsMinerval = second.name.trim().toLowerCase() === "minerval";
      if (firstIsMinerval !== secondIsMinerval) return firstIsMinerval ? -1 : 1;
      return first.originalIndex - second.originalIndex;
    })
    .map((row) => ({
      name: row.name,
      official: row.official,
      reduction: row.reduction,
      expected: row.expected,
      paid: row.paid,
      remaining: row.remaining,
      rate: row.rate,
    }));

  return {
    financialStats: {
      ...totals,
      remaining: remainingMoney(totals.expected, totals.paid),
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

export function buildDashboardFeeShares(rows: DashboardFeeProgressRow[]): DashboardFeeShare[] {
  const expected = sumMoney(rows.map((row) => Math.max(row.expected, 0)));
  if (expected <= 0) return [];
  // Le diagramme représente exclusivement le montant attendu : les surpaiements
  // sont plafonnés à l'attendu et les impayés valent max(0, attendu - encaissé).
  const paidShares = rows.flatMap((row) => {
    const amount = Math.min(Math.max(row.paid, 0), Math.max(row.expected, 0));
    return amount > 0 ? [{ name: row.name, amount, percentage: (amount / expected) * 100 }] : [];
  });
  const paid = sumMoney(paidShares.map((row) => row.amount));
  const unpaid = remainingMoney(expected, paid);
  return unpaid > 0 ? [...paidShares, { name: "Impayés", amount: unpaid, percentage: (unpaid / expected) * 100, color: "#dc2626" }] : paidShares;
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
    row.payments = sumMoney([row.payments, payment.amount]);
    row.paymentsForDate.push(payment);
  });

  if (includeExpenses) {
    expenses.forEach((expense) => {
      const row = rowsByDate.get(expense.spentAt.slice(0, 10));
      if (!row) return;
      row.expenses = sumMoney([row.expenses, expense.amount]);
      row.expensesForDate.push(expense);
    });
  }

  return dates.map((date) => rowsByDate.get(date) ?? { date, payments: 0, expenses: 0, paymentsForDate: [], expensesForDate: [] });
}
