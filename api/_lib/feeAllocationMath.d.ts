import type { FeeAllocationRubric, FeeAllocationMovement, FeeAllocationOpeningProposal } from "../../src/types/feeAllocation";
export const UNALLOCATED_RUBRIC_ID: "UNALLOCATED";
export class FeeAllocationError extends Error { status: number; code: string; }
export function validateFeeAllocationRubrics(rubrics: FeeAllocationRubric[], feeAmountMinor: number): {
  rubrics: FeeAllocationRubric[]; shares: Array<{ rubricId: string; amountMinor: number }>; unallocatedMinor: number;
};
export function assertFeeAllocationMovement(movement: FeeAllocationMovement): FeeAllocationMovement;
export function assertFeeAllocationActivationBlocked(): never;
export function validateFeeAllocationOpeningProposal(proposal: FeeAllocationOpeningProposal): { approved: false; eligibleForReview: boolean };
