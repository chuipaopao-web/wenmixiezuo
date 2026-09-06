import { DomainError } from "../../../domain/errors.js";
import {
  COMPUTE_VALUE_MULTIPLIER,
  type UsageEntitlementSnapshot,
  type UsageEntitlementSourceKind,
  type UsageOperationKind,
  type UsageReservationRecord,
  type UsageReservationState
} from "../../../domain/usage/index.js";
import type { PgClient } from "../client.js";

type EntitlementRow = {
  entitlement_snapshot_id: string;
  owner_id: string;
  source_kind: UsageEntitlementSourceKind;
  source_id: string;
  plan_key: string;
  period_start: Date;
  period_end: Date;
  compute_quota: string;
  created_at: Date;
};

type ReservationRow = {
  reservation_id: string;
  owner_id: string;
  book_id: string | null;
  operation_kind: UsageOperationKind;
  operation_id: string;
  idempotency_key: string;
  idempotency_input_hash: string;
  entitlement_snapshot_id: string;
  state: UsageReservationState;
  reserved_tokens: string;
  input_tokens: string | null;
  output_tokens: string | null;
  provider: string | null;
  model_id: string | null;
  external_call_id: string | null;
  release_evidence: string | null;
  started_at: Date;
  completed_at: Date | null;
  updated_at: Date;
};

export class PostgresUsageRepository {
  public async insertEntitlementSnapshot(client: PgClient, input: {
    readonly entitlementSnapshotId: string;
    readonly ownerId: string;
    readonly sourceKind: UsageEntitlementSourceKind;
    readonly sourceId: string;
    readonly planKey: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
    readonly computeQuota: number;
  }): Promise<UsageEntitlementSnapshot> {
    await this.lockActiveOwner(client, input.ownerId);
    const overlap = await client.query(
      `SELECT 1 FROM usage_entitlement_snapshots WHERE owner_id = $1
       AND period_start < $2 AND period_end > $3
       AND NOT (source_kind = $4 AND source_id = $5) LIMIT 1`,
      [input.ownerId, input.periodEnd, input.periodStart, input.sourceKind, input.sourceId]
    );
    if (overlap.rowCount !== 0) {
      throw new DomainError("USAGE_IDEMPOTENCY_CONFLICT", "权益周期重叠，需通过后续权益变更流程处理。");
    }
    const result = await client.query<EntitlementRow>(
      `INSERT INTO usage_entitlement_snapshots (
         entitlement_snapshot_id, owner_id, source_kind, source_id, plan_key,
         period_start, period_end, compute_quota
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (source_kind, source_id) DO NOTHING
       RETURNING ${entitlementColumns()}`,
      [
        input.entitlementSnapshotId,
        input.ownerId,
        input.sourceKind,
        input.sourceId,
        input.planKey,
        input.periodStart,
        input.periodEnd,
        input.computeQuota
      ]
    );
    if (result.rows[0]) return mapEntitlement(result.rows[0]);
    const existing = await this.findEntitlementBySource(client, input.sourceKind, input.sourceId);
    if (
      existing === null ||
      existing.ownerId !== input.ownerId ||
      existing.planKey !== input.planKey ||
      existing.periodStart.getTime() !== input.periodStart.getTime() ||
      existing.periodEnd.getTime() !== input.periodEnd.getTime() ||
      existing.computeQuota !== input.computeQuota
    ) {
      throw new DomainError("USAGE_IDEMPOTENCY_CONFLICT", "权益快照来源已经绑定到另一项权益。");
    }
    return existing;
  }

  public async findEntitlementBySource(
    client: PgClient,
    sourceKind: UsageEntitlementSourceKind,
    sourceId: string
  ): Promise<UsageEntitlementSnapshot | null> {
    const result = await client.query<EntitlementRow>(
      `SELECT ${entitlementColumns()} FROM usage_entitlement_snapshots
       WHERE source_kind = $1 AND source_id = $2`,
      [sourceKind, sourceId]
    );
    return result.rows[0] ? mapEntitlement(result.rows[0]) : null;
  }

  public async findCurrentEntitlement(client: PgClient, ownerId: string): Promise<UsageEntitlementSnapshot | null> {
    await this.lockActiveOwner(client, ownerId);
    const result = await client.query<EntitlementRow>(
      `SELECT ${entitlementColumns()} FROM usage_entitlement_snapshots
       WHERE owner_id = $1 AND period_start <= clock_timestamp() AND period_end > clock_timestamp()
       ORDER BY created_at DESC, entitlement_snapshot_id DESC
       LIMIT 1`,
      [ownerId]
    );
    return result.rows[0] ? mapEntitlement(result.rows[0]) : null;
  }

