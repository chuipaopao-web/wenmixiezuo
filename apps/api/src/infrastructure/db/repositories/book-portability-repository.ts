import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export interface PortableManifestFileRecord {
  portableFileId: string;
  sourceFileId: string;
  relativePath: string;
  contentHash: string;
  byteCount: number;
  mediaType: string;
}

export class BookPortabilityRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public bookTitle(scope: BookScope): string | null {
    const row = this.database.prepare(`SELECT title FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { title: string } | undefined;
    return row?.title ?? null;
  }

  public bookScopedTables(excluded: ReadonlySet<string>): string[] {
    const tables = this.database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as unknown as Array<{ name: string }>;
    return tables.map((row) => row.name).filter((table) => {
      if (excluded.has(table)) return false;
      const columns = this.columns(table).map((column) => column.name);
      return columns.includes('owner_id') && columns.includes('book_id');
    });
  }

  public columns(table: string): Array<{ name: string; pk: number }> {
    return this.database.prepare(`PRAGMA table_info(${identifier(table)})`).all() as unknown as Array<{ name: string; pk: number }>;
  }

  public rows(scope: BookScope, table: string): Array<Record<string, unknown>> {
    return this.database.prepare(`SELECT * FROM ${identifier(table)} WHERE owner_id = ? AND book_id = ?`)
      .all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, unknown>>;
  }

  public schemaVersion(): number {
    return Number((this.database.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as { value: string }).value);
  }

  public insertOperation(input: {
    id: string; ownerId: string; bookId: string | null; type: string; status: string; packageName: string | null;
    sourceBookId: string | null; targetBookId: string | null; summary: unknown; now: string;
  }): void {
    this.database.prepare(`INSERT INTO portable_operations (
      portable_operation_id, owner_id, book_id, operation_type, status, package_name, source_book_id,
      target_book_id, summary_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.id, input.ownerId, input.bookId, input.type, input.status, input.packageName,
      input.sourceBookId, input.targetBookId, JSON.stringify(input.summary), input.now
    );
  }

  public completeExportOperation(operationId: string, packageName: string, summary: unknown, now: string): void {
    this.database.prepare(`UPDATE portable_operations SET status = 'completed', package_name = ?, summary_json = ?, completed_at = ?
      WHERE portable_operation_id = ?`).run(packageName, JSON.stringify(summary), now, operationId);
  }

  public failOperation(operationId: string, message: string, now: string): void {
    this.database.prepare(`UPDATE portable_operations SET status = 'failed', error_code = ?, summary_json = ?, completed_at = ?
      WHERE portable_operation_id = ?`).run('PORTABILITY_FAILED', JSON.stringify({ message: message.slice(0, 500) }), now, operationId);
  }

  public listOperations(ownerId: string): unknown[] {
    return this.database.prepare(`SELECT portable_operation_id AS operationId, book_id AS bookId, operation_type AS operationType,
      status, package_name AS packageName, source_book_id AS sourceBookId, target_book_id AS targetBookId,
      summary_json AS summaryJson, error_code AS errorCode, created_at AS createdAt, completed_at AS completedAt
      FROM portable_operations WHERE owner_id = ? ORDER BY created_at DESC, portable_operation_id DESC LIMIT 100`).all(ownerId);
  }

  public recordQuarantineCheck(input: { id: string; operationId: string; key: string; passed: boolean; details: unknown; now: string }): void {
    this.database.prepare(`INSERT INTO import_quarantine_checks (
      import_quarantine_check_id, portable_operation_id, check_key, status, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`).run(
      input.id, input.operationId, input.key, input.passed ? 'passed' : 'failed', JSON.stringify(input.details), input.now
    );
  }

  public recordManifest(input: {
    manifestId: string; operationId: string; scope: BookScope; formatVersion: number; schemaVersion: number;
    hash: string; tableCount: number; rowCount: number; files: PortableManifestFileRecord[]; byteCount: number; now: string;
  }): void {
    this.database.prepare(`INSERT INTO portable_manifests (
      portable_manifest_id, portable_operation_id, owner_id, book_id, format_version, schema_version,
      manifest_hash, table_count, row_count, file_count, byte_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.manifestId, input.operationId, input.scope.ownerId, input.scope.bookId, input.formatVersion, input.schemaVersion,
      input.hash, input.tableCount, input.rowCount, input.files.length, input.byteCount, input.now
    );
    const insertFile = this.database.prepare(`INSERT INTO portable_files (
      portable_file_id, portable_manifest_id, source_file_id, relative_path, content_hash, byte_count, media_type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const file of input.files) insertFile.run(
      file.portableFileId, input.manifestId, file.sourceFileId, file.relativePath,
      file.contentHash, file.byteCount, file.mediaType, input.now
    );
  }

  public importRowsAtomically(input: {
    operationId: string; newBookId: string; sourceBookId: string; manifestHash: string;
    importedRows: number; importedFiles: number; tables: Record<string, Array<Record<string, unknown>>>; now: string;
  }): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('PRAGMA defer_foreign_keys = ON');
      const bookRows = input.tables.books ?? [];
      if (bookRows.length !== 1) throw new Error('导入包必须且只能包含一本书');
      this.insertRows('books', bookRows);
      for (const [table, rows] of Object.entries(input.tables)) {
        if (table === 'books' || rows.length === 0) continue;
        this.insertRows(table, rows);
      }
      this.database.prepare(`UPDATE portable_operations SET book_id = ?, source_book_id = ?, target_book_id = ?, status = 'completed',
        summary_json = ?, completed_at = ? WHERE portable_operation_id = ?`).run(
        input.newBookId, input.sourceBookId, input.newBookId,
        JSON.stringify({ manifestHash: input.manifestHash, importedRows: input.importedRows, importedFiles: input.importedFiles }),
        input.now, input.operationId
      );
      const violations = this.database.prepare(`PRAGMA foreign_key_check`).all() as unknown as Array<Record<string, unknown>>;
      if (violations.length > 0) throw new Error(`导入包外键闭环失败：${JSON.stringify(violations.slice(0, 10))}`);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private insertRows(table: string, rows: Array<Record<string, unknown>>): void {
    for (const row of rows) {
      const columns = Object.keys(row);
      const sql = `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
      this.database.prepare(sql).run(...columns.map((column) => sqlValue(row[column])));
    }
  }
}

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) throw new Error(`非法数据库标识符：${value}`);
  return `"${value}"`;
}

function sqlValue(value: unknown): string | number | bigint | Uint8Array | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value instanceof Uint8Array
    ? value
    : JSON.stringify(value);
}
