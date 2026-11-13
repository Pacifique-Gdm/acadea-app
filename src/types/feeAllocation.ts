/** Allocation contracts. Hosted financial activation remains blocked. */
export type FeeAllocationState = "NON_CONFIGURE" | "EN_PREPARATION" | "ACTIVE";
export type FeeAllocationVersionStatus = "prepared" | "published" | "superseded" | "disabled";
export type FeeAllocationMode = "percent" | "fixed";
export type FeeAllocationCurrency = "USD" | "CDF";

export interface FeeAllocationSystemState {
  schoolId: string;
  schoolYearId: string;
  currency: FeeAllocationCurrency;
  status: FeeAllocationState;
  createdAt?: string;
  updatedAt?: string;
  /** Phase 1 cannot set status ACTIVE. */
  activatedAt?: string;
  activatedBy?: string;
}

export interface FeeAllocationRubric {
  id: string;
  name: string;
  mode: FeeAllocationMode;
  /** Hundredths of one percent. 20% = 2000. */
  basisPoints?: number;
  /** Smallest monetary units. */
  fixedMinor?: number;
  description?: string;
}

export interface FeeAllocationConfig {
  id: string;
  schoolId: string;
  schoolYearId: string;
  feeTypeId: string;
  className: string;
  classOptionKey?: string;
  currency: FeeAllocationCurrency;
  draftRevision: number;
  draft?: { rubrics: FeeAllocationRubric[]; feeAmountMinor: number; updatedAt: string; updatedBy: string };
  currentVersionId?: string;
}

export interface FeeAllocationVersion {
  id: string;
  configId: string;
  schoolId: string;
  schoolYearId: string;
  feeTypeId: string;
  className: string;
  classOptionKey?: string;
  currency: FeeAllocationCurrency;
  feeAmountMinor: number;
  version: number;
  status: FeeAllocationVersionStatus;
  effectiveFrom: string | null;
  rubrics: FeeAllocationRubric[];
  shares: Array<{ rubricId: string; amountMinor: number }>;
  createdAt: string;
  createdBy: string;
}

export interface FeeAllocationOpeningProposal {
  schoolId: string;
  collectionSchoolYearId: string;
  currency: FeeAllocationCurrency;
  cutoffAt: string;
  cashAvailableMinor: number;
  justifiedSchoolFeeMinor: number;
  proposedOpeningMinor: number;
  /** Existing operation references only; never a synthetic receipt. */
  evidence: Array<{ collection: "payments" | "expenses"; id: string }>;
  reconciledBy: string;
  reconciledAt: string;
}

/** A proposal and its approval are separate; no approval endpoint exists in phase 1. */
export interface FeeAllocationOpeningAudit {
  id: string;
  schoolId: string;
  schoolYearId: string;
  currency: FeeAllocationCurrency;
  cutoffAt: string;
  proposal: FeeAllocationOpeningProposal;
  status: "proposed" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewEvidence?: string[];
}

export interface FeeAllocationRequestReceipt {
  schoolId: string;
  schoolYearId: string;
  userId: string;
  fingerprint: string;
  result: unknown;
  createdAt: string;
}

export interface FeeAllocationAnchor {
  id: string;
  schoolId: string;
  originSchoolYearId: string;
  studentId: string;
  feeTypeId: string;
  configVersionId: string | null;
  feeAmountMinor: number;
  currency: FeeAllocationCurrency;
  anchoredAt: string;
  obligationAt?: string;
  className?: string | null;
  classOptionKey?: string | null;
}

export interface FeeAllocationMovement {
  id: string;
  schoolId: string;
  originSchoolYearId: string;
  collectionSchoolYearId: string;
  currency: FeeAllocationCurrency;
  sourceType: "payment" | "expense";
  sourceId: string;
  sourceRevision: string;
  configVersionId: string | null;
  /** Positive for a confirmed receipt, negative for a real outgoing payment or reversal. */
  amountMinor: number;
  lines: Array<{ rubricId: string; amountMinor: number }>;
  postedAt: string;
  anchorId?: string;
  feeTypeId?: string;
  studentId?: string;
  collectedAt?: string;
  paidAt?: string;
  actorId?: string;
  type?: "receipt" | "correction" | "reversal";
  reversesMovementId?: string | null;
  supportDecisionId?: string | null;
  /** Phase 3 emits these movements only for isolated emulator fixtures. */
  testOnly?: boolean;
}

export interface FeeAllocationBalance {
  schoolId: string;
  collectionSchoolYearId: string;
  currency: FeeAllocationCurrency;
  rubricId: string;
  /** Not populated by phase 3: no spendable balance before phases 4 and 5. */
  availableMinor?: number;
  receivedMinor?: number;
  spentMinor?: number;
  reservedMinor?: number;
  operational?: false;
  updatedAt: string;
}
