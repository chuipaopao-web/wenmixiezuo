import { randomUUID } from "node:crypto";
import { DomainError, isDomainError } from "../../domain/errors.js";
import { hashSyntheticTaskPayload, normalizeSyntheticJson } from "../../domain/synthetic-tasks/index.js";
import {
  COMPUTE_VALUE_MULTIPLIER,
  type UsageCommitmentTotals,
  type UsageEntitlementSnapshot,
  type UsageEntitlementSourceKind,
  type UsageOperationKind,
  type UsageReservationRecord
} from "../../domain/usage/index.js";
import type { AuthenticatedAccountSession } from "../accounts/index.js";
import type { PgClient, PgPool } from "../../infrastructure/postgres/client.js";
import { withTransaction } from "../../infrastructure/postgres/client.js";
import { PostgresUsageRepository } from "../../infrastructure/postgres/repositories/usage-repository.js";

export interface UsageEntitlementSnapshotInput {
  readonly ownerId: string;
  readonly sourceKind: UsageEntitlementSourceKind;
  readonly sourceId: string;
  readonly planKey: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly computeQuota: number;
}

export interface UsageReservationInput {
  readonly operationKind: UsageOperationKind;
  readonly operationId: string;
  readonly bookId?: string | null;
  readonly idempotencyKey: string;
  readonly request: unknown;
  readonly reservedTokens: number;
  readonly provider?: string | null;
  readonly modelId?: string | null;
  readonly externalCallId?: string | null;
}

export interface UsageReservationScope {
  readonly ownerId: string;
  readonly reservationId: string;
  readonly operationKind: UsageOperationKind;
  readonly operationId: string;
}

export interface UsageSettlementInput extends UsageReservationScope {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly provider?: string | null;
  readonly modelId?: string | null;
  readonly externalCallId?: string | null;
}

export interface UsageReleaseInput extends UsageReservationScope {
  readonly confirmedNotStarted: true;
  readonly evidence: string;
}

export class UsageCoreService {
  private readonly repository = new PostgresUsageRepository();

  public constructor(private readonly pool: PgPool) {}

  /** Internal only: the caller must supply an audited entitlement source, never author-controlled quota. */
  public async grantEntitlementSnapshot(input: UsageEntitlementSnapshotInput): Promise<UsageEntitlementSnapshot> {
    const normalized = normalizeEntitlementInput(input);
    return withTransaction(this.pool, async (client) => this.repository.insertEntitlementSnapshot(client, {
      entitlementSnapshotId: randomUUID(),
      ...normalized
    }));
  }

  public async reserveFromAuthenticatedSessionTransaction(
    client: PgClient,
    session: AuthenticatedAccountSession,
    input: UsageReservationInput
  ): Promise<UsageReservationRecord> {
    return this.reserveForOwnerTransaction(client, session.account.ownerId, input);
  }

  public async reserveForOwnerTransaction(
    client: PgClient,
    ownerId: string,
    input: UsageReservationInput
  ): Promise<UsageReservationRecord> {
    const normalized = normalizeReservationInput(input);
    await this.repository.lockActiveOwner(client, ownerId);
    if (normalized.operationKind === "prebook_opening" && normalized.bookId !== null) {
      throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "开书前用量预留不能伪造书籍归属。");
    }
    if (normalized.operationKind === "book_workflow" && normalized.bookId === null) {
      throw new DomainError("BOOK_NOT_FOUND", "书籍任务用量预留必须绑定已知书籍。");
    }
    if (normalized.bookId !== null) {
      await this.repository.assertBookBelongsToOwner(client, ownerId, normalized.bookId);
    }
    const existing = await this.repository.findReservationByIdempotencyForUpdate(client, {
      ownerId,
      operationKind: normalized.operationKind,
      operationId: normalized.operationId,
      idempotencyKey: normalized.idempotencyKey
    });
    if (existing !== null) {
      if (existing.idempotencyInputHash !== normalized.idempotencyInputHash) {
        throw new DomainError("USAGE_IDEMPOTENCY_CONFLICT", "这次用量预留编号已经用于另一项请求。");
      }
      return existing;
    }

