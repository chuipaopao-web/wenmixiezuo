import type { DatabaseSync } from 'node:sqlite';
import type { V7BookTitleOption } from '../../../application/books/v7-book-title-output.js';

export interface V7BookTitleDesignRow {
  design_id: string;
  owner_id: string;
  book_id: string;
  request_hash: string;
  source_version: number;
  member_key: string;
  state: 'working' | 'succeeded' | 'failed';
  options_json: string;
  failure_message: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface V7BookTitleDesignTaskRow extends V7BookTitleDesignRow { book_title: string; }

const COLUMNS = `design_id, owner_id, book_id, request_hash, source_version, member_key,
  state, options_json, failure_message, created_at, completed_at, updated_at`;
const TASK_COLUMNS = `calls.design_id, calls.owner_id, calls.book_id, calls.request_hash,
  calls.source_version, calls.member_key, calls.state, calls.options_json,
  calls.failure_message, calls.created_at, calls.completed_at, calls.updated_at`;

export class V7BookTitleDesignRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public find(ownerId: string, bookId: string, idempotencyKey: string): V7BookTitleDesignRow | undefined {
    return this.database.prepare(`
      SELECT ${COLUMNS}
      FROM v7_book_title_design_calls
      WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?
    `).get(ownerId, bookId, idempotencyKey) as V7BookTitleDesignRow | undefined;
  }

  public list(ownerId: string, bookId: string, limit = 20): V7BookTitleDesignRow[] {
    return this.database.prepare(`SELECT ${COLUMNS} FROM v7_book_title_design_calls
      WHERE owner_id = ? AND book_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(ownerId, bookId, limit) as unknown as V7BookTitleDesignRow[];
  }

  public listForOwner(ownerId: string, limit: number): V7BookTitleDesignTaskRow[] {
    return this.database.prepare(`SELECT ${TASK_COLUMNS}, books.title AS book_title
      FROM v7_book_title_design_calls calls
      JOIN books ON books.owner_id = calls.owner_id AND books.book_id = calls.book_id
      WHERE calls.owner_id = ? ORDER BY calls.updated_at DESC LIMIT ?`)
      .all(ownerId, limit) as unknown as V7BookTitleDesignTaskRow[];
  }

  public create(input: {
    designId: string;
    ownerId: string;
    bookId: string;
    idempotencyKey: string;
    requestHash: string;
    sourceVersion: number;
    memberKey: string;
    promptHash: string;
    governanceRevision: number;
    temperature: number;
    now: string;
  }): void {
    this.database.prepare(`
      INSERT INTO v7_book_title_design_calls (
        design_id, owner_id, book_id, idempotency_key, request_hash, source_version,
        member_key, state, prompt_hash, options_json, governance_revision, temperature, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'working', ?, '[]', ?, ?, ?, ?)
    `).run(
      input.designId, input.ownerId, input.bookId, input.idempotencyKey, input.requestHash,
      input.sourceVersion, input.memberKey, input.promptHash,
      input.governanceRevision, input.temperature, input.now, input.now
    );
  }

  public succeed(input: {
    designId: string;
    ownerId: string;
    bookId: string;
    provider: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cashMicros: number;
    options: readonly V7BookTitleOption[];
    completedAt: string;
  }): void {
    this.database.prepare(`
      UPDATE v7_book_title_design_calls
      SET state = 'succeeded', provider = ?, model_id = ?, input_tokens = ?, output_tokens = ?,
          cash_micros = ?, options_json = ?, completed_at = ?, updated_at = ?
      WHERE design_id = ? AND owner_id = ? AND book_id = ? AND state = 'working'
    `).run(
      input.provider, input.modelId, input.inputTokens, input.outputTokens, input.cashMicros,
      JSON.stringify(input.options), input.completedAt, input.completedAt,
      input.designId, input.ownerId, input.bookId
    );
  }

  public fail(input: {
    designId: string;
    ownerId: string;
    bookId: string;
    message: string;
    failedAt: string;
  }): void {
    this.database.prepare(`
      UPDATE v7_book_title_design_calls
      SET state = 'failed', failure_message = ?, completed_at = ?, updated_at = ?
      WHERE design_id = ? AND owner_id = ? AND book_id = ? AND state = 'working'
    `).run(input.message.slice(0, 1_000), input.failedAt, input.failedAt, input.designId, input.ownerId, input.bookId);
  }
}
