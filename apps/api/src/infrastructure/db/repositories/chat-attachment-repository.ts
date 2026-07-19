import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';
import { DomainError, errorCodes } from '../../../domain/errors.js';

export type ChatAttachmentMediaKind = 'image' | 'text' | 'pdf' | 'docx';
export type ChatAttachmentParseStatus = 'parsed' | 'truncated' | 'preview_only' | 'no_text' | 'failed' | 'discarded';

export interface ChatAttachmentRecord {
  attachmentId: string;
  ownerId: string;
  bookId: string;
  messageId: string | null;
  originalName: string;
  mediaKind: ChatAttachmentMediaKind;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  sourceRelativePath: string;
  extractedRelativePath: string | null;
  parseStatus: ChatAttachmentParseStatus;
  parsedCharCount: number;
  contextExcerpt: string;
  parseError: string | null;
  lifecycleLayer: 'temporary';
  createdAt: string;
  attachedAt: string | null;
}

export interface CreateChatAttachmentInput {
  attachmentId: string;
  originalName: string;
  mediaKind: ChatAttachmentMediaKind;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  sourceRelativePath: string;
  extractedRelativePath: string | null;
  parseStatus: Exclude<ChatAttachmentParseStatus, 'discarded'>;
  parsedCharCount: number;
  contextExcerpt: string;
  parseError: string | null;
  createdAt: string;
}

export interface RegisterChatAttachmentFileInput {
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
  message_id: string | null;
  original_name: string;
  media_kind: ChatAttachmentMediaKind;
  mime_type: string;
  size_bytes: number;
  content_hash: string;
  source_relative_path: string;
  extracted_relative_path: string | null;
  parse_status: ChatAttachmentParseStatus;
  parsed_char_count: number;
  context_excerpt: string;
  parse_error: string | null;
  lifecycle_layer: 'temporary';
  created_at: string;
  attached_at: string | null;
}

function mapRow(row: AttachmentRow): ChatAttachmentRecord {
  return {
    attachmentId: row.attachment_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    messageId: row.message_id,
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
    createdAt: row.created_at,
    attachedAt: row.attached_at
  };
}

const SELECT_COLUMNS = `attachment_id, owner_id, book_id, message_id, original_name,
  media_kind, mime_type, size_bytes, content_hash, source_relative_path,
  extracted_relative_path, parse_status, parsed_char_count, context_excerpt,
  parse_error, lifecycle_layer, created_at, attached_at`;

export class ChatAttachmentRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly scope: BookScope
  ) {
    assertBookScope(scope);
  }

  public create(input: CreateChatAttachmentInput): ChatAttachmentRecord {
    this.database.prepare(`
      INSERT INTO chat_attachments (
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
    mediaKind: ChatAttachmentMediaKind;
    createdAt: string;
  }): void {
    this.database.prepare(`INSERT INTO operations (
      operation_id, owner_id, book_id, operation_type, status, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'chat_attachment_upload', 'succeeded', ?, ?, ?)`)
      .run(
        input.operationId, this.scope.ownerId, this.scope.bookId,
        JSON.stringify({ attachmentId: input.attachmentId, originalName: input.originalName, mediaKind: input.mediaKind }),
        input.createdAt, input.createdAt
      );
  }

  public registerFile(input: RegisterChatAttachmentFileInput): void {
    this.database.prepare(`INSERT INTO file_registry (
      file_id, owner_id, book_id, chapter_id, version_id, relative_path,
      content_hash, size_bytes, status, operation_id, created_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'active', ?, ?)`)
      .run(
        input.fileId, this.scope.ownerId, this.scope.bookId, input.versionId,
        input.relativePath, input.contentHash, input.sizeBytes, input.operationId, input.createdAt
      );
  }

  public require(attachmentId: string): ChatAttachmentRecord {
    const row = this.database.prepare(`SELECT ${SELECT_COLUMNS} FROM chat_attachments
      WHERE attachment_id = ? AND owner_id = ? AND book_id = ?`)
      .get(attachmentId, this.scope.ownerId, this.scope.bookId) as AttachmentRow | undefined;
    if (row === undefined) throw new DomainError(errorCodes.validation, '附件不存在或不属于当前书籍');
    return mapRow(row);
  }

  public requireBindable(attachmentIds: string[]): ChatAttachmentRecord[] {
    const unique = [...new Set(attachmentIds)];
    if (unique.length !== attachmentIds.length) throw new DomainError(errorCodes.validation, '附件ID不能重复');
    if (unique.length > 6) throw new DomainError(errorCodes.validation, '每条消息最多附加6个文件');
    return unique.map((attachmentId) => {
      const item = this.require(attachmentId);
      if (item.messageId !== null) throw new DomainError(errorCodes.validation, `附件已绑定其他消息：${item.originalName}`, {}, false, 409);
      if (item.parseStatus === 'discarded') throw new DomainError(errorCodes.validation, `附件已移除：${item.originalName}`, {}, false, 409);
      return item;
    });
  }

  public bindToMessage(attachmentIds: string[], messageId: string, attachedAt: string): void {
    for (const attachmentId of attachmentIds) {
      const result = this.database.prepare(`UPDATE chat_attachments
        SET message_id = ?, attached_at = ?
        WHERE attachment_id = ? AND owner_id = ? AND book_id = ?
          AND message_id IS NULL AND parse_status <> 'discarded'`)
        .run(messageId, attachedAt, attachmentId, this.scope.ownerId, this.scope.bookId);
      if (result.changes !== 1) throw new DomainError(errorCodes.validation, '附件绑定失败或状态已变化', {}, false, 409);
    }
  }

  public discard(attachmentId: string): ChatAttachmentRecord {
    const existing = this.require(attachmentId);
    if (existing.messageId !== null) throw new DomainError(errorCodes.validation, '已发送附件不能从历史消息中移除', {}, false, 409);
    this.database.prepare(`UPDATE chat_attachments SET parse_status = 'discarded'
      WHERE attachment_id = ? AND owner_id = ? AND book_id = ?`)
      .run(attachmentId, this.scope.ownerId, this.scope.bookId);
    return this.require(attachmentId);
  }

  public listForMessage(messageId: string): ChatAttachmentRecord[] {
    const rows = this.database.prepare(`SELECT ${SELECT_COLUMNS} FROM chat_attachments
      WHERE owner_id = ? AND book_id = ? AND message_id = ? ORDER BY created_at, attachment_id`)
      .all(this.scope.ownerId, this.scope.bookId, messageId) as unknown as AttachmentRow[];
    return rows.map(mapRow);
  }
}