    const entitlement = await this.repository.findCurrentEntitlement(client, ownerId);
    if (entitlement === null) {
      throw new DomainError("USAGE_ENTITLEMENT_REQUIRED", "召集AI团队需使用算力，请先开通会员。");
    }
    const totals = await this.repository.usageTotalsForEntitlement(client, entitlement);
    const projectedCompute = computeValue(safeAdd(safeAdd(totals.consumedTokens, totals.reservedTokens), normalized.reservedTokens));
    if (projectedCompute > entitlement.computeQuota) {
      throw new DomainError("USAGE_QUOTA_EXHAUSTED", "本期剩余算力值不足以继续这一步。");
    }

    const reservation = await this.repository.insertReservation(client, {
      reservationId: randomUUID(),
      ownerId,
      entitlementSnapshotId: entitlement.entitlementSnapshotId,
      ...normalized
    });
    await this.repository.appendEvent(client, reservation, "usage.reserved", {
      reservedTokens: normalized.reservedTokens,
      reservedCompute: computeValue(normalized.reservedTokens),
      entitlementSnapshotId: entitlement.entitlementSnapshotId
    });
    return reservation;
  }

  public async totalsForOwnerTransaction(client: PgClient, ownerId: string): Promise<UsageCommitmentTotals> {
    const entitlement = await this.repository.findCurrentEntitlement(client, ownerId);
    if (entitlement === null) {
      return {
        consumedTokens: 0,
        reservedTokens: 0,
        consumedCompute: 0,
        reservedCompute: 0,
        committedCompute: 0,
        remainingCompute: 0
      };
    }
    const totals = await this.repository.usageTotalsForEntitlement(client, entitlement);
    const consumedCompute = computeValue(totals.consumedTokens);
    const reservedCompute = computeValue(totals.reservedTokens);
    const committedCompute = safeAdd(consumedCompute, reservedCompute);
    return {
      consumedTokens: totals.consumedTokens,
      reservedTokens: totals.reservedTokens,
      consumedCompute,
      reservedCompute,
      committedCompute,
      remainingCompute: Math.max(0, entitlement.computeQuota - committedCompute)
    };
  }

  public async markUnknownTransaction(client: PgClient, input: UsageReservationScope): Promise<UsageReservationRecord> {
    const reservation = await this.requireScopedReservation(client, input);
    if (reservation.state === "unknown") return reservation;
    const updated = await this.repository.markUnknown(client, reservation.reservationId);
    await this.repository.appendEvent(client, updated, "usage.outcome_unknown", {});
    return updated;
  }

  public async settleTransaction(client: PgClient, input: UsageSettlementInput): Promise<UsageReservationRecord> {
    const reservation = await this.requireScopedReservation(client, input);
    const actual = {
      inputTokens: normalizeNonNegativeInteger(input.inputTokens, "输入用量不正确。"),
      outputTokens: normalizeNonNegativeInteger(input.outputTokens, "输出用量不正确。"),
      provider: normalizeOptionalText(input.provider ?? reservation.provider, 80, "模型供应商不正确。"),
      modelId: normalizeOptionalText(input.modelId ?? reservation.modelId, 120, "模型编号不正确。"),
      externalCallId: normalizeOptionalText(input.externalCallId ?? reservation.externalCallId, 160, "外部调用编号不正确。")
    };
    if (reservation.state === "succeeded") {
      if (
        reservation.inputTokens === actual.inputTokens &&
        reservation.outputTokens === actual.outputTokens &&
        (actual.provider === null || reservation.provider === actual.provider) &&
        (actual.modelId === null || reservation.modelId === actual.modelId) &&
        (actual.externalCallId === null || reservation.externalCallId === actual.externalCallId)
      ) {
        return reservation;
      }
      throw new DomainError("USAGE_IDEMPOTENCY_CONFLICT", "这次用量预留已经结算为另一项结果。");
    }
    if (reservation.state === "released") {
      throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "已释放的用量预留不能结算。");
    }
    if (
      (reservation.provider !== null && actual.provider !== null && reservation.provider !== actual.provider) ||
      (reservation.modelId !== null && actual.modelId !== null && reservation.modelId !== actual.modelId) ||
      (reservation.externalCallId !== null && actual.externalCallId !== null && reservation.externalCallId !== actual.externalCallId)
    ) {
      throw new DomainError("USAGE_IDEMPOTENCY_CONFLICT", "这次用量预留已经绑定到另一项模型调用。");
    }
    const actualTokens = safeAdd(actual.inputTokens, actual.outputTokens);
    computeValue(actualTokens);
    if (actual.externalCallId !== null && actual.provider === null) {
      throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "外部调用编号必须绑定供应商。");
    }
    const reviewPayload = {
        actualTokens,
        reservedTokens: reservation.reservedTokens,
        inputTokens: actual.inputTokens,
        outputTokens: actual.outputTokens,
        provider: actual.provider,
        modelId: actual.modelId,
        externalCallId: actual.externalCallId
    };
    if (await this.repository.hasReviewEvent(client, reservation.reservationId)) {
      if (await this.repository.hasEvent(client, reservation.reservationId, "usage.settlement_requires_review", reviewPayload)) {
        return reservation;
      }
      throw new DomainError("USAGE_SETTLEMENT_REQUIRES_REVIEW", "已有待核对用量，不能用另一份结果覆盖。", true);
    }
    if (actualTokens > reservation.reservedTokens) {
      const bound = await this.repository.bindCall(client, reservation.reservationId, actual);
      const reviewTarget = bound.state === "reserved"
        ? await this.repository.markUnknown(client, reservation.reservationId)
        : bound;
      await this.repository.appendEvent(client, reviewTarget, "usage.settlement_requires_review", reviewPayload);
      return reviewTarget;
    }
    const updated = await this.repository.settle(client, {
      reservationId: reservation.reservationId,
      ...actual
    });
    await this.repository.appendEvent(client, updated, "usage.settled", {
      inputTokens: actual.inputTokens,
      outputTokens: actual.outputTokens,
      consumedCompute: computeValue(actualTokens)
    });
    return updated;
  }

  public async releaseTransaction(client: PgClient, input: UsageReleaseInput): Promise<UsageReservationRecord> {
    const reservation = await this.requireScopedReservation(client, input);
    if (input.confirmedNotStarted !== true) {
      throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "释放用量预留必须提供明确未执行证据。");
    }
    const evidence = normalizeText(input.evidence, 500, "释放证据不正确。");
    if (reservation.state === "released") {
      if (reservation.releaseEvidence === evidence) return reservation;
      throw new DomainError("USAGE_IDEMPOTENCY_CONFLICT", "这次用量预留已经用另一项证据释放。");
    }
    if (reservation.state === "succeeded") {
      throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "已结算的用量预留不能释放。");
    }
    if (await this.repository.hasReviewEvent(client, reservation.reservationId)) {
      throw new DomainError("USAGE_SETTLEMENT_REQUIRES_REVIEW", "已有实际用量证据，不能按未执行释放。", true);
    }
    const updated = await this.repository.release(client, {
      reservationId: reservation.reservationId,
      evidence
    });
    await this.repository.appendEvent(client, updated, "usage.released", { evidence });
    return updated;
  }

  private async requireScopedReservation(client: PgClient, input: UsageReservationScope): Promise<UsageReservationRecord> {
    const reservation = await this.repository.findReservationForUpdate(client, {
      ownerId: input.ownerId,
      reservationId: input.reservationId
    });
    if (reservation === null) {
      throw new DomainError("USAGE_RESERVATION_NOT_FOUND", "用量预留不存在或不属于当前账号。");
    }
    if (reservation.operationKind !== input.operationKind || reservation.operationId !== input.operationId) {
      throw new DomainError("USAGE_RESERVATION_NOT_FOUND", "用量预留不存在或不属于当前业务。");
    }
    return reservation;
  }
}

