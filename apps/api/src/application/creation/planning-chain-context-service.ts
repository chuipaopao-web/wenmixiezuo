import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import {
  PlanningChainContextRepository,
  type PlanningChainRow
} from '../../infrastructure/db/repositories/planning-chain-context-repository.js';
import type { ContextSource } from '../memory/context-pack-service.js';

interface ManagedOutlineSource {
  sourceVolumePlanVersionId?: unknown;
  sourceEventId?: unknown;
  sourceEventVersionId?: unknown;
  sourceEventChapterSequenceVersionId?: unknown;
  sourceEventChapterOutlineVersionId?: unknown;
}

export class PlanningChainContextService {
  private readonly repository: PlanningChainContextRepository;

  public constructor(database: DatabaseSync) {
    this.repository = new PlanningChainContextRepository(database);
  }

  public validate(scope: BookScope, artifactVersionId: string, mode: 'active' | 'historical' = 'active'): void {
    this.load(scope, artifactVersionId, mode);
  }

  public factReviewSources(scope: BookScope, artifactVersionId: string, mode: 'active' | 'historical' = 'active'): ContextSource[] {
    const chain = this.load(scope, artifactVersionId, mode);
    if (chain === null) return [];
    const volume = record(JSON.parse(chain.volume_content_json) as unknown);
    const event = record(JSON.parse(chain.event_content_json) as unknown);
    const sequence = record(JSON.parse(chain.sequence_content_json) as unknown);
    const source = record(this.artifactContent(scope, artifactVersionId));
    return [
      {
        sourceType: 'planning:volume_boundary',
        sourceId: String(source.sourceVolumePlanVersionId),
        version: chain.volume_version,
        content: JSON.stringify(pick(volume, ['title', 'coreGoal', 'coreConflict', 'failureCost', 'endingState', 'boundaries'])),
        reason: '事实审校专用：当前活动卷的目标、失败代价和不可违反边界，不用于评价文风。',
        priority: 100
      },
      {
        sourceType: 'planning:event_boundary',
        sourceId: String(source.sourceEventVersionId),
        version: chain.event_version,
        content: JSON.stringify(pick(event, [
          'title', 'volumeResponsibility', 'startingState', 'trigger', 'participants', 'characterGoals',
          'obstacles', 'choicesAndCosts', 'requiredResult', 'endingConditions', 'nextEventImpact', 'uncertaintyNotes'
        ])),
        reason: '事实审校专用：当前活动事件的硬结果、结束条件和下一事件接口。',
        priority: 100
      },
      {
        sourceType: 'planning:event_chapter_chain',
        sourceId: String(source.sourceEventChapterSequenceVersionId),
        version: chain.sequence_version,
        content: JSON.stringify({
          eventTitle: sequence.eventTitle,
          eventEndingConditions: sequence.eventEndingConditions,
          closureCoverage: sequence.closureCoverage
        }),
        reason: '事实审校专用：事件章节链只提供事件闭环和全链覆盖，不重复注入当前章完整章纲。',
        priority: 100
      }
    ];
  }

  private load(scope: BookScope, artifactVersionId: string, mode: 'active' | 'historical'): PlanningChainRow | null {
    assertBookScope(scope);
    const content = record(this.artifactContent(scope, artifactVersionId)) as ManagedOutlineSource;
    const ids = [
      content.sourceVolumePlanVersionId,
      content.sourceEventId,
      content.sourceEventVersionId,
      content.sourceEventChapterSequenceVersionId,
      content.sourceEventChapterOutlineVersionId
    ];
    if (ids.every((value) => value === undefined)) return null;
    if (ids.some((value) => typeof value !== 'string' || value.length === 0)) throw stale();
    const chainInput = {
      artifactVersionId,
      volumePlanVersionId: String(content.sourceVolumePlanVersionId),
      eventId: String(content.sourceEventId),
      eventVersionId: String(content.sourceEventVersionId),
      eventChapterSequenceVersionId: String(content.sourceEventChapterSequenceVersionId),
      eventChapterOutlineVersionId: String(content.sourceEventChapterOutlineVersionId)
    };
    const row = mode === 'historical'
      ? this.repository.historicalChain(scope, chainInput)
      : this.repository.activeChain(scope, chainInput);
    if (row === undefined) throw stale();
    return row;
  }

  private artifactContent(scope: BookScope, artifactVersionId: string): unknown {
    const contentJson = this.repository.artifactContentJson(scope, artifactVersionId);
    if (contentJson === undefined) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '冻结章纲版本不存在或不属于当前书籍。',
        {},
        false,
        409
      );
    }
    return JSON.parse(contentJson) as unknown;
  }
}

function pick(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stale(): DomainError {
  return new DomainError(
    errorCodes.bookVersionConflict,
    '卷纲、事件大纲或完整章链已经变化；旧的冻结章纲不能继续用于正文。',
    {},
    false,
    409
  );
}
