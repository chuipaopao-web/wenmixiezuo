import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../../domain/errors.js';

export interface V7CoverWorkOrder {
  platformStyle: 'qidian' | 'fanqie' | 'mainstream';
  visualStyle: 'vivid' | 'realistic' | 'abstract' | 'guofeng' | 'cinematic' | 'warm' | 'illustration' | 'anime' | 'ink' | 'retro' | 'scifi' | 'suspense' | 'romance';
  compositionStyle: 'character-closeup' | 'character-scene' | 'duality' | 'ensemble' | 'grand-scene' | 'symbolic';
  paletteStyle: 'high-contrast' | 'warm' | 'cool' | 'dark' | 'golden' | 'pastel';
  atmosphereStyle: 'intense' | 'epic' | 'suspense' | 'romantic' | 'healing' | 'lonely';
  elements: string[];
  avoidElements: string[];
  authorDirection: string;
  composition: string;
  visualFocus: string;
  atmosphere: string;
  palette: string;
  mustKeep: string[];
  mustAvoid: string[];
  plannerReview: string;
  imagePrompt: string;
}

export interface V7BookCoverDesignRow {
  design_id: string;
  owner_id: string;
  book_id: string;
  request_hash: string;
  source_version: number;
  chief_member_key: string;
  visual_member_key: string;
  state: 'working' | 'succeeded' | 'failed';
  work_order_json: string;
  provider: string | null;
  model_id: string | null;
  image_mime_type: string | null;
  image_content_hash: string | null;
  image_size_bytes: number | null;
  image_relative_path: string | null;
  adopted: 0 | 1;
  failure_message: string | null;
  created_at: string;
  completed_at: string | null;
  adopted_at: string | null;
  updated_at: string;
}

export interface V7BookCoverDesignTaskRow extends V7BookCoverDesignRow { book_title: string; }

const COLUMNS = `design_id, owner_id, book_id, request_hash, source_version,
  chief_member_key, visual_member_key, state, work_order_json, provider, model_id,
  image_mime_type, image_content_hash, image_size_bytes, image_relative_path,
  adopted, failure_message, created_at, completed_at, adopted_at, updated_at`;
const TASK_COLUMNS = `covers.design_id, covers.owner_id, covers.book_id, covers.request_hash,
  covers.source_version, covers.chief_member_key, covers.visual_member_key, covers.state,
  covers.work_order_json, covers.provider, covers.model_id, covers.image_mime_type,
  covers.image_content_hash, covers.image_size_bytes, covers.image_relative_path,
  covers.adopted, covers.failure_message, covers.created_at, covers.completed_at,
  covers.adopted_at, covers.updated_at`;

