import { createHash, randomUUID } from "node:crypto";
import {
  bookLifecycleRequestSchema,
  bookListQuerySchema,
  bookRecordSchema,
  type BookLifecycleRequest,
  type BookListQuery,
  type BookRecord as PublicBookContract
} from "@wenmi-rebuild/contracts";
import { DomainError } from "../../domain/errors.js";
import type {
  BookListCursor,
  BookListInput,
  BookListResult,
  BookListStatusFilter,
  BookRecord,
  NormalizedBookListInput,
  PublicBookRecord
} from "../../domain/bookshelf/index.js";
import type { AccountCoreService, AuthenticatedAccountSession } from "../accounts/index.js";
import { PostgresBookshelfRepository } from "../../infrastructure/postgres/repositories/bookshelf-repository.js";
import type { PgClient, PgPool } from "../../infrastructure/postgres/client.js";

export interface CreateBookFromSessionInput {
  readonly title: string;
  readonly idempotencyKey: string;
}

export class BookShelfService {
  private readonly repository: PostgresBookshelfRepository;

  public constructor(pool: PgPool, private readonly accounts: AccountCoreService) {
    this.repository = new PostgresBookshelfRepository(pool);
  }

  public async createBookFromSession(sessionToken: string, input: CreateBookFromSessionInput): Promise<PublicBookRecord> {
    const title = normalizeBookTitle(input.title);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const idempotencyInputHash = hashIdempotencyInput({ title });
    const result = await this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      const existing = await this.repository.findByOwnerAndIdempotencyKey(client, session.account.ownerId, idempotencyKey, true);
      if (existing !== null) {
        if (existing.idempotencyInputHash !== idempotencyInputHash) {
          await this.audit(client, "book_create_idempotency_conflict", "rejected", session, existing.bookId, {
            reason: "idempotency_input_conflict"
          });
          return { kind: "conflict" as const };
        }
        return { kind: "ok" as const, book: publicBook(existing) };
      }
      const book = await this.repository.insertBook(client, {
        bookId: randomUUID(),
        ownerId: session.account.ownerId,
        title,
        idempotencyKey,
        idempotencyInputHash
      });
      await this.audit(client, "book_created", "succeeded", session, book.bookId, { engine: "rebuild" });
      return { kind: "ok" as const, book: publicBook(book) };
    });
    if (result.kind === "conflict") throw new DomainError("BOOK_IDEMPOTENCY_CONFLICT", "这次建书请求和上次同编号请求内容不同。");
    return result.book;
  }

  public async listBooks(sessionToken: string, input: BookListInput): Promise<BookListResult> {
    const auth = await this.accounts.authenticateToken(sessionToken);
    if (auth === null) throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
    const normalized = normalizeListInput(input, auth.ownerId);
    const rows = await this.repository.withTransaction(async (client) => this.repository.listBooks(client, {
      ownerId: auth.ownerId,
      status: normalized.status,
      q: normalized.q,
      limit: normalized.limit,
      cursor: normalized.cursor
    }));
    const page = rows.slice(0, normalized.limit);
    const nextCursor = rows.length > normalized.limit && page.length > 0
      ? encodeCursor({
        ownerId: auth.ownerId,
        status: normalized.status,
        q: normalized.q,
        createdAt: page[page.length - 1]!.createdAt.toISOString(),
        bookId: page[page.length - 1]!.bookId
      })
      : null;
    return { books: page.map(publicBook), nextCursor };
  }

  public async archiveBook(sessionToken: string, bookId: string, input: BookLifecycleRequest): Promise<PublicBookRecord> {
    return this.setBookStatus(sessionToken, bookId, "archived", input.expectedVersion, "book_archived");
  }

  public async restoreBook(sessionToken: string, bookId: string, input: BookLifecycleRequest): Promise<PublicBookRecord> {
    return this.setBookStatus(sessionToken, bookId, "active", input.expectedVersion, "book_restored");
  }

  private async setBookStatus(
    sessionToken: string,
    bookId: string,
    targetStatus: "active" | "archived",
    expectedVersion: number,
    eventType: "book_archived" | "book_restored"
  ): Promise<PublicBookRecord> {
    const normalizedBookId = parseBookId(bookId);
    const version = validateExpectedVersion(expectedVersion);
    const result = await this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      const book = await this.repository.findByOwnerAndBookId(client, session.account.ownerId, normalizedBookId, true);
      if (book === null) return { kind: "not-found" as const };
      if (book.version !== version) {
        await this.audit(client, eventType, "rejected", session, book.bookId, {
          reason: "version_conflict",
          expectedVersion: version,
          currentVersion: book.version
        });
        return { kind: "conflict" as const };
      }
      if (book.status === targetStatus) {
        return { kind: "ok" as const, book: publicBook(book) };
      }
      const updated = await this.repository.updateBookStatus(client, session.account.ownerId, book.bookId, targetStatus);
      await this.audit(client, eventType, "succeeded", session, updated.bookId, {
        previousVersion: book.version,
        nextVersion: updated.version
      });
      return { kind: "ok" as const, book: publicBook(updated) };
    });
    if (result.kind === "not-found") throw new DomainError("BOOK_NOT_FOUND", "没有找到这本书。");
    if (result.kind === "conflict") throw new DomainError("BOOK_VERSION_CONFLICT", "书籍已经更新，请刷新后重试。");
    return result.book;
  }

  private async audit(
    client: PgClient,
    eventType: string,
    result: "succeeded" | "failed" | "rejected",
    session: AuthenticatedAccountSession,
    bookId: string | null,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.repository.recordAudit(client, {
      auditId: randomUUID(),
      bookId,
      ownerId: session.account.ownerId,
      actorUserId: session.account.userId,
      eventType,
      result,
      detail
    });
  }
}

