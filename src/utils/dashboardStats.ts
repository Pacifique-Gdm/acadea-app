import type { FeeType, Payment, Student } from "../types";
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

function paymentsForStudentFee(payments: Payment[], studentId: string, feeTypeId: string) {
  return payments.filter((payment) => payment.studentId === studentId && payment.feeTypeId === feeTypeId);
}

export function buildDashboardFinancialStats(students: Student[], feeTypes: FeeType[], payments: Payment[]): DashboardFinancialStats {
  const totals = students.reduce(
    (currentTotals, student) => {
      const studentTotals = feeTypes
        .filter((fee) => feeAppliesToStudent(fee, student))
        .reduce(
          (feeTotals, fee) => {
            const feePayments = paymentsForStudentFee(payments, student.id, fee.id);
            if (feePayments.length === 0) return feeTotals;

            const paid = feePayments.reduce((sum, payment) => sum + payment.amount, 0);
            return {
              expected: feeTotals.expected + fee.amount,
              paid: feeTotals.paid + paid,
            };
          },
          { expected: 0, paid: 0 },
        );

      return {
        expected: currentTotals.expected + studentTotals.expected,
        paid: currentTotals.paid + studentTotals.paid,
      };
    },
    { expected: 0, paid: 0 },
  );

  return {
    ...totals,
    remaining: Math.max(totals.expected - totals.paid, 0),
  };
}

export function buildDashboardFeeProgressRows(students: Student[], feeTypes: FeeType[], payments: Payment[]): DashboardFeeProgressRow[] {
  const rowsByFeeName = students.reduce<Map<string, { name: string; expected: number; paid: number }>>((items, student) => {
    feeTypes
      .filter((fee) => feeAppliesToStudent(fee, student))
      .forEach((fee) => {
        const feePayments = paymentsForStudentFee(payments, student.id, fee.id);
        if (feePayments.length === 0) return;

        const key = fee.name.trim().toLowerCase();
        const paid = feePayments.reduce((sum, payment) => sum + payment.amount, 0);
        const current = items.get(key) ?? { name: fee.name, expected: 0, paid: 0 };
        items.set(key, {
          ...current,
          expected: current.expected + fee.amount,
          paid: current.paid + paid,
        });
      });

    return items;
  }, new Map());

  return Array.from(rowsByFeeName.values())
    .map((row) => {
      const remaining = Math.max(row.expected - row.paid, 0);
      const rate = row.expected > 0 ? Math.round((row.paid / row.expected) * 100) : 0;
      return { ...row, remaining, rate };
    })
    .filter((row) => row.expected > 0);
}
