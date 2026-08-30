import type { DatabaseSync } from 'node:sqlite';

export type SupplementalUsageSourceKind = 'v7_title' | 'v7_cover_text' | 'v7_cover_image';

export interface AccountUsageTotals {
  consumedTokens: number;
  reservedTokens: number;
  inputTokens: number;
  outputTokens: number;
  cashMicros: number;
  consumedUnits: number;
  reservedUnits: number;
  consumedCalls: number;
  reservedCalls: number;
  failedCalls: number;
}

interface UsageTotalsRow {
  consumed_tokens: number;
  reserved_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cash_micros: number;
  consumed_units: number;
  reserved_units: number;
  consumed_calls: number;
  reserved_calls: number;
  failed_calls: number;
}

interface SupplementalUsageRow {
  source_kind: SupplementalUsageSourceKind;
  source_id: string;
  owner_id: string;
  book_id: string;
  provider: string;
  model_id: string;
  state: 'working' | 'succeeded' | 'failed' | 'unknown';
  reserved_tokens: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cash_micros: number | null;
  reserved_units: number;
  consumed_units: number;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

const LEGACY_USAGE_RELATION = `(
  SELECT
    'usage_ledger' AS source_kind,
    CAST(usage_id AS TEXT) AS source_id,
    owner_id,
    book_id,
    provider,
    model_id,
    'succeeded' AS source_state,
    'consumed' AS usage_state,
    input_tokens,
    output_tokens,
    input_tokens + output_tokens AS consumed_tokens,
    0 AS reserved_tokens,
    cash_micros,
    0 AS consumed_units,
    0 AS reserved_units,
    recorded_at,
    recorded_at AS completed_at
  FROM usage_ledger
)`;

/**
 * Returns the one authoritative account-usage relation. The legacy fallback
 * keeps a rolling API binary readable during an additive migration rollout;
 * once 0101 is applied every caller automatically sees all registered V7
 * sources through the view.
 */
export function accountUsageRelation(database: DatabaseSync): string {
  const projection = database.prepare(`SELECT 1 AS found FROM sqlite_schema
    WHERE type = 'view' AND name = 'account_usage_projection'`).get();
  return projection === undefined ? LEGACY_USAGE_RELATION : 'account_usage_projection';
}

export function accountUsageTotals(
  database: DatabaseSync,
  input: { ownerId?: string; since?: string; until?: string } = {}
): AccountUsageTotals {
  const relation = accountUsageRelation(database);
  const clauses: string[] = [];
  const values: string[] = [];
  if (input.ownerId !== undefined) {
    clauses.push('owner_id = ?');
    values.push(input.ownerId);
  }
  if (input.since !== undefined) {
    clauses.push('recorded_at >= ?');
    values.push(input.since);
  }
  if (input.until !== undefined) {
    clauses.push('recorded_at < ?');
    values.push(input.until);
  }
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
  const row = database.prepare(`
    SELECT
      COALESCE(SUM(consumed_tokens), 0) AS consumed_tokens,
      COALESCE(SUM(reserved_tokens), 0) AS reserved_tokens,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cash_micros), 0) AS cash_micros,
      COALESCE(SUM(consumed_units), 0) AS consumed_units,
      COALESCE(SUM(reserved_units), 0) AS reserved_units,
      COALESCE(SUM(CASE WHEN usage_state = 'consumed' THEN 1 ELSE 0 END), 0) AS consumed_calls,
      COALESCE(SUM(CASE WHEN usage_state = 'reserved' THEN 1 ELSE 0 END), 0) AS reserved_calls,
      COALESCE(SUM(CASE WHEN usage_state = 'failed' THEN 1 ELSE 0 END), 0) AS failed_calls
    FROM ${relation}
    ${where}
  `).get(...values) as unknown as UsageTotalsRow;
  return {
    consumedTokens: Number(row.consumed_tokens),
    reservedTokens: Number(row.reserved_tokens),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cashMicros: Number(row.cash_micros),
    consumedUnits: Number(row.consumed_units),
    reservedUnits: Number(row.reserved_units),
    consumedCalls: Number(row.consumed_calls),
    reservedCalls: Number(row.reserved_calls),
    failedCalls: Number(row.failed_calls)
  };
}

export class SupplementalAccountUsageRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public start(input: {
    sourceKind: SupplementalUsageSourceKind;
    sourceId: string;
    ownerId: string;
    bookId: string;
    provider: string;
    modelId: string;
    reservedTokens?: number;
    reservedUnits?: number;
    startedAt: string;
  }): void {
    this.assertAvailable();
    this.database.prepare(`
      INSERT INTO account_usage_supplemental_calls (
        source_kind, source_id, owner_id, book_id, provider, model_id, state,
        reserved_tokens, reserved_units, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'working', ?, ?, ?, ?)
      ON CONFLICT(source_kind, source_id) DO NOTHING
    `).run(
      input.sourceKind,
      input.sourceId,
      input.ownerId,
      input.bookId,
      input.provider,
      input.modelId,
      nonNegative(input.reservedTokens ?? 0),
      nonNegative(input.reservedUnits ?? 0),
      input.startedAt,
      input.startedAt
    );
    const row = this.require(input.sourceKind, input.sourceId);
    if (row.owner_id !== input.ownerId || row.book_id !== input.bookId
      || row.provider !== input.provider || row.model_id !== input.modelId
      || row.reserved_tokens !== nonNegative(input.reservedTokens ?? 0)
      || row.reserved_units !== nonNegative(input.reservedUnits ?? 0)) {
      throw new Error('账号用量来源编号已经绑定到不同调用');
    }
  }