  public async usageTotalsForEntitlement(client: PgClient, entitlement: UsageEntitlementSnapshot): Promise<{
    readonly consumedTokens: number;
    readonly reservedTokens: number;
  }> {
    const result = await client.query<{ consumed_tokens: string; reserved_tokens: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN state = 'succeeded' THEN input_tokens + output_tokens ELSE 0 END), 0) AS consumed_tokens,
         COALESCE(SUM(CASE WHEN state IN ('reserved', 'unknown') THEN reserved_tokens ELSE 0 END), 0) AS reserved_tokens
       FROM usage_reservations
       WHERE owner_id = $1
         AND started_at >= $2
         AND started_at < $3`,
      [entitlement.ownerId, entitlement.periodStart, entitlement.periodEnd]
    );
    return {
      consumedTokens: safeNumber(result.rows[0]?.consumed_tokens ?? "0", "用量汇总超出安全整数范围。"),
      reservedTokens: safeNumber(result.rows[0]?.reserved_tokens ?? "0", "用量汇总超出安全整数范围。")
    };
  }

  public async findReservationByIdempotencyForUpdate(client: PgClient, input: {
    readonly ownerId: string;
    readonly operationKind: UsageOperationKind;
    readonly operationId: string;
    readonly idempotencyKey: string;
  }): Promise<UsageReservationRecord | null> {
    const result = await client.query<ReservationRow>(
      `SELECT ${reservationColumns()} FROM usage_reservations
       WHERE owner_id = $1 AND operation_kind = $2 AND (idempotency_key = $3 OR operation_id = $4)
       FOR UPDATE`,
      [input.ownerId, input.operationKind, input.idempotencyKey, input.operationId]
    );
    return result.rows[0] ? mapReservation(result.rows[0]) : null;
  }

  public async insertReservation(client: PgClient, input: {
    readonly reservationId: string;
    readonly ownerId: string;
    readonly bookId: string | null;
    readonly operationKind: UsageOperationKind;
    readonly operationId: string;
    readonly idempotencyKey: string;
    readonly idempotencyInputHash: string;
    readonly entitlementSnapshotId: string;
    readonly reservedTokens: number;
    readonly provider: string | null;
    readonly modelId: string | null;
    readonly externalCallId: string | null;
  }): Promise<UsageReservationRecord> {
    const result = await client.query<ReservationRow>(
      `INSERT INTO usage_reservations (
         reservation_id, owner_id, book_id, operation_kind, operation_id, idempotency_key,
         idempotency_input_hash, entitlement_snapshot_id, state, reserved_tokens,
         provider, model_id, external_call_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, $10, $11, $12)
       RETURNING ${reservationColumns()}`,
      [
        input.reservationId,
        input.ownerId,
        input.bookId,
        input.operationKind,
        input.operationId,
        input.idempotencyKey,
        input.idempotencyInputHash,
        input.entitlementSnapshotId,
        input.reservedTokens,
        input.provider,
        input.modelId,
        input.externalCallId
      ]
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "用量预留写入失败。", true);
    return mapReservation(row);
  }

  public async findReservationForUpdate(client: PgClient, input: {
    readonly ownerId: string;
    readonly reservationId: string;
  }): Promise<UsageReservationRecord | null> {
    const result = await client.query<ReservationRow>(
      `SELECT ${reservationColumns()} FROM usage_reservations
       WHERE owner_id = $1 AND reservation_id = $2
       FOR UPDATE`,
      [input.ownerId, input.reservationId]
    );
    return result.rows[0] ? mapReservation(result.rows[0]) : null;
  }

  public async markUnknown(client: PgClient, reservationId: string): Promise<UsageReservationRecord> {
    const result = await client.query<ReservationRow>(
      `UPDATE usage_reservations
       SET state = 'unknown', updated_at = clock_timestamp()
       WHERE reservation_id = $1 AND state = 'reserved'
       RETURNING ${reservationColumns()}`,
      [reservationId]
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "当前用量预留不能标记为未知。");
    return mapReservation(row);
  }

  public async settle(client: PgClient, input: {
    readonly reservationId: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly provider: string | null;
    readonly modelId: string | null;
    readonly externalCallId: string | null;
  }): Promise<UsageReservationRecord> {
    const result = await client.query<ReservationRow>(
      `UPDATE usage_reservations
       SET state = 'succeeded', input_tokens = $2, output_tokens = $3,
           provider = COALESCE($4, provider), model_id = COALESCE($5, model_id),
           external_call_id = COALESCE($6, external_call_id),
           completed_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE reservation_id = $1 AND state IN ('reserved', 'unknown')
       RETURNING ${reservationColumns()}`,
      [input.reservationId, input.inputTokens, input.outputTokens, input.provider, input.modelId, input.externalCallId]
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "当前用量预留不能结算。");
    return mapReservation(row);
  }

  public async release(client: PgClient, input: {
    readonly reservationId: string;
    readonly evidence: string;
  }): Promise<UsageReservationRecord> {
    const result = await client.query<ReservationRow>(
      `UPDATE usage_reservations
       SET state = 'released', release_evidence = $2,
           completed_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE reservation_id = $1 AND state IN ('reserved', 'unknown')
       RETURNING ${reservationColumns()}`,
      [input.reservationId, input.evidence]
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "当前用量预留不能释放。");
    return mapReservation(row);
  }

  public async appendEvent(client: PgClient, reservation: UsageReservationRecord, eventType: string, payload: unknown): Promise<void> {
    const revision = await client.query<{ revision: string }>(
      "SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM usage_reservation_events WHERE reservation_id = $1",
      [reservation.reservationId]
    );
    await client.query(
      `INSERT INTO usage_reservation_events (reservation_id, revision, owner_id, event_type, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        reservation.reservationId,
        revision.rows[0]?.revision ?? "1",
        reservation.ownerId,
        eventType,
        JSON.stringify(payload)
      ]
    );
  }

  public async bindCall(client: PgClient, reservationId: string, input: {
    readonly provider: string | null; readonly modelId: string | null; readonly externalCallId: string | null;
  }): Promise<UsageReservationRecord> {
    const result = await client.query<ReservationRow>(
      `UPDATE usage_reservations SET provider = COALESCE(provider, $2),
         model_id = COALESCE(model_id, $3), external_call_id = COALESCE(external_call_id, $4)
       WHERE reservation_id = $1 AND state IN ('reserved', 'unknown') RETURNING ${reservationColumns()}`,
      [reservationId, input.provider, input.modelId, input.externalCallId]
    );
    if (!result.rows[0]) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "当前用量预留不能绑定调用。");
    return mapReservation(result.rows[0]);
  }

  public async hasReviewEvent(client: PgClient, reservationId: string): Promise<boolean> {
    const result = await client.query(
      "SELECT 1 FROM usage_reservation_events WHERE reservation_id = $1 AND event_type = 'usage.settlement_requires_review' LIMIT 1",
      [reservationId]
    );
    return result.rowCount === 1;
  }

  public async hasEvent(client: PgClient, reservationId: string, eventType: string, payload: unknown): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM usage_reservation_events
       WHERE reservation_id = $1 AND event_type = $2 AND payload = $3::jsonb
       LIMIT 1`,
      [reservationId, eventType, JSON.stringify(payload)]
    );
    return result.rowCount === 1;
  }

  public async assertBookBelongsToOwner(client: PgClient, ownerId: string, bookId: string): Promise<void> {
    const result = await client.query(
      "SELECT 1 FROM bookshelf_books WHERE owner_id = $1 AND book_id = $2 AND status = 'active' FOR UPDATE",
      [ownerId, bookId]
    );
    if (result.rowCount !== 1) {
      throw new DomainError("BOOK_NOT_FOUND", "没有找到这本书。");
    }
  }

  public async lockActiveOwner(client: PgClient, ownerId: string): Promise<void> {
    const result = await client.query(
      "SELECT 1 FROM account_users WHERE owner_id = $1 AND status = 'active' FOR UPDATE",
      [ownerId]
    );
    if (result.rowCount !== 1) {
      throw new DomainError("USAGE_ENTITLEMENT_REQUIRED", "账号不存在或暂时不能使用。");
    }
  }
}

export function usageComputeFromRealTokens(realTokens: number): number {
  const value = safeInteger(realTokens, "用量必须是安全整数。") * COMPUTE_VALUE_MULTIPLIER;
  if (!Number.isSafeInteger(value)) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "算力值超出安全整数范围。");
  return value;
}

function entitlementColumns(): string {
  return `entitlement_snapshot_id, owner_id, source_kind, source_id, plan_key,
    period_start, period_end, compute_quota, created_at`;
}

function reservationColumns(): string {
  return `reservation_id, owner_id, book_id, operation_kind, operation_id, idempotency_key,
    idempotency_input_hash, entitlement_snapshot_id, state, reserved_tokens, input_tokens,
    output_tokens, provider, model_id, external_call_id, release_evidence,
    started_at, completed_at, updated_at`;
}

function mapEntitlement(row: EntitlementRow): UsageEntitlementSnapshot {
  return {
    entitlementSnapshotId: row.entitlement_snapshot_id,
    ownerId: row.owner_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    planKey: row.plan_key,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    computeQuota: safeNumber(row.compute_quota, "权益额度超出安全整数范围。"),
    createdAt: row.created_at
  };
}

function mapReservation(row: ReservationRow): UsageReservationRecord {
  return {
    reservationId: row.reservation_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    operationKind: row.operation_kind,
    operationId: row.operation_id,
    idempotencyKey: row.idempotency_key,
    idempotencyInputHash: row.idempotency_input_hash,
    entitlementSnapshotId: row.entitlement_snapshot_id,
    state: row.state,
    reservedTokens: safeNumber(row.reserved_tokens, "预留额度超出安全整数范围。"),
    inputTokens: row.input_tokens === null ? null : safeNumber(row.input_tokens, "输入用量超出安全整数范围。"),
    outputTokens: row.output_tokens === null ? null : safeNumber(row.output_tokens, "输出用量超出安全整数范围。"),
    provider: row.provider,
    modelId: row.model_id,
    externalCallId: row.external_call_id,
    releaseEvidence: row.release_evidence,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

function safeNumber(value: string, message: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", message, true);
  return numeric;
}

function safeInteger(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", message);
  return value;
}
