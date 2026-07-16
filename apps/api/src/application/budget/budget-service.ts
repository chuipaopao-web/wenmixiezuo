import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { EventStore } from '../events/event-store.js';

export interface BudgetRecord {
  budgetId: string;
  mode: 'saving' | 'standard' | 'detailed';
  tokenLimit: number;
  cashLimitMicros: number;
  reservedTokens: number;
  spentTokens: number;
  reservedCashMicros: number;
  spentCashMicros: number;
  status: 'active' | 'exhausted' | 'closed';
}

interface BudgetRow {
  budget_id: string;
  mode: BudgetRecord['mode'];
  token_limit: number;
  cash_limit_micros: number;
  reserved_tokens: number;
  spent_tokens: number;
  reserved_cash_micros: number;
  spent_cash_micros: number;
  status: BudgetRecord['status'];
}

export class BudgetService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events?: EventStore
  ) {}

  public create(scope: BookScope, mode: BudgetRecord['mode'], tokenLimit: number, cashLimitMicros = 0): BudgetRecord {
    assertBookScope(scope);
    if (!Number.isInteger(tokenLimit) || tokenLimit < 0 || !Number.isInteger(cashLimitMicros) || cashLimitMicros < 0) {
      throw new Error('预算必须是非负整数');
    }
    const budgetId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO budgets (
        budget_id, owner_id, book_id, mode, token_limit, cash_limit_micros,
        reserved_tokens, reserved_cash_micros, spent_tokens, spent_cash_micros,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'active', ?, ?)
    `).run(budgetId, scope.ownerId, scope.bookId, mode, tokenLimit, cashLimitMicros, now, now);
    return this.require(scope, budgetId);
  }

  public reserve(scope: BookScope, budgetId: string, requestId: string, tokens: number, cashMicros: number | null): string {
    assertBookScope(scope);
    if (cashMicros === null) throw new DomainError(errorCodes.confirmationRequired, '现金费用未知，未授权继续', {}, false, 409);
    if (!Number.isInteger(tokens) || tokens < 0 || !Number.isInteger(cashMicros) || cashMicros < 0) throw new Error('冻结量必须是非负整数');
    const existing = this.database.prepare('SELECT reservation_id FROM budget_reservations WHERE request_id = ?').get(requestId) as { reservation_id: string } | undefined;
    if (existing !== undefined) return existing.reservation_id;
    const reservationId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const budget = this.require(scope, budgetId);
      if (
        budget.status !== 'active' ||
        budget.spentTokens + budget.reservedTokens + tokens > budget.tokenLimit ||
        budget.spentCashMicros + budget.reservedCashMicros + cashMicros > budget.cashLimitMicros
      ) {
        throw new DomainError(errorCodes.budgetExhausted, '预算不足，不能启动新调用', { budgetId }, false, 409);
      }
      this.database.prepare(`
        UPDATE budgets SET reserved_tokens = reserved_tokens + ?,
          reserved_cash_micros = reserved_cash_micros + ?, updated_at = ?
        WHERE budget_id = ? AND owner_id = ? AND book_id = ?
      `).run(tokens, cashMicros, now, budgetId, scope.ownerId, scope.bookId);
      this.database.prepare(`
        INSERT INTO budget_reservations (
          reservation_id, budget_id, owner_id, book_id, request_id,
          frozen_tokens, frozen_cash_micros, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?)
      `).run(reservationId, budgetId, scope.ownerId, scope.bookId, requestId, tokens, cashMicros, now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.emitThreshold(scope, this.require(scope, budgetId));
    return reservationId;
  }

  public settle(
    scope: BookScope,
    reservationId: string,
    usage: { taskId: string | null; provider: string; modelId: string; inputTokens: number; outputTokens: number; cashMicros: number; durationMs: number }
  ): BudgetRecord {
    assertBookScope(scope);
    const reservation = this.database.prepare(`
      SELECT budget_id, request_id, frozen_tokens, frozen_cash_micros, status
      FROM budget_reservations WHERE reservation_id = ? AND owner_id = ? AND book_id = ?
    `).get(reservationId, scope.ownerId, scope.bookId) as {
      budget_id: string; request_id: string; frozen_tokens: number; frozen_cash_micros: number; status: string;
    } | undefined;
    if (reservation === undefined) throw new Error('预算冻结不存在或越权');
    if (reservation.status === 'settled') return this.require(scope, reservation.budget_id);
    const actualTokens = usage.inputTokens + usage.outputTokens;
    if (actualTokens > reservation.frozen_tokens || usage.cashMicros > reservation.frozen_cash_micros) {
      throw new Error('实际用量超过冻结上限，拒绝不受控结算');
    }
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE budget_reservations SET actual_tokens = ?, actual_cash_micros = ?, status = 'settled', settled_at = ?
        WHERE reservation_id = ? AND status = 'reserved'
      `).run(actualTokens, usage.cashMicros, now, reservationId);
      this.database.prepare(`
        UPDATE budgets SET
          reserved_tokens = reserved_tokens - ?, reserved_cash_micros = reserved_cash_micros - ?,
          spent_tokens = spent_tokens + ?, spent_cash_micros = spent_cash_micros + ?,
          status = CASE
            WHEN spent_tokens + ? >= token_limit
              OR (cash_limit_micros > 0 AND spent_cash_micros + ? >= cash_limit_micros) THEN 'exhausted'
            ELSE status END,
          updated_at = ?
        WHERE budget_id = ? AND owner_id = ? AND book_id = ?
      `).run(
        reservation.frozen_tokens, reservation.frozen_cash_micros,
        actualTokens, usage.cashMicros, actualTokens, usage.cashMicros,
        now, reservation.budget_id, scope.ownerId, scope.bookId
      );
      this.database.prepare(`
        INSERT INTO usage_ledger (
          budget_id, reservation_id, owner_id, book_id, task_id, request_id,
          provider, model_id, input_tokens, output_tokens, cash_micros, duration_ms, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reservation.budget_id, reservationId, scope.ownerId, scope.bookId, usage.taskId,
        reservation.request_id, usage.provider, usage.modelId, usage.inputTokens,
        usage.outputTokens, usage.cashMicros, usage.durationMs, now
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    const budget = this.require(scope, reservation.budget_id);
    this.emitThreshold(scope, budget);
    return budget;
  }

  public release(scope: BookScope, reservationId: string): BudgetRecord {
    assertBookScope(scope);
    const reservation = this.database.prepare(`
      SELECT budget_id, frozen_tokens, frozen_cash_micros, status
      FROM budget_reservations WHERE reservation_id = ? AND owner_id = ? AND book_id = ?
    `).get(reservationId, scope.ownerId, scope.bookId) as {
      budget_id: string; frozen_tokens: number; frozen_cash_micros: number; status: string;
    } | undefined;
    if (reservation === undefined) throw new Error('预算冻结不存在或越权');
    if (reservation.status !== 'reserved') return this.require(scope, reservation.budget_id);
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE budget_reservations SET status = 'released', settled_at = ?
        WHERE reservation_id = ? AND status = 'reserved'
      `).run(now, reservationId);
      this.database.prepare(`
        UPDATE budgets SET reserved_tokens = reserved_tokens - ?,
          reserved_cash_micros = reserved_cash_micros - ?, updated_at = ?
        WHERE budget_id = ? AND owner_id = ? AND book_id = ?
      `).run(reservation.frozen_tokens, reservation.frozen_cash_micros, now, reservation.budget_id, scope.ownerId, scope.bookId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.require(scope, reservation.budget_id);
  }

  public require(scope: BookScope, budgetId: string): BudgetRecord {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT budget_id, mode, token_limit, cash_limit_micros, reserved_tokens,
             spent_tokens, reserved_cash_micros, spent_cash_micros, status
      FROM budgets WHERE budget_id = ? AND owner_id = ? AND book_id = ?
    `).get(budgetId, scope.ownerId, scope.bookId) as BudgetRow | undefined;
    if (row === undefined) throw new Error('预算不存在或越权');
    return {
      budgetId: row.budget_id,
      mode: row.mode,
      tokenLimit: row.token_limit,
      cashLimitMicros: row.cash_limit_micros,
      reservedTokens: row.reserved_tokens,
      spentTokens: row.spent_tokens,
      reservedCashMicros: row.reserved_cash_micros,
      spentCashMicros: row.spent_cash_micros,
      status: row.status
    };
  }

  private emitThreshold(scope: BookScope, budget: BudgetRecord): void {
    const tokenRatio = budget.tokenLimit === 0 ? 1 : (budget.spentTokens + budget.reservedTokens) / budget.tokenLimit;
    const cashRatio = budget.cashLimitMicros === 0 ? (budget.spentCashMicros + budget.reservedCashMicros > 0 ? 1 : 0) : (budget.spentCashMicros + budget.reservedCashMicros) / budget.cashLimitMicros;
    const ratio = Math.max(tokenRatio, cashRatio);
    if (ratio >= 0.7) this.events?.append(scope, 'budget.threshold.reached', { budgetId: budget.budgetId, ratio, exhausted: ratio >= 1 });
  }
}
