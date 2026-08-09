import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { BookRepository } from '../../infrastructure/db/repositories/book-repository.js';
import {
  AuthorAttachmentRepository,
  type AuthorAttachmentMediaKind,
  type AuthorAttachmentParseStatus,
  type AuthorAttachmentRecord
} from '../../infrastructure/db/repositories/author-attachment-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';

export const MAX_AUTHOR_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_STORED_TEXT_CHARS = 2_000_000;
const MAX_CONTEXT_EXCERPT_CHARS = 12_000;

interface ParseResult {
  text: string;
  parsedCharCount: number;
  status: Exclude<AuthorAttachmentParseStatus, 'discarded'>;
  error: string | null;
}

interface MediaSpec {
  kind: AuthorAttachmentMediaKind;
  extension: string;
  mimeType: string;
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.log']);
const IMAGE_MIME_EXTENSIONS = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/gif', '.gif'], ['image/webp', '.webp']
]);

export class AuthorAttachmentService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public async upload(scope: BookScope, input: { filename: string; mimeType: string; buffer: Buffer }): Promise<AuthorAttachmentRecord> {
    assertBookScope(scope);
    new BookRepository(this.database).require(scope);
    if (input.buffer.length === 0) throw new DomainError(errorCodes.validation, '附件不能为空');
    if (input.buffer.length > MAX_AUTHOR_ATTACHMENT_BYTES) throw new DomainError(errorCodes.validation, '单个附件不能超过20 MiB');
    const originalName = normalizeDisplayName(input.filename);
    const media = resolveMedia(originalName, input.mimeType);
    const attachmentId = this.ids.next();
    const operationId = this.ids.next();
    const relativeDirectory = `books/${scope.bookId}/attachments/${attachmentId}`;
    const sourceRelativePath = `${relativeDirectory}/source${media.extension}`;
    const sourcePath = resolveInside(this.dataDir, sourceRelativePath);
    const directoryPath = resolveInside(this.dataDir, relativeDirectory);
    const contentHash = sha256(input.buffer);
    mkdirSync(directoryPath, { recursive: true });
    writeFileSync(sourcePath, input.buffer, { flag: 'wx' });

    let parsed: ParseResult;
    try {
      parsed = await parseBuffer(media.kind, input.buffer);
    } catch (error) {
      parsed = {
        text: '', parsedCharCount: 0, status: 'failed',
        error: sanitizeParseError(error)
      };
    }
    const extractedRelativePath = parsed.text.length === 0 ? null : `${relativeDirectory}/extracted.txt`;
    if (extractedRelativePath !== null) {
      writeFileSync(resolveInside(this.dataDir, extractedRelativePath), parsed.text, 'utf8');
    }
    const now = this.clock.now().toISOString();
    const repository = new AuthorAttachmentRepository(this.database, scope);

    try {
      return new UnitOfWork(this.database).run(() => {
        repository.recordUploadOperation({ operationId, attachmentId, originalName, mediaKind: media.kind, createdAt: now });
        repository.registerFile({
          fileId: this.ids.next(), operationId, versionId: `${attachmentId}-source`,
          relativePath: sourceRelativePath, contentHash, sizeBytes: input.buffer.length, createdAt: now
        });
        if (extractedRelativePath !== null) {
          const extracted = readFileSync(resolveInside(this.dataDir, extractedRelativePath));
          repository.registerFile({
            fileId: this.ids.next(), operationId, versionId: `${attachmentId}-text`,
            relativePath: extractedRelativePath, contentHash: sha256(extracted), sizeBytes: extracted.length, createdAt: now
          });
        }
        return repository.create({
          attachmentId,
          originalName,
          mediaKind: media.kind,
          mimeType: media.mimeType,
          sizeBytes: input.buffer.length,
          contentHash,
          sourceRelativePath,
          extractedRelativePath,
          parseStatus: parsed.status,
          parsedCharCount: parsed.parsedCharCount,
          contextExcerpt: buildContextExcerpt(parsed.text),
          parseError: parsed.error,
          createdAt: now
        });
      });
    } catch (error) {
      rmSync(directoryPath, { force: true, recursive: true });
      throw error;
    }
  }

  public get(scope: BookScope, attachmentId: string): AuthorAttachmentRecord {
    return new AuthorAttachmentRepository(this.database, scope).require(attachmentId);
  }

  public readSource(scope: BookScope, attachmentId: string): { record: AuthorAttachmentRecord; buffer: Buffer } {
    const record = this.get(scope, attachmentId);
    return { record, buffer: readFileSync(resolveInside(this.dataDir, record.sourceRelativePath)) };
  }

  public discard(scope: BookScope, attachmentId: string): AuthorAttachmentRecord {
    return new AuthorAttachmentRepository(this.database, scope).discard(attachmentId);
  }
}

