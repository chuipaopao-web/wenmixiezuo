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

export class BookRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(scope: BookScope, title: string, now: string, status: BookStatus = 'draft'): BookRecord {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO books (
        book_id, owner_id, title, status, version, positioning_version, canon_revision,
        editor_epoch, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 0, 0, 0, ?, ?)
    `).run(scope.bookId, scope.ownerId, title, status, now, now);
    return this.require(scope);
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
    const result = this.database.prepare(`
      UPDATE books SET title = ?, version = version + 1, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND version = ?
    `).run(title, now, scope.ownerId, scope.bookId, expectedVersion);
    if (result.changes !== 1) {
      if (this.find(scope) === null) throw new DomainError(errorCodes.bookNotFound, '书籍不存在', {}, false, 404);
      throw new DomainError(errorCodes.bookVersionConflict, '书籍版本已经变化', { expectedVersion }, false, 409);
    }
    return this.require(scope);
  }
}

