import { readFileSync } from 'node:fs';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';
import type { ProductionWorkflowRepository } from '../../infrastructure/db/repositories/production-workflow-repository.js';
import { ChapterCatalogService } from '../chapters/chapter-catalog-service.js';
import { CanonService } from '../knowledge/canon-service.js';
import { TaskService } from '../tasks/task-service.js';

export class ChapterApprovalService {
  public constructor(
    private readonly repository: ProductionWorkflowRepository,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly chapters: ChapterCatalogService,
    private readonly canon: CanonService,
    private readonly tasks: TaskService
  ) {}

  public resolve(scope: BookScope, confirmationId: string, expectedCanonRevision: number, accept: boolean, note: string | null = null): {
    status: 'settled' | 'rejected'; canonRevision?: number;
  } {
    const gate = this.repository.requireGate(scope, confirmationId);
    const retrySettlement = (gate.status === 'accepted' || gate.status === 'settlement_failed') && accept;
    if (gate.status !== 'awaiting_owner' && !retrySettlement) throw new Error('正文确认单已经处理');
    if (gate.expectedCanonRevision !== expectedCanonRevision) throw new Error('正文确认单绑定的正史版本不匹配');
    if (!accept) {
      this.repository.prepareOwnerRejectedRewrite(scope, gate, note ?? '当前正文未获老板确认，需要按意见定点重写', this.ids.next(), this.clock.now().toISOString());
      return { status: 'rejected' };
    }
    if (!retrySettlement) this.repository.resolveGate(scope, confirmationId, true, note, this.clock.now().toISOString());
    try {
      const reference = this.repository.manuscriptReference(scope, gate.manuscriptVersionId);
      const chapter = this.repository.chapter(scope, gate.chapterId);
      const content = readFileSync(resolveInside(this.dataDir, reference.relativePath), 'utf8');
      this.chapters.selectManuscript(scope, gate.chapterId, gate.manuscriptVersionId);
      const canonicalName = `第${chapter.chapterNumber}章已发生事件`;
      const entityId = this.repository.findChapterEventEntity(scope, canonicalName) ?? this.canon.createEntity(scope, { entityType: 'event', canonicalName });
      if (!this.repository.hasChapterFact(scope, gate.chapterId, gate.manuscriptVersionId)) {
        this.canon.proposeFact(scope, {
          subjectEntityId: entityId,
          relationKey: 'event',
          value: { chapterNumber: chapter.chapterNumber, endingExcerpt: endingExcerpt(content), source: 'owner_confirmed_manuscript' },
          evidence: [{ manuscriptVersionId: gate.manuscriptVersionId, location: '全文及章末' }],
          grade: 'B',
          sourceChapterId: gate.chapterId,
          sourceManuscriptVersionId: gate.manuscriptVersionId,
          storyTimeStart: `第${chapter.chapterNumber}章`
        });
      }
      const result = this.canon.settleChapter(scope, gate.chapterId, gate.manuscriptVersionId, {
        chapterNumber: chapter.chapterNumber,
        manuscriptVersionId: gate.manuscriptVersionId,
        endingExcerpt: endingExcerpt(content),
        source: 'owner_confirmed_manuscript'
      });
      this.repository.recordQualityMetric(scope, {
        id: this.ids.next(), chapterId: gate.chapterId, manuscriptVersionId: gate.manuscriptVersionId,
        rewriteCount: this.repository.rewriteCount(scope, gate.chapterId, gate.taskId), now: this.clock.now().toISOString()
      });
      this.repository.markGateSettlement(scope, confirmationId, true, this.clock.now().toISOString());
      this.tasks.resolveWaitingConfirmation(scope, gate.taskId, true);
      return { status: 'settled', canonRevision: result.canonRevision };
    } catch (error) {
      this.repository.markGateSettlement(scope, confirmationId, false, this.clock.now().toISOString());
      throw error;
    }
  }
}

function endingExcerpt(content: string): string {
  const normalized = content.trim();
  if (normalized.length === 0) throw new Error('正文为空，不能结算');
  return normalized.slice(-600);
}
