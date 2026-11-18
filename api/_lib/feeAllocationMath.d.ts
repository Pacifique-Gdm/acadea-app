import type { FeeAllocationRubric, FeeAllocationMovement, FeeAllocationOpeningProposal } from "../../src/types/feeAllocation";
export const UNALLOCATED_RUBRIC_ID: "UNALLOCATED";
export class FeeAllocationError extends Error { status: number; code: string; }
export function validateFeeAllocationRubrics(rubrics: FeeAllocationRubric[], feeAmountMinor: number): {
  rubrics: FeeAllocationRubric[]; shares: Array<{ rubricId: string; amountMinor: number }>; unallocatedMinor: number;
};
export function assertFeeAllocationMovement(movement: FeeAllocationMovement): FeeAllocationMovement;
export function assertFeeAllocationActivationBlocked(): never;
export function validateFeeAllocationOpeningProposal(proposal: FeeAllocationOpeningProposal): { approved: false; eligibleForReview: boolean };
export type FeeAllocationShare = { rubricId: string; amountMinor: number };
export function allocateFeeReceiptCumulative(shares: FeeAllocationShare[], totalMinor: number): FeeAllocationShare[];
export function sameAllocationRubrics(part1: FeeAllocationRubric[], part2: FeeAllocationRubric[]): boolean;
export function socialCaseShares(part1Rubrics: FeeAllocationRubric[], part2Rubrics: FeeAllocationRubric[] | null | undefined, grossMinor: number, netMinor: number): FeeAllocationShare[];
export function socialCumulativeLines(part1Shares: FeeAllocationShare[], socialShares: FeeAllocationShare[], socialNetMinor: number, totalMinor: number): FeeAllocationShare[];
export function socialSegmentLines(part1Shares: FeeAllocationShare[], segments: Array<{ shares: FeeAllocationShare[]; fromMinor: number }>, netMinor: number, totalMinor: number): FeeAllocationShare[];
