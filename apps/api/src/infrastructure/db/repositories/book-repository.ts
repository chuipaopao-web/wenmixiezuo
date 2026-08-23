import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../../domain/errors.js';
import type { BookRecord, BookStatus } from '../../../domain/books.js';
import { assertBookScope, assertOwnerScope, type BookScope, type OwnerScope } from '../../../domain/scope.js';

interface BookRow {
  book_id: string;
  owner_id: string;
  title: string;
  status: BookStatus;
  version: number;
  positioning_version: number;
  canon_revision: number;
  editor_epoch: number;
  created_at: string;
  updated_at: string;
}

function mapBook(row: BookRow): BookRecord {
  return {
    bookId: row.book_id,
    ownerId: row.owner_id,
    title: row.title,
    status: row.status,
    version: row.version,
    positioningVersion: row.positioning_version,
    canonRevision: row.canon_revision,
    editorEpoch: row.editor_epoch,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizedBookTitleKey(title: string): string {
  return title.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-CN');
}

export class BookRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(scope: BookScope, title: string, now: string, status: BookStatus = 'draft'): BookRecord {
    assertBookScope(scope);
    return this.#runImmediate(() => {
      this.#assertTitleAvailable(scope.ownerId, title);
      this.database.prepare(`
        INSERT INTO books (
          book_id, owner_id, title, status, version, positioning_version, canon_revision,
          editor_epoch, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, 0, 0, ?, ?)
      `).run(scope.bookId, scope.ownerId, title, status, now, now);
      return this.require(scope);
    });
  }

  public find(scope: BookScope): BookRecord | null {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT book_id, owner_id, title, status, version, positioning_version,
             canon_revision, editor_epoch, created_at, updated_at
      FROM books WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as BookRow | undefined;
    return row === undefined ? null : mapBook(row);
  }

  public require(scope: BookScope): BookRecord {
    const book = this.find(scope);
    if (book === null) {
      throw new DomainError(errorCodes.bookNotFound, '书籍不存在', {}, false, 404);
    }
    return book;
  }

  public list(scope: OwnerScope, includePurged = false): BookRecord[] {
    assertOwnerScope(scope);
    const rows = this.database.prepare(`
      SELECT book_id, owner_id, title, status, version, positioning_version,
             canon_revision, editor_epoch, created_at, updated_at
      FROM books
      WHERE owner_id = ? AND (? = 1 OR status <> 'purged')
      ORDER BY updated_at DESC, book_id
    `).all(scope.ownerId, includePurged ? 1 : 0) as unknown as BookRow[];
    return rows.map(mapBook);
  }

  public changeStatus(scope: BookScope, expectedVersion: number, status: BookStatus, now: string): BookRecord {
    assertBookScope(scope);
    const archivedAt = status === 'archived' ? now : null;
    const result = this.database.prepare(`
      UPDATE books SET status = ?, version = version + 1, updated_at = ?, archived_at = ?
      WHERE owner_id = ? AND book_id = ? AND version = ?
    `).run(status, now, archivedAt, scope.ownerId, scope.bookId, expectedVersion);
    if (result.changes !== 1) {
      if (this.find(scope) === null) throw new DomainError(errorCodes.bookNotFound, '书籍不存在', {}, false, 404);
      throw new DomainError(errorCodes.bookVersionConflict, '书籍版本已经变化', { expectedVersion }, false, 409);
    }
    return this.require(scope);
  }

  public updateTitle(scope: BookScope, expectedVersion: number, title: string, now: string): BookRecord {
    assertBookScope(scope);
    return this.#runImmediate(() => {
      const current = this.require(scope);
      if (normalizedBookTitleKey(current.title) !== normalizedBookTitleKey(title)) {
        this.#assertTitleAvailable(scope.ownerId, title, scope.bookId);
      }
      const result = this.database.prepare(`
        UPDATE books SET title = ?, version = version + 1, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND version = ?
      `).run(title, now, scope.ownerId, scope.bookId, expectedVersion);
      if (result.changes !== 1) {
        throw new DomainError(errorCodes.bookVersionConflict, '书籍版本已经变化', { expectedVersion }, false, 409);
      }
      return this.require(scope);
    });
  }

  #assertTitleAvailable(ownerId: string, title: string, excludedBookId?: string): void {
    const requestedKey = normalizedBookTitleKey(title);
    const rows = this.database.prepare(`
      SELECT book_id, title FROM books
      WHERE owner_id = ? AND status <> 'purged' AND (? IS NULL OR book_id <> ?)
    `).all(ownerId, excludedBookId ?? null, excludedBookId ?? null) as unknown as Array<{ book_id: string; title: string }>;
    if (rows.some((row) => normalizedBookTitleKey(row.title) === requestedKey)) {
      throw new DomainError(
        errorCodes.bookTitleConflict,
        '你已有一本同名书籍（包括归档书），请换一个书名。',
        {},
        false,
        409
      );
    }
  }

  #runImmediate<T>(work: () => T): T {
    if (this.database.isTransaction) return work();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
