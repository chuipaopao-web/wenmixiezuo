import { afterEach, describe, expect, it } from 'vitest';
import { AiNodeBatchService } from '../../../apps/api/src/application/agents/ai-node-batch-service.js';
import { AiNodePipelineService, validateTemplateContent } from '../../../apps/api/src/application/agents/ai-node-pipeline-service.js';
import { allRoleSkills, coreAgentSkill, nodeProtocolSkill } from '../../../apps/api/src/application/agents/agent-skills-v6.js';
import { creativeTemplate } from '../../../apps/api/src/application/agents/creative-templates-v6.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { ModelCallService } from '../../../apps/api/src/application/calls/model-call-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import type { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { TaskClaimer } from '../../../apps/worker/src/scheduler/task-claimer.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('V6 AI 编辑部与公平节点批次', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('核心、七岗位和节点 Skill 与创作模板形成可冻结的三层合同', () => {
    const roles = allRoleSkills();
    expect(roles).toHaveLength(7);
    expect(new Set(roles.map((skill) => skill.roleKey))).toEqual(new Set([
      'chief_editor', 'deputy_editor', 'screenwriter', 'writer',
      'fact_reviewer', 'literary_reviewer', 'experience_reviewer'
    ]));
    expect(coreAgentSkill().content).toMatchObject({ truthZones: ['actual', 'author_confirmed_plan', 'open_question', 'ai_candidate'] });
    const chief = nodeProtocolSkill('storyline_next_direction', 'chief_editor');
    expect(chief.content).toMatchObject({ horizonVolumes: [1, 2] });
    expect(JSON.stringify(chief.content)).toContain('继续观察');
    const template = creativeTemplate('storyline_next_direction', 'storyline-next-direction-v2');
    expect(template.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => validateTemplateContent({ title: '方向A' }, template.schema)).toThrow(/模板要求字段缺失/u);
    expect(() => validateTemplateContent({
      title: '方向A', summary: '只推进下一卷', continuationReason: '来自卷结算', protagonistInvolvement: '主角必须承担选择后果',
      coreQuestion: '是否公开证据', inferences: [], unknowns: [], misreadRisk: '证据仍少', recommendedHorizonVolumes: 3
    }, template.schema)).toThrow(/模板整数字段无效/u);
    expect(() => validateTemplateContent({
      title: '继续观察', summary: '证据不足时不强推', continuationReason: '正文没有形成稳定矛盾', protagonistInvolvement: '暂不新增卷目标',
      coreQuestion: '等待下一事件', inferences: [], unknowns: ['更远结局'], misreadRisk: '避免误建线', recommendedHorizonVolumes: 1
    }, template.schema)).not.toThrow();
  });
  it('岗位池只投影作者可见字段，后台配置有版本冲突门禁', () => {
    context = createTestContext('wenmi-ai-node-pool-');
    const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '岗位池测试', text: '测试开书信息' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new AiNodeBatchService(context.database, context.config.releaseId, ids, clock);
    const pools = service.listPools(scope);
    expect(pools.map((pool) => pool.roleLabel)).toEqual(['主编','副编','编剧','主笔','事实席','文学席','体验席']);
    expect(pools.reduce((total, pool) => total + pool.members.length, 0)).toBe(25);
    expect(Object.fromEntries(pools.map((pool) => [pool.roleKey, pool.members.length]))).toEqual({
      chief_editor: 3, deputy_editor: 3, screenwriter: 5, writer: 5,
      fact_reviewer: 3, literary_reviewer: 3, experience_reviewer: 3
    });
    expect(pools.find((pool) => pool.roleKey === 'screenwriter')?.members.length).toBeGreaterThanOrEqual(3);
    const projected = JSON.stringify(pools);
    expect(projected).not.toMatch(/modelId|model_id|provider|擅长|成功率|速度/iu);
    const screenwriters = pools.find((pool) => pool.roleKey === 'screenwriter')!;
    expect(service.configurePool(scope, 'screenwriter', {
      desiredCount: 6, enabled: true, expectedRevision: screenwriters.revision
    }).desiredCount).toBe(6);
    expect(() => service.configurePool(scope, 'screenwriter', {
      desiredCount: 7, enabled: true, expectedRevision: screenwriters.revision
    })).toThrow(/配置已变化/u);
  });

  it('同岗位同批次共享同一资料包哈希，作者输入改动创建新版本且旧批次保留', () => {
    context = createTestContext('wenmi-ai-node-fair-');
    const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '公平资料包测试', text: '测试开书信息' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new AiNodeBatchService(context.database, context.config.releaseId, ids, clock);
    const members = service.listPools(scope).find((pool) => pool.roleKey === 'screenwriter')!.members;
    const selected = members.slice(0, 2).map((member) => member.memberId);
    const authorV1 = service.saveAuthorInput(scope, 'storyline_design', 'storyline-root', '请保留主角不主动伤害无辜的边界。');
    const batch = service.createBatch(scope, {
      nodeKind: 'storyline_design', objectId: 'storyline-root', roleKey: 'screenwriter',
      taskDescription: '为全书提出两份独立故事线骨架', templateVersion: 'storyline-node-v1',
      sourceVersionIds: ['topology-v1'], preferredMemberIds: selected, confirmHighCost: true,
      hardSources: [{ sourceType: 'book_core', sourceId: book.bookId, content: '主角调查被改写的城市档案。',
        reason: '开书已确认资料', priority: 95, truthStatus: 'confirmed', scopeType: 'book', scopeId: book.bookId,
        componentKind: 'BookCorePack' }], optionalSources: [], idempotencyKey: 'storyline-design-batch-1'
    });
    expect(batch.authorInputVersion).toBe(authorV1.version);
    expect(new Set(batch.members.map((member) => member.status))).toEqual(new Set(['queued']));
    const frozenRows = context.database.prepare(`SELECT context_pack_id,context_pack_hash FROM ai_node_batch_members_v6
      WHERE batch_id=?`).all(batch.batchId) as Array<{ context_pack_id: string; context_pack_hash: string }>;
    expect(new Set(frozenRows.map((row) => row.context_pack_id))).toEqual(new Set([batch.contextPackId]));
    expect(new Set(frozenRows.map((row) => row.context_pack_hash))).toEqual(new Set([batch.contextPackHash]));
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM context_packs WHERE context_pack_id=?`).get(batch.contextPackId))
      .toEqual({ count: 1 });
    expect(context.database.prepare(`SELECT core_skill_version_id,role_skill_version_id,node_protocol_version_id,template_version,
      template_version_id,template_hash FROM ai_node_batches_v6 WHERE batch_id=?`).get(batch.batchId)).toEqual({
        core_skill_version_id: 'skill-v6-core-2', role_skill_version_id: 'skill-v6-role-screenwriter-2',
        node_protocol_version_id: 'skill-v6-node-storyline_design-screenwriter-2', template_version: 'storyline-node-v1',
        template_version_id: 'template:storyline_design:storyline-node-v1', template_hash: batch.skillVersions.templateHash
      });
    expect(batch.skillVersions.templateVersionId).toBe('template:storyline_design:storyline-node-v1');
    expect(batch.skillVersions.templateHash).toMatch(/^[a-f0-9]{64}$/u);

    const authorV2 = service.saveAuthorInput(scope, 'storyline_design', 'storyline-root', '新一轮允许主角先欺骗对手，但仍不伤害无辜。');
    const next = service.createBatch(scope, {
      nodeKind: 'storyline_design', objectId: 'storyline-root', roleKey: 'screenwriter',
      taskDescription: '按新作者要求重新设计故事线骨架', templateVersion: 'storyline-node-v1',
      sourceVersionIds: ['topology-v1'], preferredMemberIds: [selected[0]!],
      hardSources: [{ sourceType: 'book_core', sourceId: book.bookId, content: '主角调查被改写的城市档案。',
        reason: '开书已确认资料', priority: 95, truthStatus: 'confirmed', scopeType: 'book', scopeId: book.bookId,
        componentKind: 'BookCorePack' }], optionalSources: [], idempotencyKey: 'storyline-design-batch-2'
    });
    expect(next.batchVersion).toBe(2);
    expect(next.authorInputVersion).toBe(authorV2.version);
    expect(next.contextPackHash).not.toBe(batch.contextPackHash);
    expect(service.viewBatch(scope, batch.batchId).authorInputVersion).toBe(authorV1.version);
  });

  it('Worker 使用冻结资料包执行成员，部分失败后可换批次任务恢复且保留成功结果', async () => {
    context = createTestContext('wenmi-ai-node-executor-');
    const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '节点执行测试', text: '测试开书信息' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const batches = new AiNodeBatchService(context.database, context.config.releaseId, ids, clock);
    const members = batches.listPools(scope).find((pool) => pool.roleKey === 'screenwriter')!.members.slice(0, 2);
    const batch = batches.createBatch(scope, {
      nodeKind: 'storyline_design', objectId: 'storyline-root', roleKey: 'screenwriter', taskDescription: '设计故事线骨架',
      templateVersion: 'storyline-v1', sourceVersionIds: ['opening-v1'], preferredMemberIds: members.map((member) => member.memberId),
      confirmHighCost: true, hardSources: [source(book.bookId)], optionalSources: [], idempotencyKey: 'execute-node-batch'
    });
    let failingMemberId: string | null = members[1]!.memberId;
    const adapters = {
      resolve(provider: string, modelId: string) {
        return { provider, modelId, async generate(request: { agentId: string }) {
          if (request.agentId === failingMemberId) throw new Error('test provider timeout');
          return { provider, modelId, state: 'succeeded' as const, inputTokens: 120, outputTokens: 90, cashCostCny: 0,
            output: JSON.stringify({ candidateKind: 'storyline_design', content: { title: `候选-${request.agentId}`, coreQuestion: '谁改写了城市档案？' },
              authorSummary: { preserved: ['作者边界'], adjusted: ['线路顺序'], omitted: [] } }) };
        } };
      }
    } as unknown as ModelAdapterFactory;
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const budgets = new BudgetService(context.database, ids, clock);
    const pipeline = new AiNodePipelineService(context.database, context.config.releaseId, tasks, budgets,
      new ModelCallService(context.database, clock, budgets), ids, clock, adapters);
    const claimer = new TaskClaimer(context.database, 'worker-ai-node', () => clock.now());
    const firstClaim = claimer.claimNext(clock.now(), 120_000)!;
    expect(firstClaim.taskType).toBe('ai_node:storyline_design');
    await pipeline.executeClaimed(scope, firstClaim.taskId, 'worker-ai-node', {
      leaseToken: firstClaim.leaseToken, attemptNo: firstClaim.attemptNo
    });
    const partial = batches.viewBatch(scope, batch.batchId);
    expect(partial.status).toBe('partial_success');
    expect(partial.progress).toMatchObject({ completed: 1, failed: 1, total: 2 });
    const succeededResultId = partial.members.find((member) => member.status === 'completed')!.result!.resultId;
    const failedMember = partial.members.find((member) => member.status === 'failed')!;
    failingMemberId = null;
    batches.retryMember(scope, batch.batchId, failedMember.batchMemberId);
    const recoveryClaim = claimer.claimNext(clock.now(), 120_000)!;
    expect(recoveryClaim.taskId).not.toBe(firstClaim.taskId);
    await pipeline.executeClaimed(scope, recoveryClaim.taskId, 'worker-ai-node', {
      leaseToken: recoveryClaim.leaseToken, attemptNo: recoveryClaim.attemptNo
    });
    const recovered = batches.viewBatch(scope, batch.batchId);
    expect(recovered.status).toBe('completed');
    expect(recovered.progress).toMatchObject({ completed: 2, failed: 0, total: 2, percent: 100 });
    expect(recovered.members.some((member) => member.result?.resultId === succeededResultId)).toBe(true);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM context_packs WHERE context_pack_id=?`).get(batch.contextPackId))
      .toEqual({ count: 1 });
  });

  it('部分成功保留已完成结果，失败成员可单独重试或更换，同模型不能伪装独立成员', () => {
    context = createTestContext('wenmi-ai-node-recovery-');
    const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '失败恢复测试', text: '测试开书信息' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new AiNodeBatchService(context.database, context.config.releaseId, ids, clock);
    const writers = service.listPools(scope).find((pool) => pool.roleKey === 'screenwriter')!.members;
    expect(writers.length).toBeGreaterThanOrEqual(3);
    expect(() => service.createBatch(scope, {
      nodeKind: 'volume_route', objectId: 'volume-1', roleKey: 'screenwriter', taskDescription: '独立设计卷路线',
      templateVersion: 'volume-route-v1', sourceVersionIds: ['storyline-v1'],
      preferredMemberIds: [writers[0]!.memberId, writers[0]!.memberId], confirmHighCost: true,
      hardSources: [source(book.bookId)], optionalSources: [], idempotencyKey: 'duplicate-model-batch'
    })).toThrow(/同一模型不能作为独立成员/u);

    const batch = service.createBatch(scope, {
      nodeKind: 'volume_route', objectId: 'volume-1', roleKey: 'screenwriter', taskDescription: '独立设计卷路线',
      templateVersion: 'volume-route-v1', sourceVersionIds: ['storyline-v1'],
      preferredMemberIds: [writers[0]!.memberId, writers[1]!.memberId], confirmHighCost: true,
      hardSources: [source(book.bookId)], optionalSources: [], idempotencyKey: 'recoverable-batch'
    });
    const [first, second] = batch.members;
    service.recordMemberResult(scope, batch.batchId, first!.batchMemberId, {
      candidateKind: 'route-a', content: { opening: '主角先失去档案权限', climax: '公开重建证据链' },
      authorSummary: { preserved: ['主角底线'], adjusted: ['调查顺序'], omitted: [{ item: '提前揭晓幕后人', reason: '超出本卷深度' }] }
    });
    const partial = service.recordMemberFailure(scope, batch.batchId, second!.batchMemberId, 'provider_timeout', '供应商超时');
    expect(partial.status).toBe('partial_success');
    expect(partial.progress).toMatchObject({ completed: 1, failed: 1, total: 2 });
    expect(partial.members.find((member) => member.batchMemberId === first!.batchMemberId)?.result).not.toBeNull();
    expect(service.retryMember(scope, batch.batchId, second!.batchMemberId).members
      .find((member) => member.batchMemberId === second!.batchMemberId)?.status).toBe('queued');
    service.recordMemberFailure(scope, batch.batchId, second!.batchMemberId, 'empty_output', '结果为空');
    const replaced = service.replaceMember(scope, batch.batchId, second!.batchMemberId, writers[2]!.memberId, true);
    expect(replaced.members.find((member) => member.batchMemberId === first!.batchMemberId)?.result).not.toBeNull();
    expect(replaced.members.some((member) => member.status === 'replaced')).toBe(true);
    expect(replaced.members.some((member) => member.member.memberId === writers[2]!.memberId && member.status === 'queued')).toBe(true);
    expect(() => service.recordMemberResult(scope, batch.batchId,
      replaced.members.find((member) => member.member.memberId === writers[2]!.memberId)!.batchMemberId, {
        candidateKind: 'bad', content: { chainOfThought: '不得保存' },
        authorSummary: { preserved: [], adjusted: [], omitted: [] }
      })).toThrow(/不得保存或展示模型思维链/u);
  });
});

function source(bookId: string) {
  return { sourceType: 'book_core', sourceId: bookId, content: '主角调查被改写的城市档案。', reason: '开书已确认资料',
    priority: 95, truthStatus: 'confirmed' as const, scopeType: 'book' as const, scopeId: bookId,
    componentKind: 'BookCorePack' as const };
}
