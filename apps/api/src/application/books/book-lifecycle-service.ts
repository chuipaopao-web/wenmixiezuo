import { BOOK_TITLE_MAX_CHARACTERS, bookTitleCharacterCount } from '@wenmi/contracts';
import { rmSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  validatePermanentDeleteSecondText,
  validatePermanentDeleteText
} from '../../domain/permanent-delete.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { BookRecord } from '../../domain/books.js';
import { assertBookScope, type BookScope, type OwnerScope } from '../../domain/scope.js';
import { BookRepository } from '../../infrastructure/db/repositories/book-repository.js';
import { OwnerRepository } from '../../infrastructure/db/repositories/owner-repository.js';
import {
  BookPurgeRepository,
  type ActiveWorkEntry
} from '../../infrastructure/db/repositories/book-purge-repository.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';

export interface BookDeletePreview {
  readonly book: {
    readonly bookId: string;
    readonly title: string;
    readonly version: number;
    readonly status: string;
  };
  /**  false 时前端禁止确认并说明原因（仍有在途任务/调用）。 */
  readonly canDelete: boolean;
  readonly activeWork: readonly ActiveWorkEntry[];
  readonly impact: {
    /** 将删除的关联数据行总数（不含账务归档与墓碑）。 */
    readonly relatedRows: number;
    /** 关联任务：旧任务系统 + 时光机设计轮 + 开书任务。 */
    readonly taskCount: number;
    /** 时光机核心状态行数（steps/candidates/reviews/materials 等）。 */
    readonly timeMachineRows: number;
    readonly fileCount: number;
    readonly fileBytes: number;
    /** 删除后仍在账务归档中保留的用量记录数（账号用量投影不变）。 */
    readonly usageRecordsPreserved: number;
  };
  /** 与删除确认绑定的预览指纹；预览后数据变化会使其失效。 */
  readonly previewId: string;
  readonly generatedAt: string;
}

export interface PermanentDeleteInput {
  readonly expectedVersion: number;
  readonly confirmationText: string;
  readonly secondConfirmationText: string;
  readonly previewId: string;
}

export interface PermanentDeleteResult {
  readonly deleted: true;
  readonly alreadyDeleted: boolean;
  readonly filesRemoved: number;
  /** 删除未成功的残留文件路径；重复请求会继续清理。 */
  readonly filesFailed: readonly string[];
}

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
    if (normalizedTitle.length < 1 || bookTitleCharacterCount(normalizedTitle) > BOOK_TITLE_MAX_CHARACTERS) {
      throw new Error('书名长度必须为1至15字');
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

  /** 归档书删除预览：真实行数/文件/账务保留与在途门禁，跨用户与跨书 404。 */
  public deletePreview(scope: BookScope): BookDeletePreview {
    assertBookScope(scope);
    const book = this.#books.require(scope);
    if (book.status !== 'archived') {
      throw new DomainError(
        errorCodes.bookStatusConflict,
        '只有已归档书籍可以查看永久删除预览',
        { currentStatus: book.status },
        false,
        409
      );
    }
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const activeWork = this.#purge.activeWork(scope, nowIso, now.getTime());
    const plan = this.#purge.planPurge(scope, book.version);
    const taskCount = (plan.scoped['tasks']?.length ?? 0)
      + (plan.scoped['tm2_design_runs']?.length ?? 0)
      + plan.openingTaskIds.length;
    const timeMachineRows = Object.values(plan.tm2).reduce((sum, rows) => sum + rows.length, 0);
    return {
      book: { bookId: book.bookId, title: book.title, version: book.version, status: book.status },
      canDelete: activeWork.length === 0,
      activeWork,
      impact: {
        relatedRows: plan.totalRows,
        taskCount,
        timeMachineRows,
        fileCount: plan.filePaths.length,
        fileBytes: plan.fileBytes,
        usageRecordsPreserved: plan.usageRecords + plan.openingCallIds.length
      },
      previewId: this.#purge.purgePlanHash(plan),
      generatedAt: nowIso
    };
  }

  /**
   * 永久删除：归档门禁 → 版本绑定 → 在途门禁 → YES+二次确认 → 预览指纹绑定，
   * 事务内删除并归档账务；文件在数据库提交后删除，失败可重复请求续清。
   */
  public permanentlyDelete(scope: BookScope, input: PermanentDeleteInput): PermanentDeleteResult {
    assertBookScope(scope);
    const book = this.#books.find(scope);
    if (book === null && this.#purge.hasTombstone(scope)) {
      // 幂等重放：已成功删除后的重复请求不报错，继续补齐残留文件清理。
      validatePermanentDeleteText(input.confirmationText);
      validatePermanentDeleteSecondText(input.secondConfirmationText);
      const files = this.#removeBookFiles(scope, this.#purge.listRegisteredPaths(scope));
      return { deleted: true, alreadyDeleted: true, ...files };
    }
    if (book === null) {
      this.#books.require(scope);
      throw new Error('不可达：书籍存在性检查已抛出');
    }
    if (book.status !== 'archived') {
      throw new DomainError(errorCodes.bookStatusConflict, '只有已归档书籍可以永久删除', { currentStatus: book.status }, false, 409);
    }
    if (book.version !== input.expectedVersion) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '书籍版本已经变化，请刷新后重新预览再确认删除',
        { currentVersion: book.version },
        false,
        409
      );
    }
    const deleteNow = this.clock.now();
    const activeWork = this.#purge.activeWork(scope, deleteNow.toISOString(), deleteNow.getTime());
    if (activeWork.length > 0) {
      throw new DomainError(
        errorCodes.bookHasActiveWork,
        '这本书还有正在进行的任务或尚未确认的调用，请等待它们结束后再删除',
        { activeWork },
        false,
        409
      );
    }
    const confirmationHash = validatePermanentDeleteText(input.confirmationText);
    validatePermanentDeleteSecondText(input.secondConfirmationText);
    const paths = this.#purge.listRegisteredPaths(scope);
    this.#purge.permanentlyDelete(scope, {
      bookTitle: book.title,
      operationId: this.ids.next(),
      tombstoneId: this.ids.next(),
      confirmationHash,
      deletedAt: this.clock.now().toISOString()
    }, undefined, input.previewId, book.version);
    const files = this.#removeBookFiles(scope, paths);
    return { deleted: true, alreadyDeleted: false, ...files };
  }

  /** 文件在数据库提交后删除；单个文件失败不推翻已提交的数据库删除，残留可重试。 */
  #removeBookFiles(scope: BookScope, registeredPaths: readonly string[]): { filesRemoved: number; filesFailed: string[] } {
    let filesRemoved = 0;
    const filesFailed: string[] = [];
    for (const path of registeredPaths) {
      try {
        rmSync(resolveInside(this.dataDir, path), { force: true });
        filesRemoved += 1;
      } catch {
        filesFailed.push(path);
      }
    }
    try {
      rmSync(resolveInside(this.dataDir, `books/${scope.bookId}`), { force: true, recursive: true });
    } catch {
      filesFailed.push(`books/${scope.bookId}`);
    }
    return { filesRemoved, filesFailed };
  }
}
