import type { Clock } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { WriterLeaseRepository, WriterLeaseRecord } from '../../infrastructure/db/repositories/writer-lease-repository.js';

export class WriterLeaseService {
  public constructor(private readonly repository: WriterLeaseRepository, private readonly clock: Clock) {}
  public initialize(scope: BookScope, agentId: string, writingOrderId: string, checkpoint: unknown = {}): WriterLeaseRecord {
    if (this.repository.get(scope) !== null) throw new Error('活动写手租约已经存在');
    this.assertEligibleWriter(scope, agentId);
    const now = this.clock.now(); this.repository.initialize(scope, { agentId, writingOrderId, checkpoint,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(), now: now.toISOString() }); return this.repository.get(scope)!;
  }
  public beginOrder(scope: BookScope, agentId: string, writingOrderId: string, checkpoint: unknown = {}): WriterLeaseRecord {
    const current = this.repository.get(scope);
    if (current === null) return this.initialize(scope, agentId, writingOrderId, checkpoint);
    return this.takeover(scope, current.epoch, agentId, writingOrderId, checkpoint);
  }
  public takeover(
    scope: BookScope,
    expectedEpoch: number,
    newAgentId: string,
    writingOrderId: string,
    checkpoint: unknown,
    modelSnapshotId?: string
  ): WriterLeaseRecord {
    const candidate = this.assertEligibleWriter(scope, newAgentId, modelSnapshotId);
    const recentlyVerified = candidate.plan === 'deterministic' || candidate.provider.startsWith('local-deterministic')
      || this.repository.hasRecentModelSuccess(scope, candidate.provider, candidate.modelId,
        new Date(this.clock.now().getTime() - 24 * 60 * 60 * 1_000).toISOString());
    if (!recentlyVerified) throw new Error('候任写手模型当前没有24小时内的成功调用证据，拒绝接管');
    const now = this.clock.now();
    if (!this.repository.takeover(scope, { expectedEpoch, agentId: newAgentId, writingOrderId, checkpoint,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(), now: now.toISOString() })) throw new Error('写手租约版本冲突，拒绝重复接管');
    return this.repository.get(scope)!;
  }
  public renew(scope: BookScope, agentId: string, epoch: number, leaseMs = 60_000): WriterLeaseRecord {
    const now = this.clock.now();
    if (!this.repository.renew(scope, { agentId, epoch, expiresAt: new Date(now.getTime() + leaseMs).toISOString(), now: now.toISOString() })) {
      throw new Error('写手租约已经过期、被接管或版本发生变化');
    }
    return this.repository.get(scope)!;
  }
  public assertCanCommit(scope: BookScope, agentId: string, epoch: number): void {
    const lease = this.repository.get(scope);
    if (lease === null || lease.writerAgentId !== agentId || lease.epoch !== epoch
      || Date.parse(lease.leaseExpiresAt) <= this.clock.now().getTime()) {
      throw new Error('旧写手、旧epoch或过期租约不能提交正文');
    }
  }
  private assertEligibleWriter(scope: BookScope, agentId: string, modelSnapshotId?: string) {
    const agent = this.repository.writerAgent(scope, agentId, modelSnapshotId);
    if (agent === null) throw new Error('写手Agent不存在、停用或跨书');
    const allowed = agent.roleTemplateVersion === 2
      ? ['lead_writer', 'backup_writer'].includes(agent.roleKey)
      : agent.roleKey === 'writer';
    if (!allowed) throw new Error('活动写手只能由主笔或副笔岗位担任');
    return agent;
  }
}
