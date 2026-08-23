import type { DatabaseSync } from 'node:sqlite';

export interface PrebookOpeningDesignCallRow {
  call_id: string;
  owner_id: string;
  idempotency_key: string;
  attempt_no: number;
  input_hash: string;
  state: 'working' | 'succeeded' | 'failed' | 'interrupted';
  result_json: string | null;
  error_class: string | null;
  updated_at: string;
}

export interface PrebookOpeningDesignAttemptInput {
  callId: string;
  ownerId: string;
  idempotencyKey: string;
  attemptNo: number;
  inputHash: string;
  memberName: string;
  provider: string;
  modelId: string;
  reservedTokens: number;
  now: string;
}

export class PrebookOpeningDesignRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public inImmediateTransaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public insertAttempt(input: PrebookOpeningDesignAttemptInput): void {
    this.database.prepare(`
      INSERT INTO prebook_opening_design_calls (
        call_id, owner_id, idempotency_key, attempt_no, input_hash,
        role_key, member_name, provider, model_id, state, reserved_tokens,
        started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'chief_editor', ?, ?, ?, 'working', ?, ?, ?, ?)
    `).run(
      input.callId, input.ownerId, input.idempotencyKey, input.attemptNo, input.inputHash,
      input.memberName, input.provider, input.modelId, input.reservedTokens,
      input.now, input.now, input.now
    );
  }

  public markSucceeded(input: {
    ownerId: string;
    callId: string;
    inputTokens: number;
    outputTokens: number;
    cashMicros: number;
    durationMs: number;
    resultJson: string | null;
    errorClass: string | null;
    errorDetail: string | null;
    now: string;
  }): number {
    const updated = this.database.prepare(`
      UPDATE prebook_opening_design_calls
      SET state = 'succeeded', input_tokens = ?, output_tokens = ?, cash_micros = ?, duration_ms = ?,
        result_json = ?, error_class = ?, error_detail = ?, completed_at = ?, updated_at = ?
      WHERE call_id = ? AND owner_id = ? AND state = 'working'
    `).run(
      input.inputTokens, input.outputTokens, input.cashMicros, input.durationMs,
      input.resultJson, input.errorClass, input.errorDetail, input.now, input.now,
      input.callId, input.ownerId
    );
    return Number(updated.changes);
  }

  public markFailed(input: {
    ownerId: string;
    callId: string;
    state: 'failed' | 'interrupted';
    errorClass: string;
    errorDetail: string;
    now: string;
  }): void {
    this.database.prepare(`
      UPDATE prebook_opening_design_calls
      SET state = ?, error_class = ?, error_detail = ?, completed_at = ?, updated_at = ?
      WHERE call_id = ? AND owner_id = ? AND state = 'working'
    `).run(
      input.state, input.errorClass, input.errorDetail, input.now, input.now,
      input.callId, input.ownerId
    );
  }

  public expireStale(ownerId: string, cutoff: string, now: string): void {
    this.database.prepare(`
      UPDATE prebook_opening_design_calls
      SET state = 'failed', error_class = 'stale_after_restart',
        error_detail = '服务重启后没有恢复这次建书前调用，请重新发起。', completed_at = ?, updated_at = ?
      WHERE owner_id = ? AND state = 'working' AND updated_at < ?
    `).run(now, now, ownerId, cutoff);
  }

  public rows(ownerId: string, idempotencyKey: string): PrebookOpeningDesignCallRow[] {
    return this.database.prepare(`
      SELECT call_id, owner_id, idempotency_key, attempt_no, input_hash, state,
        result_json, error_class, updated_at
      FROM prebook_opening_design_calls
      WHERE owner_id = ? AND idempotency_key = ?
      ORDER BY attempt_no
    `).all(ownerId, idempotencyKey) as unknown as PrebookOpeningDesignCallRow[];
  }
}
