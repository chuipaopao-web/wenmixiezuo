import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { stableJson } from '../knowledge/canon-service.js';
import type { ProductionWorkflowRepository, WritingOrderRecord } from '../../infrastructure/db/repositories/production-workflow-repository.js';

export interface WritingOrderSource {
  sourceClass: 'hard' | 'focused' | 'optional';
  sourceType: string;
  sourceId: string;
  reason: string;
  content: string;
}

export class WritingOrderService {
  public constructor(private readonly repository: ProductionWorkflowRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}

  public create(scope: BookScope, input: {
    chapterId: string; taskId: string; sourceDecisionId: string; outlineVersionId: string; contractVersionId: string;
    objective: string; sceneScope: Record<string, unknown>; hardConstraints: string[]; creativeFreedom: string[];
    canonRevision: number; positioningVersion: number; sources: WritingOrderSource[];
  }): WritingOrderRecord {
    if (input.objective.trim().length === 0) throw new Error('写作工单缺少本章目标');
    if (input.hardConstraints.length === 0) throw new Error('写作工单缺少硬约束');
    if (input.creativeFreedom.length === 0) throw new Error('写作工单必须明确主笔自由创作区');
    const immutable = {
      sourceDecisionId: input.sourceDecisionId,
      outlineVersionId: input.outlineVersionId,
      contractVersionId: input.contractVersionId,
      objective: input.objective.trim(),
      sceneScope: input.sceneScope,
      hardConstraints: input.hardConstraints,
      creativeFreedom: input.creativeFreedom,
      canonRevision: input.canonRevision,
      positioningVersion: input.positioningVersion,
      reviewThresholds: { blocker: 'block', major: 'targeted_rewrite', maximumRewriteRounds: 2 }
    };
    const now = this.clock.now().toISOString();
    const order = this.repository.createWritingOrder(scope, {
      id: this.ids.next(), chapterId: input.chapterId, taskId: input.taskId, sourceDecisionId: input.sourceDecisionId,
      outlineVersionId: input.outlineVersionId, contractVersionId: input.contractVersionId, objective: input.objective.trim(),
      scopeData: input.sceneScope, hardConstraints: input.hardConstraints, creativeFreedom: input.creativeFreedom,
      reviewThresholds: immutable.reviewThresholds, canonRevision: input.canonRevision, positioningVersion: input.positioningVersion,
      contentHash: sha256(stableJson(immutable)), now
    });
    input.sources.forEach((source, ordinal) => this.repository.addWritingOrderSource(scope, {
      id: this.ids.next(), writingOrderId: order.writingOrderId, sourceClass: source.sourceClass, sourceType: source.sourceType,
      sourceId: source.sourceId, reason: source.reason, contentHash: sha256(source.content), characterCount: source.content.length,
      ordinal, now
    }));
    return order;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