export function createBookShelfService(pool: PgPool, accounts: AccountCoreService): BookShelfService {
  return new BookShelfService(pool, accounts);
}

function normalizeBookTitle(title: string): string {
  const parsed = bookRecordSchema.shape.title.safeParse(title);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书名没有通过检查。");
  return parsed.data;
}

function normalizeIdempotencyKey(key: string): string {
  const value = key.trim();
  if (Array.from(value).length < 1 || Array.from(value).length > 160 || value.includes("\u0000")) {
    throw new DomainError("BOOK_INPUT_INVALID", "建书请求编号没有通过检查。");
  }
  return value;
}

function normalizeListInput(input: BookListInput, ownerId: string): NormalizedBookListInput {
  const parsed = bookListQuerySchema.safeParse(input);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书架查询参数没有通过检查。");
  const q = parsed.data.q?.trim() ?? "";
  const normalized: NormalizedBookListInput = {
    status: parsed.data.status ?? "all",
    q: q.length === 0 ? null : q,
    limit: parsed.data.limit ?? 50,
    cursor: parsed.data.cursor === undefined ? null : decodeCursor(parsed.data.cursor, ownerId, parsed.data.status ?? "all", q.length === 0 ? null : q)
  };
  return normalized;
}

function validateExpectedVersion(version: number): number {
  const parsed = bookLifecycleRequestSchema.shape.expectedVersion.safeParse(version);
  if (!parsed.success) throw new DomainError("BOOK_INPUT_INVALID", "书籍版本没有通过检查。");
  return parsed.data;
}

function parseBookId(bookId: string): string {
  const parsed = bookRecordSchema.shape.bookId.safeParse(bookId);
  if (!parsed.success) throw new DomainError("BOOK_NOT_FOUND", "没有找到这本书。");
  return parsed.data;
}

function publicBook(book: BookRecord): PublicBookRecord {
  return bookRecordSchema.parse({
    bookId: book.bookId,
    title: book.title,
    status: book.status,
    version: book.version,
    updatedAt: book.updatedAt.toISOString()
  }) satisfies PublicBookContract;
}

function hashIdempotencyInput(input: { readonly title: string }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function encodeCursor(cursor: BookListCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  ownerId: string,
  status: BookListStatusFilter,
  q: string | null
): BookListCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("cursor encoding");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<BookListCursor> & { v?: unknown };
    const parsedDate = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
    if (
      parsed.v !== 1 ||
      parsed.ownerId !== ownerId ||
      parsed.status !== status ||
      parsed.q !== q ||
      typeof parsed.createdAt !== "string" ||
      !validCursorIsoTimestamp(parsed.createdAt) ||
      parsedDate === null ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString() !== parsed.createdAt ||
      typeof parsed.bookId !== "string" ||
      !bookRecordSchema.shape.bookId.safeParse(parsed.bookId).success
    ) {
      throw new Error("cursor mismatch");
    }
    return {
      ownerId,
      status,
      q,
      createdAt: parsed.createdAt,
      bookId: parsed.bookId
    };
  } catch {
    throw new DomainError("BOOK_INPUT_INVALID", "书架分页游标没有通过检查。");
  }
}

function validCursorIsoTimestamp(value: string): boolean {
  const match = /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  return year >= 1 && year <= 9999;
}
