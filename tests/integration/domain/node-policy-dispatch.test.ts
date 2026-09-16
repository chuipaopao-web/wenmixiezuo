import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { NodeEvaluationRepository } from '../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import type { EvalNodePolicyRow } from '../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { resolveNodeMember, nodeFallbackOrder, nodeFamilyFor } from '../../../apps/api/src/application/evaluation/node-policy-dispatch.js';
import { snapshotTimeMachine } from '../../../apps/api/src/application/books/time-machine-sources.js';
import { TimeMachineDesignService } from '../../../apps/api/src/application/books/time-machine-design-service.js';
import { TimeMachineModelGateway } from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import type { V7EffectiveMember } from '@wenmi/v7-backend';

// MODEL-NODE-EVAL节点策略派工离线验收（合同"上岗与恢复"）：默认关闭逐字节一致/suspended排除/
// 全部暂停诚实受阻/排名重排/review家族候选排除全部writers模型保持异模型。全部离线夹具，不调用真实模型。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));

const fakeMember = (modelId: string): V7EffectiveMember =>
  ({ memberKey: `m-${modelId}`, displayName: modelId, model: { provider: 'test', modelId, plan: 'agent' } }) as V7EffectiveMember;
const policy = (model_profile_key: string, state: 'active' | 'suspended' | 'pending_retest') =>
  ({ model_profile_key, state }) as EvalNodePolicyRow;

function setup() {
  const c = createTestContext(); contexts.push(c);
  const scope = { ownerId: c.config.ownerId, bookId: 'tm-book' };
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId, '测试作者', '2026-09-10', '2026-09-10');
  new BookRepository(c.database).create(scope, '机甲会修仙', '2026-09-10', 'active');
  c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-10')")
    .run(scope.ownerId, scope.bookId, JSON.stringify({ protagonists: ['林舟'], storyDirection: '无灵根修理工建立工坊' }), 'a'.repeat(64));
  return { c, scope, repo: new NodeEvaluationRepository(c.database) };
}

/** 推荐运行最小模拟输出（与time-machine-design.test.ts同一口径），不产生真实模型调用。 */
function output(prompt: string): unknown {
  if (prompt.includes('核对短卡是否')) return { pass: true, issues: [] };
  if (prompt.includes('判断需要哪些方法')) return prompt.includes('上次工具结果（仅资料）：null') ? { action: 'search_methods', category: '', cursor: 0 } : { action: 'ready', selected: [] };
  if (prompt.includes('你是主编，推荐')) return { greeting: '老板，我们现在设计全书骨架', lines: [{ id: 'growth', role: 'main', title: '成长线', description: '林舟建立工坊', recommended: true }], structure: 'single', reason: '聚焦修理工成长' };
  return { fields: { premise: [{ text: '修理工建立工坊', sourceKeys: ['opening:opening:1'] }], protagonists: [{ text: '林舟', sourceKeys: ['opening:opening:1'] }], world: [], openingEnding: [], preferences: [], prohibitions: [] } };
}

describe('nodeFamilyFor节点家族映射（与node-registry口径一致）', () => {
  it('覆盖各家族及:repair/:author-N/:revision-N后缀', () => {
    expect(nodeFamilyFor('card:0')).toBe('card-extract');
    expect(nodeFamilyFor('card:2:repair')).toBe('card-extract');
    expect(nodeFamilyFor('merge:v3:page:0')).toBe('card-merge');
    expect(nodeFamilyFor('merge:v3:1:0')).toBe('card-merge');
    expect(nodeFamilyFor('card-finalize')).toBe('card-finalize');
    expect(nodeFamilyFor('skeleton')).toBe('skeleton');
    expect(nodeFamilyFor('skeleton:author-2')).toBe('skeleton');
    expect(nodeFamilyFor('skeleton:revision-1')).toBe('revise');
    expect(nodeFamilyFor('volume-card:3')).toBe('volume-card');
    expect(nodeFamilyFor('volumes:0')).toBe('volumes-batch');
    expect(nodeFamilyFor('self-check')).toBe('self-check');
    expect(nodeFamilyFor('self-check-anchors')).toBe('self-check-anchors');
    expect(nodeFamilyFor('review-source:author-1')).toBe('review-source');
    expect(nodeFamilyFor('review-source-more:author-1')).toBe('review-source');
    expect(nodeFamilyFor('review-anchors:author-1')).toBe('review-anchors');
    expect(nodeFamilyFor('recommend-with-intent')).toBe('recommend-with-intent');
    expect(nodeFamilyFor('methods:0')).toBe('methods-select');
    expect(nodeFamilyFor('methods:creative:0')).toBe('methods-creative');
  });
});

