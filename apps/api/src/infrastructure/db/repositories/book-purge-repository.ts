import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

interface TableNameRow {
  readonly name: string;
}

interface TableColumnRow {
  readonly name: string;
}

export interface BookPurgeRecord {
  readonly bookTitle: string;
  readonly operationId: string;
  readonly tombstoneId: string;
  readonly confirmationHash: string;
  readonly deletedAt: string;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export class BookPurgeRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public hasTombstone(scope: BookScope): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT 1 FROM deletion_tombstones WHERE owner_id = ? AND deleted_book_id = ?
    `).get(scope.ownerId, scope.bookId) !== undefined;
  }

  public listRegisteredPaths(scope: BookScope): string[] {
    assertBookScope(scope);
    const rows = this.database.prepare(`
      SELECT relative_path FROM file_registry WHERE owner_id = ? AND book_id = ?
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ relative_path: string }>;
    return rows.map((row) => row.relative_path);
  }

  public permanentlyDelete(scope: BookScope, record: BookPurgeRecord): void {
    assertBookScope(scope);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('PRAGMA defer_foreign_keys = ON');
      this.database.prepare(`
        INSERT INTO deletion_tombstones (
          tombstone_id, owner_id, deleted_book_id, deleted_book_title,
          deletion_operation_id, confirmation_text_hash, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.tombstoneId,
        scope.ownerId,
        scope.bookId,
        record.bookTitle,
        record.operationId,
        record.confirmationHash,
        record.deletedAt
      );
      this.#deletePortableRows(scope);
      this.database.prepare(`
        DELETE FROM quarantine_items WHERE owner_id = ? AND intended_book_id = ?
      `).run(scope.ownerId, scope.bookId);
      this.database.prepare(`
        DELETE FROM positioning_drafts
        WHERE owner_id = ? AND (proposed_book_id = ? OR confirmed_book_id = ?)
      `).run(scope.ownerId, scope.bookId, scope.bookId);
      this.database.prepare(`
        DELETE FROM model_call_prompt_snapshots
        WHERE request_id IN (
          SELECT request_id FROM model_calls WHERE owner_id = ? AND book_id = ?
        )
      `).run(scope.ownerId, scope.bookId);
      this.#deleteScopedRows(scope);
      this.database.prepare('DELETE FROM books WHERE owner_id = ? AND book_id = ?')
        .run(scope.ownerId, scope.bookId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  #deletePortableRows(scope: BookScope): void {
    const operationScope = `
      owner_id = ? AND (
        book_id = ? OR source_book_id = ? OR target_book_id = ?
      )
    `;
    const operationParameters = [scope.ownerId, scope.bookId, scope.bookId, scope.bookId];

    this.database.prepare(`
      DELETE FROM portable_files
      WHERE portable_manifest_id IN (
        SELECT manifest.portable_manifest_id
        FROM portable_manifests AS manifest
        LEFT JOIN portable_operations AS operation
          ON operation.portable_operation_id = manifest.portable_operation_id
        WHERE manifest.owner_id = ? AND (
          manifest.book_id = ? OR (
            operation.owner_id = ? AND (
              operation.book_id = ? OR operation.source_book_id = ? OR operation.target_book_id = ?
            )
          )
        )
      )
    `).run(scope.ownerId, scope.bookId, scope.ownerId, scope.bookId, scope.bookId, scope.bookId);

    this.database.prepare(`
      DELETE FROM import_quarantine_checks
      WHERE portable_operation_id IN (
        SELECT portable_operation_id FROM portable_operations WHERE ${operationScope}
      )
    `).run(...operationParameters);

    this.database.prepare(`
      DELETE FROM restore_impact_reports
      WHERE target_book_id = ? OR portable_operation_id IN (
        SELECT portable_operation_id FROM portable_operations WHERE ${operationScope}
      )
    `).run(scope.bookId, ...operationParameters);

    this.database.prepare(`
      DELETE FROM portable_manifests
      WHERE owner_id = ? AND (
        book_id = ? OR portable_operation_id IN (
          SELECT portable_operation_id FROM portable_operations WHERE ${operationScope}
        )
      )
    `).run(scope.ownerId, scope.bookId, ...operationParameters);

    this.database.prepare(`DELETE FROM portable_operations WHERE ${operationScope}`).run(...operationParameters);
  }

  #deleteScopedRows(scope: BookScope): void {
    const tables = this.database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as unknown as TableNameRow[];

    for (const table of tables) {
      if (table.name === 'books') continue;
      const identifier = quoteIdentifier(table.name);
      const columns = this.database.prepare(`PRAGMA table_info(${identifier})`).all() as unknown as TableColumnRow[];
      const names = new Set(columns.map((column) => column.name));
      if (!names.has('owner_id') || !names.has('book_id')) continue;
      this.database.prepare(`DELETE FROM ${identifier} WHERE owner_id = ? AND book_id = ?`)
        .run(scope.ownerId, scope.bookId);
    }
  }
}
