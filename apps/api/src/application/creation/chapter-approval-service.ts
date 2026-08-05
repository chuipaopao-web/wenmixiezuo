import { readFileSync } from 'node:fs';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';
import type { ProductionWorkflowRepository } from '../../infrastructure/db/repositories/production-workflow-repository.js';
import { ChapterCatalogService } from '../chapters/chapter-catalog-service.js';
import { CanonService } from '../knowledge/canon-service.js';
import { TaskService } from '../tasks/task-service.js';
import type { ProtagonistStateService } from '../knowledge/protagonist-state-service.js';
import { buildChapterContinuityAnchors } from './continuity-anchor-service.js';

export class ChapterApprovalService {
  public constructor(
    private readonly repository: ProductionWorkflowRepository,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly chapters: ChapterCatalogService,
    private readonly canon: CanonService,
    private readonly tasks: TaskService,
    private readonly protagonists?: ProtagonistStateService
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
    const reference = this.repository.manuscriptReference(scope, gate.manuscriptVersionId);
    const chapter = this.repository.chapter(scope, gate.chapterId);
    const content = readFileSync(resolveInside(this.dataDir, reference.relativePath), 'utf8');
    const now = this.clock.now().toISOString();
    return this.repository.runInTransaction(() => {
      const liveGate = this.repository.requireGate(scope, confirmationId);
      const liveRetry = (liveGate.status === 'accepted' || liveGate.status === 'settlement_failed') && accept;
      if (liveGate.status !== 'awaiting_owner' && !liveRetry) throw new Error('正文确认单已经处理');
      if (liveGate.expectedCanonRevision !== expectedCanonRevision) throw new Error('正文确认单绑定的正史版本不匹配');
      if (this.repository.canonRevision(scope) !== expectedCanonRevision) throw new Error('正史修订已经变化，正文确认必须重新生成');
      if (!liveRetry) this.repository.resolveGate(scope, confirmationId, true, note, now);
      this.chapters.selectManuscript(scope, gate.chapterId, gate.manuscriptVersionId);
      for (const candidate of this.repository.factCandidatesForPanel(scope, liveGate.reviewPanelId)) {
        const rejectionReason = candidate.evidenceQuote.length > 600
          ? 'evidence_quote_too_long' as const
          : !content.includes(candidate.evidenceQuote)
            ? 'evidence_quote_not_found' as const
            : null;
        if (rejectionReason !== null) {
          // A model-proposed fact is a secondary projection, not the manuscript authority. Invalid
          // evidence is quarantined from canon without blocking an otherwise approved manuscript.
          this.repository.recordRejectedFactCandidate(scope, {
            eventId: this.ids.next(),
            occurredAt: now,
            chapterId: gate.chapterId,
            manuscriptVersionId: gate.manuscriptVersionId,
            reviewPanelId: liveGate.reviewPanelId,
            subjectName: candidate.subjectName,
            relationKey: candidate.relationKey,
            reason: rejectionReason,
            evidenceQuoteLength: candidate.evidenceQuote.length
          });
          continue;
        }
        const entityId = this.repository.findEntity(scope, candidate.entityType, candidate.subjectName)
          ?? this.canon.createEntity(scope, { entityType: candidate.entityType, canonicalName: candidate.subjectName });
        const viewpointEntityId = candidate.viewpointName === null
          ? null
          : this.repository.findEntity(scope, 'character', candidate.viewpointName)
            ?? this.canon.createEntity(scope, { entityType: 'character', canonicalName: candidate.viewpointName });
        const knowledgeSubjectId = candidate.knowledgeSubjectName === null
          ? null
          : this.repository.findEntity(scope, 'character', candidate.knowledgeSubjectName)
            ?? this.canon.createEntity(scope, { entityType: 'character', canonicalName: candidate.knowledgeSubjectName });
        if (this.repository.hasFactCandidate(scope, {
          chapterId: gate.chapterId,
          manuscriptVersionId: gate.manuscriptVersionId,
          subjectEntityId: entityId,
          relationKey: candidate.relationKey
        })) continue;
        this.canon.proposeFact(scope, {
          subjectEntityId: entityId,
          relationKey: candidate.relationKey,
          value: candidate.value,
          evidence: [{
            manuscriptVersionId: gate.manuscriptVersionId,
            quote: candidate.evidenceQuote,
            location: candidate.evidenceLocation
          }],
          grade: 'B',
          sourceChapterId: gate.chapterId,
          sourceManuscriptVersionId: gate.manuscriptVersionId,
          storyTimeStart: candidate.storyTimeStart ?? `第${chapter.chapterNumber}章`,
          storyTimeEnd: candidate.storyTimeEnd,
          epistemicStatus: candidate.epistemicStatus,
          negated: candidate.negated,
          viewpointEntityId,
          knowledgeSubjectId,
          knowledgeTimeStart: candidate.knowledgeTimeStart,
          knowledgeTimeEnd: candidate.knowledgeTimeEnd,
          temporalCompleteness: candidate.storyTimeStart !== null
            && (candidate.epistemicStatus === 'objective' || (viewpointEntityId !== null && knowledgeSubjectId !== null))
            ? 'complete'
            : 'partial'
        });
      }
      const result = this.canon.settleChapter(scope, gate.chapterId, gate.manuscriptVersionId, {
        chapterNumber: chapter.chapterNumber,
        manuscriptVersionId: gate.manuscriptVersionId,
        endingExcerpt: endingExcerpt(content),
        continuityAnchors: buildChapterContinuityAnchors(content),
        source: 'owner_confirmed_manuscript'
      }, undefined, expectedCanonRevision);
      this.protagonists?.projectCanonFacts(scope, gate.chapterId);
      this.repository.recordQualityMetric(scope, {
        id: this.ids.next(), chapterId: gate.chapterId, manuscriptVersionId: gate.manuscriptVersionId,
        reviewPanelId: liveGate.reviewPanelId,
        rewriteCount: this.repository.rewriteCount(scope, gate.chapterId, gate.taskId), now
      });
      this.repository.markGateSettlement(scope, confirmationId, true, now);
      this.tasks.resolveWaitingConfirmation(scope, gate.taskId, true);
      return { status: 'settled', canonRevision: result.canonRevision };
    });
  }
}

function endingExcerpt(content: string): string {
  const normalized = content.trim();
  if (normalized.length === 0) throw new Error('正文为空，不能结算');
  return normalized.slice(-600);
}
