export const COMPUTE_VALUE_MULTIPLIER = 2;

export type UsageEntitlementSourceKind = "legacy_migration" | "admin_grant" | "internal_test";
export type UsageOperationKind = "prebook_opening" | "book_workflow";
export type UsageReservationState = "reserved" | "unknown" | "succeeded" | "released";

export interface UsageEntitlementSnapshot {
  readonly entitlementSnapshotId: string;
  readonly ownerId: string;
  readonly sourceKind: UsageEntitlementSourceKind;
  readonly sourceId: string;
  readonly planKey: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly computeQuota: number;
  readonly createdAt: Date;
}

export interface UsageReservationRecord {
  readonly reservationId: string;
  readonly ownerId: string;
  readonly bookId: string | null;
  readonly operationKind: UsageOperationKind;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly idempotencyInputHash: string;
  readonly entitlementSnapshotId: string;
  readonly state: UsageReservationState;
  readonly reservedTokens: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly provider: string | null;
  readonly modelId: string | null;
  readonly externalCallId: string | null;
  readonly releaseEvidence: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
}

export interface UsageCommitmentTotals {
  readonly consumedTokens: number;
  readonly reservedTokens: number;
  readonly consumedCompute: number;
  readonly reservedCompute: number;
  readonly committedCompute: number;
  readonly remainingCompute: number;
}