  public succeed(input: {
    sourceKind: SupplementalUsageSourceKind;
    sourceId: string;
    inputTokens?: number;
    outputTokens?: number;
    cashMicros?: number;
    consumedUnits?: number;
    completedAt: string;
  }): void {
    this.assertAvailable();
    const actual = {
      inputTokens: nonNegative(input.inputTokens ?? 0),
      outputTokens: nonNegative(input.outputTokens ?? 0),
      cashMicros: nonNegative(input.cashMicros ?? 0),
      consumedUnits: nonNegative(input.consumedUnits ?? 0)
    };
    const result = this.database.prepare(`
      UPDATE account_usage_supplemental_calls
      SET state = 'succeeded', input_tokens = ?, output_tokens = ?, cash_micros = ?,
          consumed_units = ?, completed_at = ?, updated_at = ?
      WHERE source_kind = ? AND source_id = ? AND state IN ('working','unknown')
    `).run(
      actual.inputTokens,
      actual.outputTokens,
      actual.cashMicros,
      actual.consumedUnits,
      input.completedAt,
      input.completedAt,
      input.sourceKind,
      input.sourceId
    );
    if (result.changes === 1) return;
    const row = this.require(input.sourceKind, input.sourceId);
    if (row.state === 'succeeded'
      && row.input_tokens === actual.inputTokens
      && row.output_tokens === actual.outputTokens
      && row.cash_micros === actual.cashMicros
      && row.consumed_units === actual.consumedUnits) return;
    throw new Error('账号用量调用不能重复结算为不同结果');
  }

  public fail(sourceKind: SupplementalUsageSourceKind, sourceId: string, failedAt: string): void {
    this.assertAvailable();
    this.database.prepare(`UPDATE account_usage_supplemental_calls
      SET state = 'failed', completed_at = ?, updated_at = ?
      WHERE source_kind = ? AND source_id = ? AND state IN ('working','unknown')`)
      .run(failedAt, failedAt, sourceKind, sourceId);
  }

  public markUnknown(sourceKind: SupplementalUsageSourceKind, sourceId: string, updatedAt: string): void {
    this.assertAvailable();
    this.database.prepare(`UPDATE account_usage_supplemental_calls
      SET state = 'unknown', updated_at = ?
      WHERE source_kind = ? AND source_id = ? AND state = 'working'`)
      .run(updatedAt, sourceKind, sourceId);
  }

  private assertAvailable(): void {
    const objects = this.database.prepare(`SELECT name FROM sqlite_schema
      WHERE (type = 'table' AND name = 'account_usage_supplemental_calls')
         OR (type = 'view' AND name = 'account_usage_projection')`).all() as Array<{ name: string }>;
    if (objects.length !== 2) {
      throw new Error('账号用量投影尚未就绪，已拒绝本次模型调用');
    }
  }

  private require(sourceKind: SupplementalUsageSourceKind, sourceId: string): SupplementalUsageRow {
    const row = this.database.prepare(`SELECT * FROM account_usage_supplemental_calls
      WHERE source_kind = ? AND source_id = ?`).get(sourceKind, sourceId) as SupplementalUsageRow | undefined;
    if (row === undefined) throw new Error('账号用量调用不存在');
    return row;
  }
}

function nonNegative(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('账号用量必须是非负安全整数');
  return value;
}