describe('resolveNodeMember纯函数', () => {
  const candidates = [fakeMember('deepseek-v4-pro'), fakeMember('glm-5.3'), fakeMember('doubao-seed-2.1-turbo')];
  it('默认关闭：无策略无排名，原顺序且policyApplied=false（逐字节一致）', () => {
    const r = resolveNodeMember({ candidates, policies: [], rankedModelIds: null });
    expect(r.member?.model.modelId).toBe('deepseek-v4-pro');
    expect(r.policyApplied).toBe(false);
  });
  it('suspended排除：首选被暂停由候补接替并标记policyApplied', () => {
    const r = resolveNodeMember({ candidates, policies: [policy('deepseek-v4-pro', 'suspended')], rankedModelIds: null });
    expect(r.member?.model.modelId).toBe('glm-5.3');
    expect(r.policyApplied).toBe(true);
    expect(r.reason).toContain('候补接替');
  });
  it('全部暂停：member=null且policyApplied=true（诚实受阻，不回夹具）', () => {
    const r = resolveNodeMember({ candidates, policies: [policy('deepseek-v4-pro', 'suspended'), policy('glm-5.3', 'suspended'), policy('doubao-seed-2.1-turbo', 'suspended')], rankedModelIds: null });
    expect(r.member).toBeNull();
    expect(r.policyApplied).toBe(true);
    expect(r.reason).toContain('暂停派工');
  });
  it('pending_retest不算暂停（复测排队中，不扩大惩罚）', () => {
    const r = resolveNodeMember({ candidates, policies: [policy('deepseek-v4-pro', 'pending_retest')], rankedModelIds: null });
    expect(r.member?.model.modelId).toBe('deepseek-v4-pro');
  });
  it('applied排名重排：第1名承担；第1名被暂停落第2名', () => {
    const ranked = ['doubao-seed-2.1-turbo', 'glm-5.3'];
    expect(resolveNodeMember({ candidates, policies: [], rankedModelIds: ranked }).member?.model.modelId).toBe('doubao-seed-2.1-turbo');
    expect(resolveNodeMember({ candidates, policies: [policy('doubao-seed-2.1-turbo', 'suspended')], rankedModelIds: ranked }).member?.model.modelId).toBe('glm-5.3');
  });
  it('review家族：候选已排除全部编剧模型，排名第1是编剧模型时不得选中（保持异模型）', () => {
    const writerModels = ['deepseek-v4-pro', 'glm-5.3', 'doubao-seed-2.1-turbo'];
    const reviewPool = [fakeMember('glm-5.3-flash'), fakeMember('kimi-k2.7-code')].filter(m => !writerModels.includes(m.model.modelId));
    const ranked = ['deepseek-v4-pro', 'glm-5.3-flash']; // 第1名是编剧模型，不在审查候选内
    const r = resolveNodeMember({ candidates: reviewPool, policies: [], rankedModelIds: ranked });
    expect(r.member?.model.modelId).toBe('glm-5.3-flash');
    expect(writerModels).not.toContain(r.member?.model.modelId);
  });
  it('nodeFallbackOrder：排除暂停，有排名按名次、其余按原顺序', () => {
    const order = nodeFallbackOrder({ candidates, policies: [policy('glm-5.3', 'suspended')], rankedModelIds: ['doubao-seed-2.1-turbo'] });
    expect(order.map(m => m.model.modelId)).toEqual(['doubao-seed-2.1-turbo', 'deepseek-v4-pro']);
  });
});

