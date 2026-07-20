import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { PromotionService } from '../../infrastructure/recovery/promotion-service.js';
import { OwnerManuscriptRepository } from '../../infrastructure/db/repositories/owner-manuscript-repository.js';
import { ChapterCatalogService } from '../chapters/chapter-catalog-service.js';
import { TaskService } from '../tasks/task-service.js';

export interface OwnerDraftResult {
  manuscriptVersionId: string;
  parentVersionId: string | null;
  contentHash: string;
  wordCount: number;
  status: 'candidate';
  unchanged: boolean;
}

export class OwnerManuscriptService {
  private readonly repository: OwnerManuscriptRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new OwnerManuscriptRepository(database);
  }

  public saveDraft(scope: BookScope, input: {
    chapterId: string; baseManuscriptVersionId: string | null; content: string; note?: string | null;
  }): OwnerDraftResult {
    assertBookScope(scope);
    if (typeof input.content !== 'string' || input.content.trim().length === 0) throw new DomainError(errorCodes.validation, '正文不能为空');
    if (input.content.length > 100_000) throw new DomainError(errorCodes.validation, '单章正文超过100,000字符，请拆分章节');
    const chapter = this.repository.chapter(scope, input.chapterId);
    if (chapter === undefined) throw new DomainError(errorCodes.bookScopeViolation, '章节不存在或越权', {}, false, 404);
    if (chapter.settlement_status === 'settled') throw new DomainError(errorCodes.operationIncomplete, '正史已结算正文只读；修订必须创建正式修订任务', {}, false, 409);
    if (chapter.current_manuscript_version_id !== input.baseManuscriptVersionId) throw new DomainError(errorCodes.operationIncomplete, '正文基线已经变化，请重新载入后再保存', {}, true, 409);
    if (this.repository.hasUnsafeTask(scope, input.chapterId)) {
      throw new DomainError(errorCodes.taskAlreadyRunning, '本章正在处理任务，请等待、取消或恢复任务后再编辑', {}, false, 409);
    }
    const promotion = new PromotionService(this.database, this.dataDir, this.clock);
    const staged = promotion.stageText(`owner-edit-${input.chapterId}`, input.content);
    const existing = this.repository.manuscriptByHash(scope, input.chapterId, staged.contentHash);
    if (existing !== undefined) {
      if (existing.manuscript_version_id !== chapter.current_manuscript_version_id) {
        throw new DomainError(errorCodes.operationIncomplete, '相同正文已经存在于历史版本，请从版本记录中选择或继续修改', {}, false, 409);
      }
      return {
        manuscriptVersionId: existing.manuscript_version_id, parentVersionId: existing.parent_version_id,
        contentHash: staged.contentHash, wordCount: existing.word_count, status: 'candidate', unchanged: true
      };
    }
    const stewardAgentId = this.repository.leadWriterAgentId(scope);
    if (stewardAgentId === null) throw new DomainError(errorCodes.agentCapabilityUnavailable, '本书缺少可登记正文版本的主笔岗位', {}, false, 409);
    const taskId = this.ids.next();
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    tasks.create(scope, {
      taskId, taskType: 'owner_manuscript_edit', assignedAgentId: null, chapterId: input.chapterId,
      idempotencyKey: `owner-edit:${input.chapterId}:${staged.contentHash}`, initialPhase: 'persist',
      brief: { chapterId: input.chapterId, baseManuscriptVersionId: input.baseManuscriptVersionId, contentHash: staged.contentHash }
    });
    const manuscriptVersionId = this.ids.next();
    const fileId = this.ids.next();
    try {
      promotion.promote(scope, {
        ...staged, operationId: this.ids.next(), fileId, chapterId: input.chapterId, versionId: manuscriptVersionId
      });
      this.repository.runInTransaction(() => {
        new ChapterCatalogService(this.database, this.ids, this.clock).registerManuscript(scope, {
          manuscriptVersionId, chapterId: input.chapterId, parentVersionId: input.baseManuscriptVersionId,
          authorAgentId: stewardAgentId, modelProvider: 'manual', modelId: 'owner-edit', sourceTaskId: taskId,
          fileId, contentHash: staged.contentHash, wordCount: countCharacters(input.content), status: 'candidate',
          creatorKind: 'owner', editNote: input.note?.trim() || null, expectedCurrentVersionId: input.baseManuscriptVersionId
        });
        const now = this.clock.now().toISOString();
        for (const gate of this.repository.awaitingGates(scope, input.chapterId)) this.repository.supersedeGate(scope, gate, now);
        this.repository.markChapterUnsettled(scope, input.chapterId, now);
        tasks.completeSynchronous(scope, taskId, 'persisted');
      });
    } catch (error) {
      const now = this.clock.now().toISOString();
      this.repository.failOwnerEditTask(scope, taskId, now);
      this.repository.archiveFile(scope, fileId, now);
      throw error;
    }
    return {
      manuscriptVersionId, parentVersionId: input.baseManuscriptVersionId, contentHash: staged.contentHash,
      wordCount: countCharacters(input.content), status: 'candidate', unchanged: false
    };
  }
}

function countCharacters(content: string): number {
  return [...content].filter((character) => !/\s/u.test(character)).length;
}
