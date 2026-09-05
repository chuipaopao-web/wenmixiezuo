import type { PgClient, PgPool } from "../client.js";
import { withTransaction } from "../client.js";
import type { BookRecord, BookListCursor, BookListStatusFilter, BookStatus } from "../../../domain/bookshelf/index.js";

export interface BookInsert {
  readonly bookId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly idempotencyInputHash: string;
}

export interface BookListQuery {
  readonly ownerId: string;
  readonly status: BookListStatusFilter;
  readonly q: string | null;
  readonly limit: number;
  readonly cursor: BookListCursor | null;
}

type BookRow = {
  book_id: string;
  owner_id: string;
  title: string;
  status: BookStatus;
  version: number;
  engine: "rebuild";
  idempotency_key: string;
  idempotency_input_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export class PostgresBookshelfRepository {
  public constructor(private readonly pool: PgPool) {}

  public async withTransaction<T>(work: (client: PgClient) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, work);
  }

  public async findByOwnerAndIdempotencyKey(client: PgClient, ownerId: string, idempotencyKey: string, lock = false): Promise<(BookRecord & { readonly idempotencyInputHash: string }) | null> {
    const result = await client.query<BookRow>(
      `SELECT ${bookColumns()} FROM bookshelf_books WHERE owner_id = $1 AND idempotency_key = $2${lock ? " FOR UPDATE" : ""}`,
      [ownerId, idempotencyKey]
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return { ...mapBook(row), idempotencyInputHash: row.idempotency_input_hash };
  }

  public async insertBook(client: PgClient, input: BookInsert): Promise<BookRecord> {
    const result = await client.query<BookRow>(
      `INSERT INTO bookshelf_books (book_id, owner_id, title, status, version, engine, idempotency_key, idempotency_input_hash)
       VALUES ($1, $2, $3, 'active', 1, 'rebuild', $4, $5)
       RETURNING ${bookColumns()}`,
      [input.bookId, input.ownerId, input.title, input.idempotencyKey, input.idempotencyInputHash]
    );
    return mapBook(result.rows[0]!);
  }

  public async findByOwnerAndBookId(client: PgClient, ownerId: string, bookId: string, lock = false): Promise<BookRecord | null> {
    const result = await client.query<BookRow>(
      `SELECT ${bookColumns()} FROM bookshelf_books WHERE owner_id = $1 AND book_id = $2${lock ? " FOR UPDATE" : ""}`,
      [ownerId, bookId]
    );
    return result.rows[0] === undefined ? null : mapBook(result.rows[0]);
  }

  public async listBooks(client: PgClient, input: BookListQuery): Promise<readonly BookRecord[]> {
    const values: unknown[] = [input.ownerId];
    const where = ["owner_id = $1"];
    if (input.status !== "all") {
      values.push(input.status);
      where.push(`status = $${values.length}`);
    }
    if (input.q !== null) {
      values.push(input.q.toLowerCase());
      where.push(`position($${values.length} in lower(title)) > 0`);
    }
    if (input.cursor !== null) {
      values.push(input.cursor.createdAt, input.cursor.bookId);
      where.push(`(created_at, book_id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(input.limit + 1);
    const result = await client.query<BookRow>(
      `SELECT ${bookColumns()} FROM bookshelf_books
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, book_id DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(mapBook);
  }

  public async updateBookStatus(client: PgClient, ownerId: string, bookId: string, status: BookStatus): Promise<BookRecord> {
    const result = await client.query<BookRow>(
      `UPDATE bookshelf_books
       SET status = $3, version = version + 1, updated_at = clock_timestamp()
       WHERE owner_id = $1 AND book_id = $2
       RETURNING ${bookColumns()}`,
      [ownerId, bookId, status]
    );
    return mapBook(result.rows[0]!);
  }

  public async recordAudit(
    client: PgClient,
    input: {
      readonly auditId: string;
      readonly bookId: string | null;
      readonly ownerId: string;
      readonly actorUserId: string;
      readonly eventType: string;
      readonly result: "succeeded" | "failed" | "rejected";
      readonly detail?: Record<string, unknown>;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO bookshelf_book_audit_events
         (audit_id, book_id, owner_id, actor_user_id, event_type, result, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.auditId, input.bookId, input.ownerId, input.actorUserId, input.eventType, input.result, input.detail ?? {}]
    );
  }
}

function bookColumns(alias?: string): string {
  const prefix = alias === undefined ? "" : `${alias}.`;
  return [
    "book_id",
    "owner_id",
    "title",
    "status",
    "version",
    "engine",
    "idempotency_key",
    "idempotency_input_hash",
    "created_at",
    "updated_at"
  ].map((column) => `${prefix}${column}`).join(", ");
}

function mapBook(row: BookRow): BookRecord {
  return {
    bookId: row.book_id,
    ownerId: row.owner_id,
    title: row.title,
    status: row.status,
    version: Number(row.version),
    engine: row.engine,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at)
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
