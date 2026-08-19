import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { ProductionReview } from '../../contracts/production-review.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import {
  ChapterChallengerReviewRepository,
  type ChapterChallengerReviewRow
} from '../../infrastructure/db/repositories/chapter-challenger-review-repository.js';
import {
  VolumePlanGenerationRepository,
  type VolumePlanGenerationSeat
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import { TaskService } from '../tasks/task-service.js';

export interface ChapterChallengerReviewBrief {
  schema: 'chapter-challenger-review-v1';
  reviewId: string;
  chapterId: string;
  chapterNumber: number;
  manuscriptVersionId: string;
  seat: VolumePlanGenerationSeat;
}

export interface ChapterChallengerReviewView {
  reviewId: string;
  chapterId: string;
  manuscriptVersionId: string;
  status: 'working' | 'succeeded' | 'failed' | 'cancelled';
  taskId: string;
  taskStatus: string;
  errorCode: string | null;
  report: ProductionReview | null;
  member: {
    roleKey: string;
    agentId: string;
    displayName: string;
    provider: string;
    modelId: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export class ChapterChallengerReviewService {
  public constructor(
    private readonly repository: ChapterChallengerReviewRepository,
    private readonly generationRepository: VolumePlanGenerationRepository,
    private readonly tasks: TaskService,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public start(scope: BookScope, input: { chapterId: string; idempotencyKey: string }): ChapterChallengerReviewView {
    assertBookScope(scope);
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim().length < 8) {
      throw new DomainError(errorCodes.validation, '缺少有效的幂等键。');
    }
    const chapter = this.repository.chapterManuscriptTarget(scope, input.chapterId);
    if (chapter === undefined) throw new DomainError(errorCodes.bookNotFound, '这一章不存在。');
    if (chapter.manuscriptVersionId === null) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '这一章还没有正文，先让主笔写出来，挑剔读者才有东西可看。',
        {},
        false,
        409
      );
    }
    const team = this.generationRepository.generationSeats(scope);
    const challenger = team.seats.find((seat) => seat.roleKey === 'experience_challenger');
    if (challenger === undefined) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '挑剔读者还没加入这本书的创作团队，暂时不能请她找茬。',
        {},
        false,
        409
      );
    }
    const budgetId = this.generationRepository.activeBudgetId(scope);
    if (budgetId === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '当前书籍没有可用预算。', {}, false, 409);
    }
    const working = this.repository.workingForChapter(scope, input.chapterId);
    if (working !== undefined) return this.view(scope, working);
    const manuscriptVersionId = chapter.manuscriptVersionId;
    const reviewId = this.ids.next();
    const brief: ChapterChallengerReviewBrief = {
      schema: 'chapter-challenger-review-v1',
      reviewId,
      chapterId: chapter.chapterId,
      chapterNumber: chapter.chapterNumber,
      manuscriptVersionId,
      seat: challenger
    };
    const now = this.clock.now().toISOString();
    this.unitOfWork.run(() => {
      let task = this.tasks.create(scope, {
        taskId: this.ids.next(),
        taskType: 'chapter_challenger_review',
        assignedAgentId: challenger.agentId,
        idempotencyKey: `chapter-challenger:${input.chapterId}:${input.idempotencyKey.trim()}`,
        budgetId,
        requiredEditorEpoch: team.editorEpoch,
        initialPhase: 'challenger_review',
        chapterId: chapter.chapterId,
        brief: brief as unknown as Record<string, unknown>
      });
      this.repository.insert(scope, {
        reviewId, chapterId: chapter.chapterId, manuscriptVersionId,
        taskId: task.taskId, now
      });
      if (task.status === 'pending') task = this.tasks.queue(scope, task.taskId);
    });
    const created = this.repository.findById(scope, reviewId);
    if (created === undefined) throw new Error('挑剔读者找茬任务创建失败。');
    return this.view(scope, created);
  }

  public latest(scope: BookScope, chapterId: string): ChapterChallengerReviewView | null {
    assertBookScope(scope);
    const row = this.repository.latestForChapter(scope, chapterId);
    return row === undefined ? null : this.view(scope, row);
  }

  private view(scope: BookScope, row: ChapterChallengerReviewRow): ChapterChallengerReviewView {
    const task = this.tasks.require(scope, row.task_id);
    if (row.status === 'working' && task.status === 'cancelled') {
      this.repository.markCancelled(scope, row.review_id, this.clock.now().toISOString());
      row = { ...row, status: 'cancelled' };
    }
    const brief = task.brief as unknown as Partial<ChapterChallengerReviewBrief>;
    const seat = brief.seat;
    return {
      reviewId: row.review_id,
      chapterId: row.chapter_id,
      manuscriptVersionId: row.manuscript_version_id,
      status: row.status,
      taskId: row.task_id,
      taskStatus: task.status,
      errorCode: row.error_code ?? task.errorCode,
      report: parseReport(row.report_json),
      member: seat === undefined ? null : {
        roleKey: seat.roleKey,
        agentId: seat.agentId,
        displayName: seat.displayName,
        provider: seat.provider,
        modelId: seat.modelId
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function parseReport(reportJson: string | null): ProductionReview | null {
  if (reportJson === null) return null;
  try {
    return JSON.parse(reportJson) as ProductionReview;
  } catch {
    return null;
  }
}