describe('快照构建写入nodeDispatch（集成）', () => {
  it('默认关闭：无任何策略/排名时快照不带nodeDispatch字段', () => {
    const { c, scope } = setup();
    const snapshot = snapshotTimeMachine(c.database, scope, '', 64000);
    expect('nodeDispatch' in snapshot).toBe(false);
  });
  it('suspended排除：skeleton首选模型被暂停，快照冻结候补成员', () => {
    const { c, scope, repo } = setup();
    repo.upsertNodePolicy('skeleton', 'deepseek-v4-pro', 'suspended', '初筛合同错误率高', null, 'test');
    const snapshot = snapshotTimeMachine(c.database, scope, '', 64000);
    expect(snapshot.nodeDispatch?.skeleton?.model.modelId).toBe('glm-5.3');
  });
  it('全部暂停：快照冻结null受阻标记，不静默回退', () => {
    const { c, scope, repo } = setup();
    for (const modelId of ['deepseek-v4-pro', 'glm-5.3', 'doubao-seed-2.1-turbo']) repo.upsertNodePolicy('skeleton', modelId, 'suspended', '全部待复测', null, 'test');
    const snapshot = snapshotTimeMachine(c.database, scope, '', 64000);
    expect(snapshot.nodeDispatch).toBeDefined();
    expect(snapshot.nodeDispatch?.skeleton).toBeNull();
  });
  it('applied排名重排：第1名承担；第1名暂停落第2名', () => {
    const { c, scope, repo } = setup();
    const rankingId = repo.insertRanking({
      node_key: 'skeleton', length_band: 'all', config_version: 'cfg-test',
      entries_json: JSON.stringify([
        { rank: 1, modelProfileKey: 'doubao-seed-2.1-turbo', modelId: 'doubao-seed-2.1-turbo' },
        { rank: 2, modelProfileKey: 'glm-5.3', modelId: 'glm-5.3' }
      ]),
      evidence_json: '{}', created_by: 'test'
    });
    repo.applyRanking(rankingId);
    expect(snapshotTimeMachine(c.database, scope, '', 64000).nodeDispatch?.skeleton?.model.modelId).toBe('doubao-seed-2.1-turbo');
    repo.upsertNodePolicy('skeleton', 'doubao-seed-2.1-turbo', 'suspended', '验证阶段不稳定', null, 'test');
    expect(snapshotTimeMachine(c.database, scope, '', 64000).nodeDispatch?.skeleton?.model.modelId).toBe('glm-5.3');
  });
});

describe('设计服务派工生效（集成，模拟模型）', () => {
  function makeService(c: TestContext) {
    const calls: { modelId: string; prompt: string }[] = [];
    const gateway = new TimeMachineModelGateway(c.database, (provider, modelId) => ({
      provider, modelId,
      async generate(request: { prompt: string }) {
        calls.push({ modelId, prompt: request.prompt }); // modelId取自网关冻结成员的resolve回调（适配器请求本身不带模型字段）
        return { provider, modelId, output: JSON.stringify(output(request.prompt)), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
      }
    }));
    return { service: new TimeMachineDesignService(c.database, gateway, 64000), calls };
  }
  it('默认关闭：资料提取仍由在岗首选成员承担（现状行为）', async () => {
    const { c, scope } = setup();
    const { service, calls } = makeService(c);
    const id = service.start(scope, 'recommend', '', 'dispatch-default-off');
    await service.process(id);
    expect(service.state(scope).find(r => r.id === id)?.state).toBe('succeeded');
    const extract = calls.filter(call => call.prompt.includes('这可能是一部分资料，未知保持空'));
    expect(extract.length).toBeGreaterThan(0);
    expect(extract.every(call => call.modelId === 'deepseek-v4-pro')).toBe(true);
  });
  it('suspended排除：card-extract首选暂停后，提取调用实际由候补成员承担', async () => {
    const { c, scope, repo } = setup();
    repo.upsertNodePolicy('card-extract', 'deepseek-v4-pro', 'suspended', '初筛不稳定', null, 'test');
    const { service, calls } = makeService(c);
    const id = service.start(scope, 'recommend', '', 'dispatch-suspended');
    await service.process(id);
    expect(service.state(scope).find(r => r.id === id)?.state).toBe('succeeded');
    const extract = calls.filter(call => call.prompt.includes('这可能是一部分资料，未知保持空'));
    expect(extract.length).toBeGreaterThan(0);
    expect(extract.every(call => call.modelId === 'glm-5.3')).toBe(true);
  });
  it('全部暂停：运行诚实失败报暂无合格成员，不发出该节点模型调用', async () => {
    const { c, scope, repo } = setup();
    // 测试名册的审查候选池（chief排除编剧模型后）为空；任一暂停策略即构成全部候选不可用
    repo.upsertNodePolicy('recommend-with-intent', 'glm-5.3', 'suspended', '审查节点待复测', null, 'test');
    const { service, calls } = makeService(c);
    const id = service.start(scope, 'recommend', '', 'dispatch-blocked');
    await service.process(id);
    const row = service.state(scope).find(r => r.id === id);
    expect(row?.state).toBe('failed');
    const errorMessage = String((c.database.prepare('SELECT error_message FROM tm2_design_runs WHERE id=?').get(id) as { error_message: string }).error_message);
    expect(errorMessage).toContain('暂停派工');
    expect(errorMessage).toContain('暂无合格成员');
    expect(calls.some(call => call.prompt.includes('你是主编，推荐'))).toBe(false);
  });
});
