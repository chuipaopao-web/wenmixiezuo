export interface SyntheticTaskScope {
  readonly ownerId: string;
  readonly bookId: string;
}

export type SyntheticJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly SyntheticJsonValue[]
  | { readonly [key: string]: SyntheticJsonValue };

export type SyntheticTaskStatus =
  | "queued"
  | "running"
  | "waiting_external_check"
  | "completed"
  | "failed"
  | "canceled";

export interface SyntheticTaskRequest {
  readonly scope: SyntheticTaskScope;
  readonly idempotencyKey: string;
  readonly payload: SyntheticJsonValue;
  readonly maxAttempts?: number;
}

export interface SyntheticTaskRecord {
  readonly id: string;
  readonly scope: SyntheticTaskScope;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly status: SyntheticTaskStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseToken: bigint;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly checkpoint: SyntheticJsonValue;
  readonly result: SyntheticJsonValue | null;
  readonly error: SyntheticJsonValue | null;
  readonly cancellationRequestedAt: Date | null;
  readonly revision: bigint;
}

export interface ClaimedSyntheticTask extends SyntheticTaskRecord {
  readonly leaseToken: bigint;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: Date;
}

export interface SyntheticTaskLease {
  readonly taskId: string;
  readonly ownerId: string;
  readonly bookId: string;
  readonly leaseToken: bigint;
  readonly workerId: string;
}

export interface SyntheticTaskEvent {
  readonly taskId: string;
  readonly ownerId: string;
  readonly bookId: string;
  readonly revision: bigint;
  readonly eventType: string;
  readonly payload: SyntheticJsonValue;
  readonly occurredAt: Date;
}

export type ExternalResolution =
  | {
      readonly kind: "completed";
      readonly result: SyntheticJsonValue;
    }
  | {
      readonly kind: "not-started";
      readonly retry: boolean;
    };