export class V7BookCoverDesignRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findByAction(ownerId: string, bookId: string, idempotencyKey: string): V7BookCoverDesignRow | undefined {
    return this.database.prepare(`SELECT ${COLUMNS} FROM v7_book_cover_designs
      WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?`)
      .get(ownerId, bookId, idempotencyKey) as V7BookCoverDesignRow | undefined;
  }

  public list(ownerId: string, bookId: string): V7BookCoverDesignRow[] {
    return this.database.prepare(`SELECT ${COLUMNS} FROM v7_book_cover_designs
      WHERE owner_id = ? AND book_id = ?
      ORDER BY adopted DESC, created_at DESC LIMIT 20`)
      .all(ownerId, bookId) as unknown as V7BookCoverDesignRow[];
  }

  public listForOwner(ownerId: string, limit: number): V7BookCoverDesignTaskRow[] {
    return this.database.prepare(`SELECT ${TASK_COLUMNS}, books.title AS book_title
      FROM v7_book_cover_designs covers
      JOIN books ON books.owner_id = covers.owner_id AND books.book_id = covers.book_id
      WHERE covers.owner_id = ? ORDER BY covers.updated_at DESC LIMIT ?`)
      .all(ownerId, limit) as unknown as V7BookCoverDesignTaskRow[];
  }

  public require(ownerId: string, bookId: string, designId: string): V7BookCoverDesignRow {
    const row = this.database.prepare(`SELECT ${COLUMNS} FROM v7_book_cover_designs
      WHERE owner_id = ? AND book_id = ? AND design_id = ?`).get(ownerId, bookId, designId) as V7BookCoverDesignRow | undefined;
    if (row === undefined) throw new DomainError(errorCodes.validation, '封面方案不存在或不属于当前书籍', {}, false, 404);
    return row;
  }

  public resolveAuthorPenName(ownerId: string): { accountDisplayName: string | null; ownerDisplayName: string | null } | undefined {
    return this.database.prepare(`
      SELECT account.display_name AS accountDisplayName, owner.display_name AS ownerDisplayName
      FROM owners owner
      LEFT JOIN user_accounts account ON account.owner_id = owner.owner_id
      WHERE owner.owner_id = ?
    `).get(ownerId) as { accountDisplayName: string | null; ownerDisplayName: string | null } | undefined;
  }

  public recordSucceededArtifact(input: {
    operationId: string; fileId: string; ownerId: string; bookId: string; designId: string;
    visualMemberKeys: string[]; sourceVersion: number; authorPenName: string | null; preferences: unknown;
    relativePath: string; contentHash: string; sizeBytes: number; completedAt: string;
  }): void {
    this.database.prepare(`INSERT INTO operations (
      operation_id, owner_id, book_id, operation_type, status, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'v7_cover_design', 'succeeded', ?, ?, ?)`).run(
      input.operationId, input.ownerId, input.bookId,
      JSON.stringify({
        designId: input.designId,
        visualMemberKeys: input.visualMemberKeys,
        sourceVersion: input.sourceVersion,
        authorPenName: input.authorPenName,
        preferences: input.preferences
      }),
      input.completedAt, input.completedAt
    );
    this.database.prepare(`INSERT INTO file_registry (
      file_id, owner_id, book_id, chapter_id, version_id, relative_path,
      content_hash, size_bytes, status, operation_id, created_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'active', ?, ?)`).run(
      input.fileId, input.ownerId, input.bookId, `v7-cover-${input.designId}`, input.relativePath,
      input.contentHash, input.sizeBytes, input.operationId, input.completedAt
    );
  }

  public create(input: {
    designId: string; ownerId: string; bookId: string; idempotencyKey: string;
    requestHash: string; sourceVersion: number; chiefMemberKey: string; visualMemberKey: string;
    governanceRevision?: number; chiefTemperature?: number; visualTemperature?: number; now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_book_cover_designs (
      design_id, owner_id, book_id, idempotency_key, request_hash, source_version,
      chief_member_key, visual_member_key, state, governance_revision,chief_temperature,visual_temperature,created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', ?, ?, ?, ?, ?)`).run(
      input.designId, input.ownerId, input.bookId, input.idempotencyKey, input.requestHash,
      input.sourceVersion, input.chiefMemberKey, input.visualMemberKey,
      input.governanceRevision ?? 1, input.chiefTemperature ?? null, input.visualTemperature ?? null, input.now, input.now
    );
  }

  public assignChief(ownerId: string, bookId: string, designId: string, chiefMemberKey: string, now: string): void {
    this.database.prepare(`UPDATE v7_book_cover_designs SET chief_member_key = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND design_id = ? AND state = 'working'`)
      .run(chiefMemberKey, now, ownerId, bookId, designId);
  }

  public succeed(input: {
    ownerId: string; bookId: string; designId: string; workOrder: V7CoverWorkOrder; promptHash: string;
    provider: string; modelId: string; mimeType: string; contentHash: string; sizeBytes: number;
    relativePath: string; completedAt: string;
  }): void {
    this.database.prepare(`UPDATE v7_book_cover_designs SET
      state = 'succeeded', work_order_json = ?, prompt_hash = ?, provider = ?, model_id = ?,
      image_mime_type = ?, image_content_hash = ?, image_size_bytes = ?, image_relative_path = ?,
      completed_at = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND design_id = ? AND state = 'working'`).run(
      JSON.stringify(input.workOrder), input.promptHash, input.provider, input.modelId, input.mimeType,
      input.contentHash, input.sizeBytes, input.relativePath, input.completedAt, input.completedAt,
      input.ownerId, input.bookId, input.designId
    );
  }

  public fail(ownerId: string, bookId: string, designId: string, message: string, now: string): void {
    this.database.prepare(`UPDATE v7_book_cover_designs SET state = 'failed', failure_message = ?, completed_at = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND design_id = ? AND state = 'working'`)
      .run(message.slice(0, 1_000), now, now, ownerId, bookId, designId);
  }

  public adopt(ownerId: string, bookId: string, designId: string, now: string): V7BookCoverDesignRow {
    const selected = this.require(ownerId, bookId, designId);
    if (selected.state !== 'succeeded') throw new DomainError(errorCodes.validation, '这张封面还没有制作完成', {}, false, 409);
    this.database.prepare(`UPDATE v7_book_cover_designs SET adopted = 0, adopted_at = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND adopted = 1`).run(now, ownerId, bookId);
    this.database.prepare(`UPDATE v7_book_cover_designs SET adopted = 1, adopted_at = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND design_id = ?`).run(now, now, ownerId, bookId, designId);
    return this.require(ownerId, bookId, designId);
  }
}
