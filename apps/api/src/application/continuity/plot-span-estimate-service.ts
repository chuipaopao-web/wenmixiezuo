import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';

export class PlotSpanEstimateService {
  public constructor(private readonly repository: LongformContinuityRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  public submit(scope: BookScope, input: { discussionId: string; round: number; agentId: string; modelSnapshotId: string; minimum: number; recommended: number; maximum: number; units: unknown; assumptions: unknown; uncertainty: unknown; sharedBrief: unknown }): string {
    if (!(input.minimum >= 1 && input.minimum <= input.recommended && input.recommended <= input.maximum)) throw new Error('章节跨度必须满足最小≤建议≤最大');
    const inputHash = createHash('sha256').update(JSON.stringify(input.sharedBrief)).digest('hex');
    const submitted = this.repository.spanEstimates(scope, input.discussionId, input.round);
    if (submitted.some((item) => item.agentId === input.agentId)) throw new Error('同一编剧本轮只能独立提交一次');
    if (submitted.some((item) => this.repository.modelSignature(item.modelSnapshotId) === this.repository.modelSignature(input.modelSnapshotId))) throw new Error('两位编剧的跨度估算必须保持独立');
    if (submitted.some((item) => item.inputHash !== inputHash)) throw new Error('双编剧必须接收相同的共享简报');
    const id = this.ids.next();
    this.repository.insertSpanEstimate(scope, { id, ...input, inputHash, now: this.clock.now().toISOString() });
    return id;
  }
}
