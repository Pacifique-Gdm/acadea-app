import type { FeeType, Payment, Student } from "../types";
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

function resolveIndexes(students: Student[], feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes) {
  return indexes ?? buildSchoolYearDataIndexes(students, feeTypes, payments);
}

export function buildDashboardFinancialStats(students: Student[], feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes): DashboardFinancialStats {
  const dataIndexes = resolveIndexes(students, feeTypes, payments, indexes);
  const totals = students.reduce(
    (currentTotals, student) => {
      const applicableFeeTypes = dataIndexes.applicableFeeTypesByStudentId.get(student.id) ?? feeTypes.filter((fee) => feeAppliesToStudent(fee, student));
      const studentTotals = applicableFeeTypes
        .reduce(
          (feeTotals, fee) => {
            const feePayments = getPaymentsForStudentFee(dataIndexes, student.id, fee.id);
            if (feePayments.length === 0) return feeTotals;

            const paid = sumPayments(feePayments);
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

export function buildDashboardFeeProgressRows(students: Student[], feeTypes: FeeType[], payments: Payment[], indexes?: SchoolYearDataIndexes): DashboardFeeProgressRow[] {
  const dataIndexes = resolveIndexes(students, feeTypes, payments, indexes);
  const rowsByFeeName = students.reduce<Map<string, { name: string; expected: number; paid: number }>>((items, student) => {
    const applicableFeeTypes = dataIndexes.applicableFeeTypesByStudentId.get(student.id) ?? feeTypes.filter((fee) => feeAppliesToStudent(fee, student));
    applicableFeeTypes
      .forEach((fee) => {
        const feePayments = getPaymentsForStudentFee(dataIndexes, student.id, fee.id);
        if (feePayments.length === 0) return;

        const key = fee.name.trim().toLowerCase();
        const paid = sumPayments(feePayments);
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