export function createUsageCoreService(pool: PgPool): UsageCoreService {
  return new UsageCoreService(pool);
}

function normalizeEntitlementInput(input: UsageEntitlementSnapshotInput): UsageEntitlementSnapshotInput {
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd.getTime() <= periodStart.getTime()) {
    throw new DomainError("USAGE_ENTITLEMENT_REQUIRED", "权益周期不正确。");
  }
  return {
    ownerId: input.ownerId,
    sourceKind: input.sourceKind,
    sourceId: normalizeText(input.sourceId, 160, "权益来源编号不正确。"),
    planKey: normalizeText(input.planKey, 80, "权益方案不正确。"),
    periodStart,
    periodEnd,
    computeQuota: positiveInteger(input.computeQuota, "权益额度不正确。")
  };
}

function normalizeReservationInput(input: UsageReservationInput) {
  if (input.operationKind !== "prebook_opening" && input.operationKind !== "book_workflow") {
    throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "用量业务类型不正确。");
  }
  const base = {
    operationKind: input.operationKind,
    operationId: normalizeText(input.operationId, 160, "业务编号不正确。"),
    bookId: input.bookId ?? null,
    idempotencyKey: normalizeText(input.idempotencyKey, 160, "用量预留编号不正确。"),
    reservedTokens: positiveInteger(input.reservedTokens, "预留用量不正确。"),
    provider: normalizeOptionalText(input.provider ?? null, 80, "模型供应商不正确。"),
    modelId: normalizeOptionalText(input.modelId ?? null, 120, "模型编号不正确。"),
    externalCallId: normalizeOptionalText(input.externalCallId ?? null, 160, "外部调用编号不正确。")
  };
  computeValue(base.reservedTokens);
  if (base.externalCallId !== null && base.provider === null) {
    throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "外部调用编号必须绑定供应商。");
  }
  return {
    ...base,
    idempotencyInputHash: hashSyntheticTaskPayload(normalizeUsageRequest({
      operationKind: base.operationKind,
      operationId: base.operationId,
      bookId: base.bookId,
      reservedTokens: base.reservedTokens,
      provider: base.provider,
      modelId: base.modelId,
      externalCallId: base.externalCallId,
      request: input.request
    }))
  };
}

function positiveInteger(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", message);
  return value;
}

function normalizeNonNegativeInteger(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", message);
  return value;
}

function normalizeText(value: string, max: number, message: string): string {
  if (typeof value !== "string") throw new DomainError("USAGE_RESERVATION_STATE_INVALID", message);
  const normalized = value.trim();
  if (Array.from(normalized).length < 1 || Array.from(normalized).length > max || normalized.includes("\u0000")) {
    throw new DomainError("USAGE_RESERVATION_STATE_INVALID", message);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null, max: number, message: string): string | null {
  if (value === null) return null;
  return normalizeText(value, max, message);
}

function normalizeUsageRequest(value: unknown) {
  try {
    return normalizeSyntheticJson(value, "用量预留请求");
  } catch (error) {
    if (isDomainError(error)) {
      throw new DomainError("USAGE_RESERVATION_STATE_INVALID", error.message);
    }
    throw error;
  }
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "用量合计超出安全整数范围。");
  return value;
}

function computeValue(realTokens: number): number {
  const value = realTokens * COMPUTE_VALUE_MULTIPLIER;
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError("USAGE_RESERVATION_STATE_INVALID", "算力值超出安全整数范围。");
  return value;
}
