import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { validatePermanentDeleteText } from '../../domain/permanent-delete.js';
import type { BookRecord } from '../../domain/books.js';
import { assertBookScope, type BookScope, type OwnerScope } from '../../domain/scope.js';
import { BookRepository } from '../../infrastructure/db/repositories/book-repository.js';
import { OwnerRepository } from '../../infrastructure/db/repositories/owner-repository.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';

export class BookLifecycleService {
  readonly #books: BookRepository;
  readonly #owners: OwnerRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.#books = new BookRepository(database);
    this.#owners = new OwnerRepository(database);
  }

  public ensureOwner(scope: OwnerScope, displayName = '老板'): void {
    this.#owners.ensure(scope, displayName, this.clock.now().toISOString());
  }

  public createDraft(scope: BookScope, title: string): BookRecord {
    assertBookScope(scope);
    const normalizedTitle = title.trim();
    if (normalizedTitle.length < 1 || normalizedTitle.length > 120) {
      throw new Error('书名长度必须为1至120个字符');
    }
    const tombstone = this.database.prepare(`
      SELECT 1 FROM deletion_tombstones WHERE owner_id = ? AND deleted_book_id = ?
    `).get(scope.ownerId, scope.bookId);
    if (tombstone !== undefined) throw new Error('删除墓碑禁止旧书籍ID复活');
    return this.#books.create(scope, normalizedTitle, this.clock.now().toISOString(), 'draft');
  }

  public archive(scope: BookScope, expectedVersion: number): BookRecord {
    return this.#books.changeStatus(scope, expectedVersion, 'archived', this.clock.now().toISOString());
  }

  public restoreFromArchive(scope: BookScope, expectedVersion: number): BookRecord {
    const book = this.#books.require(scope);
    if (book.status !== 'archived') throw new Error('只有已归档书籍可以恢复');
    return this.#books.changeStatus(scope, expectedVersion, 'active', this.clock.now().toISOString());
  }

  public permanentlyDelete(scope: BookScope, confirmationText: string): void {
    assertBookScope(scope);
    const book = this.#books.require(scope);
    const confirmationHash = validatePermanentDeleteText(book.title, book.bookId, confirmationText);
    const operationId = this.ids.next();
    const tombstoneId = this.ids.next();
    const now = this.clock.now().toISOString();
    const rows = this.database.prepare('SELECT relative_path FROM file_registry WHERE owner_id = ? AND book_id = ?')
      .all(scope.ownerId, scope.bookId) as unknown as Array<{ relative_path: string }>;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO deletion_tombstones (
          tombstone_id, owner_id, deleted_book_id, deleted_book_title,
          deletion_operation_id, confirmation_text_hash, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(tombstoneId, scope.ownerId, scope.bookId, book.title, operationId, confirmationHash, now);
      this.database.prepare('DELETE FROM file_registry WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
      this.database.prepare('DELETE FROM recovery_log WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
      this.database.prepare('DELETE FROM operations WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
      this.database.prepare('DELETE FROM books WHERE owner_id = ? AND book_id = ?').run(scope.ownerId, scope.bookId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    for (const row of rows) {
      rmSync(resolveInside(this.dataDir, row.relative_path), { force: true });
    }
    rmSync(resolveInside(this.dataDir, `books/${scope.bookId}`), { force: true, recursive: true });
  }
}
