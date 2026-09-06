import type { PgClient, PgPool } from "../client.js";
import { withTransaction } from "../client.js";
import type {
  BookRecord,
  BookListCursor,
  BookListStatusFilter,
  BookStatus,
  ManualBookChapterDirectoryRecord,
  ManualBookSourceRecord
} from "../../../domain/bookshelf/index.js";

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

type ManualBookSourceRow = {
  source_id: string;
  owner_id: string;
  book_id: string;
  source_version: 1;
  source_type: "manual_opening_package";
  opening_idea: string | null;
  opening_package: unknown;
  input_hash: string;
  created_at: Date | string;
};

type ManualBookChapterDirectoryRow = {
  directory_id: string;
  owner_id: string;
  book_id: string;
  directory_version: 1;
  entry_count: 0;
  created_at: Date | string;
  updated_at: Date | string;
};

type BookProfileVersionRow = {
  profile_version_id: string;
  owner_id: string;
  book_id: string;
  version: number;
  profile: unknown;
  created_at: Date | string;
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

  public async insertManualOpeningSource(
    client: PgClient,
    input: {
      readonly sourceId: string;
      readonly ownerId: string;
      readonly bookId: string;
      readonly openingIdea: string | null;
      readonly openingPackage: unknown;
      readonly inputHash: string;
    }
  ): Promise<ManualBookSourceRecord> {
    const result = await client.query<ManualBookSourceRow>(
      `INSERT INTO manual_book_opening_sources
         (source_id, owner_id, book_id, source_version, source_type, opening_idea, opening_package, input_hash)
       VALUES ($1, $2, $3, 1, 'manual_opening_package', $4, $5, $6)
       RETURNING ${manualSourceColumns()}`,
      [input.sourceId, input.ownerId, input.bookId, input.openingIdea, input.openingPackage, input.inputHash]
    );
    return mapManualSource(result.rows[0]!);
  }

  public async insertManualChapterDirectory(
    client: PgClient,
    input: {
      readonly directoryId: string;
      readonly ownerId: string;
      readonly bookId: string;
    }
  ): Promise<ManualBookChapterDirectoryRecord> {
    const result = await client.query<ManualBookChapterDirectoryRow>(
      `INSERT INTO manual_book_chapter_directories
         (directory_id, owner_id, book_id, directory_version, entry_count)
       VALUES ($1, $2, $3, 1, 0)
       RETURNING ${manualDirectoryColumns()}`,
      [input.directoryId, input.ownerId, input.bookId]
    );
    return mapManualDirectory(result.rows[0]!);
  }

  public async findByOwnerAndBookId(client: PgClient, ownerId: string, bookId: string, lock = false): Promise<BookRecord | null> {
    const result = await client.query<BookRow>(
      `SELECT ${bookColumns()} FROM bookshelf_books WHERE owner_id = $1 AND book_id = $2${lock ? " FOR UPDATE" : ""}`,
      [ownerId, bookId]
    );
    return result.rows[0] === undefined ? null : mapBook(result.rows[0]);
  }

  public async findManualOpeningSource(client: PgClient, ownerId: string, bookId: string): Promise<ManualBookSourceRecord | null> {
    const result = await client.query<ManualBookSourceRow>(
      `SELECT ${manualSourceColumns()} FROM manual_book_opening_sources
       WHERE owner_id = $1 AND book_id = $2 AND source_type = 'manual_opening_package'`,
      [ownerId, bookId]
    );
    return result.rows[0] === undefined ? null : mapManualSource(result.rows[0]);
  }

  public async findManualChapterDirectory(client: PgClient, ownerId: string, bookId: string): Promise<ManualBookChapterDirectoryRecord | null> {
    const result = await client.query<ManualBookChapterDirectoryRow>(
      `SELECT ${manualDirectoryColumns()} FROM manual_book_chapter_directories WHERE owner_id = $1 AND book_id = $2`,
      [ownerId, bookId]
    );
    return result.rows[0] === undefined ? null : mapManualDirectory(result.rows[0]);
  }

  public async findLatestBookProfileVersion(client: PgClient, ownerId: string, bookId: string): Promise<{ readonly version: number; readonly profile: unknown } | null> {
    const result = await client.query<BookProfileVersionRow>(
      `SELECT ${profileVersionColumns()} FROM book_profile_versions
       WHERE owner_id = $1 AND book_id = $2
       ORDER BY version DESC
       LIMIT 1`,
      [ownerId, bookId]
    );
    const row = result.rows[0];
    return row === undefined ? null : { version: Number(row.version), profile: row.profile };
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

  public async updateBookTitle(client: PgClient, ownerId: string, bookId: string, title: string): Promise<BookRecord> {
    const result = await client.query<BookRow>(
      `UPDATE bookshelf_books
       SET title = $3, version = version + 1, updated_at = clock_timestamp()
       WHERE owner_id = $1 AND book_id = $2
       RETURNING ${bookColumns()}`,
      [ownerId, bookId, title]
    );
    return mapBook(result.rows[0]!);
  }

  public async insertBookProfileVersion(
    client: PgClient,
    input: {
      readonly profileVersionId: string;
      readonly ownerId: string;
      readonly bookId: string;
      readonly version: number;
      readonly profile: unknown;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO book_profile_versions (profile_version_id, owner_id, book_id, version, profile)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.profileVersionId, input.ownerId, input.bookId, input.version, input.profile]
    );
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

function manualSourceColumns(alias?: string): string {
  const prefix = alias === undefined ? "" : `${alias}.`;
  return [
    "source_id",
    "owner_id",
    "book_id",
    "source_version",
    "source_type",
    "opening_idea",
    "opening_package",
    "input_hash",
    "created_at"
  ].map((column) => `${prefix}${column}`).join(", ");
}

function manualDirectoryColumns(alias?: string): string {
  const prefix = alias === undefined ? "" : `${alias}.`;
  return [
    "directory_id",
    "owner_id",
    "book_id",
    "directory_version",
    "entry_count",
    "created_at",
    "updated_at"
  ].map((column) => `${prefix}${column}`).join(", ");
}

function profileVersionColumns(alias?: string): string {
  const prefix = alias === undefined ? "" : `${alias}.`;
  return [
    "profile_version_id",
    "owner_id",
    "book_id",
    "version",
    "profile",
    "created_at"
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

function mapManualSource(row: ManualBookSourceRow): ManualBookSourceRecord {
  return {
    sourceId: row.source_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    sourceVersion: Number(row.source_version) as 1,
    sourceType: row.source_type,
    openingIdea: row.opening_idea,
    openingPackage: row.opening_package,
    inputHash: row.input_hash,
    createdAt: toDate(row.created_at)
  };
}

function mapManualDirectory(row: ManualBookChapterDirectoryRow): ManualBookChapterDirectoryRecord {
  return {
    directoryId: row.directory_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    directoryVersion: Number(row.directory_version) as 1,
    entryCount: Number(row.entry_count) as 0,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at)
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
