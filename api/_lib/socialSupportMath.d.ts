import type { Student, FeeType, Payment } from "../../src/types";
export function supportAmount(
  nature: string,
  value: number,
  eligibleMinor: number,
): number;
export function supportBalance(
  student: Student,
  fee: FeeType,
  payments?: Payment[],
): {
  official: number;
  reduction: number;
  net: number;
  paid: number;
  remaining: number;
  credit: number;
  commitment: number;
  thirdPaid: number;
  thirdRemaining: number;
  studentRemaining: number;
  commitments: { decisionId: string; name: string; amount: number }[];
};

export function supportReductionCeiling(balance: ReturnType<typeof supportBalance>): number;
export function supportCeilingMessage(ceilingMinor: number, currency: "USD" | "CDF"): string;
