import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { CreationWorkflowProgressRepository, type FirstVolumeLaunchProgressRow } from '../../infrastructure/db/repositories/creation-workflow-progress-repository.js';

const managedStages = new Set([
  'next_chapters_ready', 'manuscript_in_progress', 'waiting_for_author', 'chapter_settlement_in_progress'
]);

export interface ChapterProgressResult {
  managed: boolean;
  stage: string | null;
  eventId: string | null;
}

export interface FirstVolumeLaunchProgressView {
  volumePlanId:string;volumeDirectionVersionId:string;totalEffectiveCharacters:number;latestSettledChapterNumber:number;
  climaxStatus:FirstVolumeLaunchProgressRow['climaxStatus'];climaxEventId:string|null;climaxCompletedAtEffectiveCharacters:number|null;
  prediction:Record<string,unknown>;actualEvidence:Record<string,unknown>|null;updatedAt:string;
}
export class CreationWorkflowProgressService {
  private readonly repository: CreationWorkflowProgressRepository;

  public constructor(database: DatabaseSync) {
    this.repository = new CreationWorkflowProgressRepository(database);
  }

  public markManuscriptStarted(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.repository.markManuscriptStarted(scope, taskId);
  }

  public markWaitingForAuthor(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.repository.markWaitingForAuthor(scope, taskId);
  }

  public markAuthorRejected(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.repository.markAuthorRejected(scope, taskId);
  }

  public markChapterSettlementStarted(scope: BookScope, taskId: string): void {
    assertBookScope(scope);
    this.repository.markChapterSettlementStarted(scope, taskId);
  }

  public firstVolumeLaunchProgress(scope:BookScope):FirstVolumeLaunchProgressView|null{
    assertBookScope(scope);
    const row=this.repository.refreshFirstVolumeLaunchProgress(scope,new Date().toISOString());
    if(row===null)return null;
    return{volumePlanId:row.volumePlanId,volumeDirectionVersionId:row.volumeDirectionVersionId,
      totalEffectiveCharacters:row.totalEffectiveCharacters,latestSettledChapterNumber:row.latestSettledChapterNumber,
      climaxStatus:row.climaxStatus,climaxEventId:row.climaxEventId,
      climaxCompletedAtEffectiveCharacters:row.climaxCompletedAtEffectiveCharacters,
      prediction:JSON.parse(row.predictionJson) as Record<string,unknown>,
      actualEvidence:row.actualEvidenceJson===null?null:JSON.parse(row.actualEvidenceJson) as Record<string,unknown>,
      updatedAt:row.updatedAt};
  }
  public markChapterSettled(scope: BookScope, chapterNumber: number): ChapterProgressResult {
    assertBookScope(scope);
    return this.repository.runInTransaction(() => {
      const workflow = this.repository.workflow(scope);
      if (workflow === undefined) {
        // 历史书可能没有新创作进度投影；投影缺失不能反向阻断作者最终正文结算。
        return { managed: false, stage: null, eventId: null };
      }
      if (workflow.activeEventId === null || !managedStages.has(workflow.stage)) {
        return { managed: false, stage: null, eventId: workflow.activeEventId };
      }

      const outline = this.repository.frozenOutlineForChapter(scope, workflow.activeEventId, chapterNumber);
      if (outline === undefined) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '定稿章节没有绑定当前事件的冻结章纲，已停止推进工作流。',
          {},
          false,
          409
        );
      }
      const workflowRefs = parseRefs(workflow.frozenChapterOutlineRefsJson);
      if (!workflowRefs.some((ref) => ref.id === outline.artifactId)) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '当前章纲不在本轮冻结清单中，不能结算。',
          {},
          false,
          409
        );
      }

      const now = new Date().toISOString();
      if (!this.repository.settleOutline(scope, outline.outlineId, now)) {
        throw new DomainError(errorCodes.bookVersionConflict, '章纲状态已经变化，不能重复结算。', {}, false, 409);
      }
      const refs = workflowRefs.filter((ref) => ref.id !== outline.artifactId);
      const remaining = this.repository.remainingOutlineCount(scope, workflow.activeEventId);
      const nextStage = refs.length > 0
        ? 'next_chapters_ready'
        : remaining > 0
          ? 'chapter_outlines_in_progress'
          : 'event_settlement_in_progress';
      const updated = this.repository.advanceAfterChapterSettlement(scope, {
        expectedPlanningVersion: workflow.planningVersion,
        eventId: workflow.activeEventId,
        stage: nextStage,
        refsJson: JSON.stringify(refs),
        now
      });
      if (!updated) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '章节结算时创作进度已经变化，请刷新后重试。',
          {},
          true,
          409
        );
      }
      this.repository.refreshFirstVolumeLaunchProgress(scope,now);
      return { managed: true, stage: nextStage, eventId: workflow.activeEventId };
    });
  }
}

function parseRefs(value: string): Array<{ kind: string; id: string; version: number; contentHash: string; required: boolean }> {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is { kind: string; id: string; version: number; contentHash: string; required: boolean } =>
    typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string');
}