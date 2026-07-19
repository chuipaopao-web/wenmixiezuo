import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { validatePermanentDeleteText } from '../../domain/permanent-delete.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { BookRecord } from '../../domain/books.js';
import { assertBookScope, type BookScope, type OwnerScope } from '../../domain/scope.js';
import { BookRepository } from '../../infrastructure/db/repositories/book-repository.js';
import { OwnerRepository } from '../../infrastructure/db/repositories/owner-repository.js';
import { BookPurgeRepository } from '../../infrastructure/db/repositories/book-purge-repository.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';

export class BookLifecycleService {
  readonly #books: BookRepository;
  readonly #owners: OwnerRepository;
  readonly #purge: BookPurgeRepository;

  public constructor(
    database: DatabaseSync,
    private readonly dataDir: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.#books = new BookRepository(database);
    this.#owners = new OwnerRepository(database);
    this.#purge = new BookPurgeRepository(database);
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
    if (this.#purge.hasTombstone(scope)) throw new Error('删除墓碑禁止旧书籍ID复活');
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
    if (book.status !== 'archived') {
      throw new DomainError(errorCodes.bookStatusConflict, '只有已归档书籍可以永久删除', { currentStatus: book.status }, false, 409);
    }
    const confirmationHash = validatePermanentDeleteText(confirmationText);
    const operationId = this.ids.next();
    const tombstoneId = this.ids.next();
    const now = this.clock.now().toISOString();
    const paths = this.#purge.listRegisteredPaths(scope);
    this.#purge.permanentlyDelete(scope, {
      bookTitle: book.title,
      operationId,
      tombstoneId,
      confirmationHash,
      deletedAt: now
    });

    for (const path of paths) {
      rmSync(resolveInside(this.dataDir, path), { force: true });
    }
    rmSync(resolveInside(this.dataDir, `books/${scope.bookId}`), { force: true, recursive: true });
  }
}
