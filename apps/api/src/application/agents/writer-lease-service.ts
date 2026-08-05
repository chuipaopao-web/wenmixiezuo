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
    if (current.writerAgentId === agentId) {
      if (current.writingOrderId === writingOrderId) {
        return this.resumeExactOrder(scope, agentId, current.epoch, writingOrderId, checkpoint);
      }
      this.assertEligibleWriter(scope, agentId);
      const now = this.clock.now();
      if (!this.repository.takeover(scope, {
        expectedEpoch: current.epoch,
        agentId,
        writingOrderId,
        checkpoint,
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        now: now.toISOString()
      })) {
        throw new Error('同一写手切换新工单时租约版本冲突');
      }
      return this.repository.get(scope)!;
    }
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
    const deterministic = candidate.plan === 'deterministic' || candidate.provider.startsWith('local-deterministic');
    if (!deterministic) {
      const now = this.clock.now();
      const recentlyVerified = this.repository.hasRecentModelSuccess(scope, candidate.provider, candidate.modelId,
        new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString());
      if (!recentlyVerified) {
        // 新书、新模型或清空历史后的候任副笔不可能预先拥有成功记录。允许它在任务、
        // 预算和 writer_epoch 门禁内进行一次冷启动调用；但已有在途调用或十分钟内
        // 的失败/结果未知记录时停止接管，防止重复生成和故障风暴。
        const working = this.repository.hasWorkingModelCall(scope, candidate.provider, candidate.modelId);
        const failureCooldownMinutes = 10;
        const recentFailure = this.repository.recentModelFailure(scope, candidate.provider, candidate.modelId,
          new Date(now.getTime() - failureCooldownMinutes * 60 * 1_000).toISOString());
        if (working || recentFailure !== null) {
          throw new Error(working
            ? '候任副笔模型已有进行中的调用，已停止重复接管'
            : `候任副笔模型最近一次调用未成功（${recentFailure?.errorClass ?? recentFailure?.state ?? 'unknown'}），已暂停接管并等待冷却后重试`);
        }
      }
    }
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
  public resumeExactOrder(
    scope: BookScope,
    agentId: string,
    epoch: number,
    writingOrderId: string,
    checkpoint: unknown = {},
    leaseMs = 60_000
  ): WriterLeaseRecord {
    this.assertEligibleWriter(scope, agentId);
    const now = this.clock.now();
    if (!this.repository.resumeExactOrder(scope, {
      agentId,
      epoch,
      writingOrderId,
      checkpoint,
      expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      now: now.toISOString()
    })) {
      throw new Error('原写手工单、epoch或租约身份不一致，拒绝恢复');
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
