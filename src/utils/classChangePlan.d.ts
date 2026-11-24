export interface ClassChangePiece { feeTypeId: string; amountMinor: number }
export interface ClassChangeMove { paymentId: string; fromFeeTypeId: string; pieces: ClassChangePiece[]; overpaidMinor: number }
export interface ClassChangePlan { stays: string[]; moves: ClassChangeMove[]; overpaidMinor: number }
export declare function planClassChangePayments(input: {
  payments: readonly { id: string; feeTypeId: string; amountMinor: number; createdAt?: string }[];
  oldFees: readonly { id: string; name: string }[];
  newFees: readonly { id: string; name: string; netMinor: number }[];
}): ClassChangePlan;
