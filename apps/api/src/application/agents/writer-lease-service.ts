import type { Clock } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { WriterLeaseRepository, WriterLeaseRecord } from '../../infrastructure/db/repositories/writer-lease-repository.js';

export class WriterLeaseService {
  public constructor(private readonly repository: WriterLeaseRepository, private readonly clock: Clock) {}
  public initialize(scope: BookScope, agentId: string, writingOrderId: string, checkpoint: unknown = {}): WriterLeaseRecord {
    if (this.repository.get(scope) !== null) throw new Error('活动写手租约已经存在');
    const now = this.clock.now(); this.repository.initialize(scope, { agentId, writingOrderId, checkpoint,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(), now: now.toISOString() }); return this.repository.get(scope)!;
  }
  public takeover(scope: BookScope, expectedEpoch: number, newAgentId: string, writingOrderId: string, checkpoint: unknown): WriterLeaseRecord {
    const now = this.clock.now();
    if (!this.repository.takeover(scope, { expectedEpoch, agentId: newAgentId, writingOrderId, checkpoint,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(), now: now.toISOString() })) throw new Error('写手租约版本冲突，拒绝重复接管');
    return this.repository.get(scope)!;
  }
  public assertCanCommit(scope: BookScope, agentId: string, epoch: number): void {
    const lease = this.repository.get(scope);
    if (lease === null || lease.writerAgentId !== agentId || lease.epoch !== epoch) throw new Error('旧写手或旧epoch不能提交正文');
  }
}
