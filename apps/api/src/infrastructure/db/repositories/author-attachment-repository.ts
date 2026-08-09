import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';
import { DomainError, errorCodes } from '../../../domain/errors.js';

export type AuthorAttachmentMediaKind = 'image' | 'text' | 'pdf' | 'docx';
export type AuthorAttachmentParseStatus = 'parsed' | 'truncated' | 'preview_only' | 'no_text' | 'failed' | 'discarded';

export interface AuthorAttachmentRecord {
  attachmentId: string;
  ownerId: string;
  bookId: string;
  originalName: string;
  mediaKind: AuthorAttachmentMediaKind;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  sourceRelativePath: string;
  extractedRelativePath: string | null;
  parseStatus: AuthorAttachmentParseStatus;
  parsedCharCount: number;
  contextExcerpt: string;
  parseError: string | null;
  lifecycleLayer: 'temporary';
  createdAt: string;
}

export interface CreateAuthorAttachmentInput {
  attachmentId: string;
  originalName: string;
  mediaKind: AuthorAttachmentMediaKind;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  sourceRelativePath: string;
  extractedRelativePath: string | null;
  parseStatus: Exclude<AuthorAttachmentParseStatus, 'discarded'>;
  parsedCharCount: number;
  contextExcerpt: string;
  parseError: string | null;
  createdAt: string;
}

export interface RegisterAuthorAttachmentFileInput {
  fileId: string;
  operationId: string;
  versionId: string;
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
  createdAt: string;
}

interface AttachmentRow {
  attachment_id: string;
  owner_id: string;
  book_id: string;
  original_name: string;
  media_kind: AuthorAttachmentMediaKind;
  mime_type: string;
  size_bytes: number;
  content_hash: string;
  source_relative_path: string;
  extracted_relative_path: string | null;
  parse_status: AuthorAttachmentParseStatus;
  parsed_char_count: number;
  context_excerpt: string;
  parse_error: string | null;
  lifecycle_layer: 'temporary';
  created_at: string;
}

function mapRow(row: AttachmentRow): AuthorAttachmentRecord {
  return {
    attachmentId: row.attachment_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    originalName: row.original_name,
    mediaKind: row.media_kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    sourceRelativePath: row.source_relative_path,
    extractedRelativePath: row.extracted_relative_path,
    parseStatus: row.parse_status,
    parsedCharCount: row.parsed_char_count,
    contextExcerpt: row.context_excerpt,
    parseError: row.parse_error,
    lifecycleLayer: row.lifecycle_layer,
    createdAt: row.created_at
  };
}

const SELECT_COLUMNS = `attachment_id, owner_id, book_id, original_name,
  media_kind, mime_type, size_bytes, content_hash, source_relative_path,
  extracted_relative_path, parse_status, parsed_char_count, context_excerpt,
  parse_error, lifecycle_layer, created_at`;

export class AuthorAttachmentRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly scope: BookScope
  ) {
    assertBookScope(scope);
  }

  public create(input: CreateAuthorAttachmentInput): AuthorAttachmentRecord {
    this.database.prepare(`
      INSERT INTO author_attachments (
        attachment_id, owner_id, book_id, original_name, media_kind, mime_type,
        size_bytes, content_hash, source_relative_path, extracted_relative_path,
        parse_status, parsed_char_count, context_excerpt, parse_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.attachmentId, this.scope.ownerId, this.scope.bookId, input.originalName,
      input.mediaKind, input.mimeType, input.sizeBytes, input.contentHash,
      input.sourceRelativePath, input.extractedRelativePath, input.parseStatus,
      input.parsedCharCount, input.contextExcerpt, input.parseError, input.createdAt
    );
    return this.require(input.attachmentId);
  }

  public recordUploadOperation(input: {
    operationId: string;
    attachmentId: string;
    originalName: string;
    mediaKind: AuthorAttachmentMediaKind;
    createdAt: string;
  }): void {
    this.database.prepare(`INSERT INTO operations (
      operation_id, owner_id, book_id, operation_type, status, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'author_attachment_upload', 'succeeded', ?, ?, ?)`)
      .run(
        input.operationId, this.scope.ownerId, this.scope.bookId,
        JSON.stringify({ attachmentId: input.attachmentId, originalName: input.originalName, mediaKind: input.mediaKind }),
        input.createdAt, input.createdAt
      );
  }

  public registerFile(input: RegisterAuthorAttachmentFileInput): void {
    this.database.prepare(`INSERT INTO file_registry (
      file_id, owner_id, book_id, chapter_id, version_id, relative_path,
      content_hash, size_bytes, status, operation_id, created_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'active', ?, ?)`)
      .run(
        input.fileId, this.scope.ownerId, this.scope.bookId, input.versionId,
        input.relativePath, input.contentHash, input.sizeBytes, input.operationId, input.createdAt
      );
  }

  public require(attachmentId: string): AuthorAttachmentRecord {
    const row = this.database.prepare(`SELECT ${SELECT_COLUMNS} FROM author_attachments
      WHERE attachment_id = ? AND owner_id = ? AND book_id = ?`)
      .get(attachmentId, this.scope.ownerId, this.scope.bookId) as AttachmentRow | undefined;
    if (row === undefined) throw new DomainError(errorCodes.validation, '附件不存在或不属于当前书籍');
    return mapRow(row);
  }

  public requireBindable(attachmentIds: string[]): AuthorAttachmentRecord[] {
    const unique = [...new Set(attachmentIds)];
    if (unique.length !== attachmentIds.length) throw new DomainError(errorCodes.validation, '附件ID不能重复');
    if (unique.length > 6) throw new DomainError(errorCodes.validation, '每条作者想法最多附加6个文件');
    return unique.map((attachmentId) => {
      const item = this.require(attachmentId);
      if (item.parseStatus === 'discarded') throw new DomainError(errorCodes.validation, `附件已移除：${item.originalName}`, {}, false, 409);
      return item;
    });
  }

  public discard(attachmentId: string): AuthorAttachmentRecord {
    this.require(attachmentId);
    if (this.database.prepare(`SELECT 1 FROM author_planning_input_links
      WHERE owner_id = ? AND book_id = ? AND link_type = 'attachment' AND target_id = ? LIMIT 1`)
      .get(this.scope.ownerId, this.scope.bookId, attachmentId) !== undefined) {
      throw new DomainError(errorCodes.validation, '这个附件已被作者想法引用，不能移除。', {}, false, 409);
    }
    this.database.prepare(`UPDATE author_attachments SET parse_status = 'discarded'
      WHERE attachment_id = ? AND owner_id = ? AND book_id = ?`)
      .run(attachmentId, this.scope.ownerId, this.scope.bookId);
    return this.require(attachmentId);
  }
}