async function parseBuffer(kind: AuthorAttachmentMediaKind, buffer: Buffer): Promise<ParseResult> {
  if (kind === 'image') return { text: '', parsedCharCount: 0, status: 'preview_only', error: null };
  if (kind === 'text') return normalizeExtractedText(buffer.toString('utf8'));
  if (kind === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return normalizeExtractedText(result.value);
  }
  return extractPdfText(buffer);
}

async function extractPdfText(buffer: Buffer): Promise<ParseResult> {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  let count = 0;
  let truncated = false;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => 'str' in item ? item.str : '')
        .filter((item) => item.length > 0)
        .join(' ')
        .trim();
      if (pageText.length > 0) pages.push(`【第${pageNumber}页】\n${pageText}`);
      count += pageText.length;
      if (pages.join('\n\n').length >= MAX_STORED_TEXT_CHARS) {
        truncated = pageNumber < document.numPages;
        break;
      }
    }
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }
  const text = cleanText(pages.join('\n\n')).slice(0, MAX_STORED_TEXT_CHARS);
  if (text.length === 0) return { text: '', parsedCharCount: 0, status: 'no_text', error: 'PDF未提取到可用文字，可能是扫描件' };
  return { text, parsedCharCount: Math.max(count, text.length), status: truncated ? 'truncated' : 'parsed', error: null };
}

function normalizeExtractedText(value: string): ParseResult {
  const cleaned = cleanText(value);
  if (cleaned.length === 0) return { text: '', parsedCharCount: 0, status: 'no_text', error: '文件未提取到可用文字' };
  const truncated = cleaned.length > MAX_STORED_TEXT_CHARS;
  return {
    text: cleaned.slice(0, MAX_STORED_TEXT_CHARS),
    parsedCharCount: cleaned.length,
    status: truncated ? 'truncated' : 'parsed',
    error: truncated ? '解析文本超过2,000,000字符，已保留前2,000,000字符' : null
  };
}

function cleanText(value: string): string {
  return value.replace(/^\uFEFF/u, '').replace(/\0/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function buildContextExcerpt(text: string): string {
  if (text.length <= MAX_CONTEXT_EXCERPT_CHARS) return text;
  const segment = Math.floor((MAX_CONTEXT_EXCERPT_CHARS - 36) / 3);
  const middleStart = Math.max(0, Math.floor((text.length - segment) / 2));
  return [
    `【开头摘录】\n${text.slice(0, segment)}`,
    `【中段摘录】\n${text.slice(middleStart, middleStart + segment)}`,
    `【结尾摘录】\n${text.slice(-segment)}`
  ].join('\n\n');
}

function resolveMedia(filename: string, claimedMimeType: string): MediaSpec {
  const extension = extname(filename).toLowerCase();
  const mimeType = claimedMimeType.toLowerCase().split(';', 1)[0]!.trim();
  const imageExtension = IMAGE_MIME_EXTENSIONS.get(mimeType);
  if (imageExtension !== undefined && (extension === imageExtension || (mimeType === 'image/jpeg' && extension === '.jpeg'))) {
    return { kind: 'image', extension: imageExtension, mimeType };
  }
  if (extension === '.pdf' && mimeType === 'application/pdf') return { kind: 'pdf', extension, mimeType };
  if (extension === '.docx' && mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { kind: 'docx', extension, mimeType };
  }
  if (TEXT_EXTENSIONS.has(extension) && (mimeType.startsWith('text/') || ['application/json', 'application/octet-stream', ''].includes(mimeType))) {
    return { kind: 'text', extension, mimeType: mimeType.length === 0 || mimeType === 'application/octet-stream' ? 'text/plain' : mimeType };
  }
  throw new DomainError(errorCodes.validation, '不支持此附件类型；可使用图片、TXT、Markdown、JSON、CSV、LOG、PDF或DOCX');
}

function normalizeDisplayName(filename: string): string {
  const normalized = filename.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (normalized.length === 0) throw new DomainError(errorCodes.validation, '附件文件名不能为空');
  return normalized.slice(0, 240);
}

function sanitizeParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : '未知解析错误';
  return `文件解析失败：${message.replace(/[\r\n]+/g, ' ').slice(0, 420)}`;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
