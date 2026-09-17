import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { NodeEvaluationRepository } from '../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { V7NodeEvaluationService } from '../../../apps/api/src/application/agents/v7-node-evaluation-service.js';

// MODEL-NODE-EVAL后台服务离线验证：视图状态分层/排名计算/应用回滚/自动暂停规则。全部离线。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));
function setup(opts?: { rankingStrategyEnabled?: boolean }) {
  const c = createTestContext(); contexts.push(c);
  return { c, repo: new NodeEvaluationRepository(c.database), service: new V7NodeEvaluationService(c.database, opts) };
}
function seedRun(repo: NodeEvaluationRepository, id: string, nodeKey: string, model: string, phase: 'screen' | 'validation', status = 'succeeded') {
  repo.createRun({
    id, batch_id: 'b1', node_key: nodeKey, length_band: 'all', member_role: 'writer', model_profile_key: model,
    provider: 'volcengine-ark-agent-plan', model_id: model, model_plan: 'agent', config_version: `cfg-${phase}-default`,
    prompt_version: 'v1', phase, status, sample_set_id: 's1', planned_cases: 10
  });
}
function seedCase(repo: NodeEvaluationRepository, runId: string, nodeKey: string, model: string, seq: number, configVersion = 'cfg-screen-default', overrides: Partial<Parameters<NodeEvaluationRepository['insertCase']>[0]> = {}) {
  repo.insertCase({
    run_id: runId, node_key: nodeKey, model_profile_key: model, sample_hash: `s${seq}`, attempt_seq: 1,
    genre: '玄幻成长', length_band: 'short', time_slot: 'T1', sample_kind: 'positive', input_hash: `h${seq}`,
    config_version: configVersion, prompt_version: 'v1',
    http_status: 200, outcome: 'ok', technical_ok: 1, contract_ok: 1, quality_pass: 1, quality_note: null,
    judge_source: null, judge_model_id: null, input_tokens: 100, output_tokens: 50, reasoning_tokens: 0,
    usage_known: 1, reserved_tokens: 200, retry_count: 0, queued_at: `2026-09-16T10:${String(seq).padStart(2, '0')}:00Z`,
    started_at: null, finished_at: null, queue_ms: 10, duration_ms: 1000 + seq, error_code: null, artifact_path: null,
    provider_model_version: null, ...overrides
  });
}

describe('后台视图状态分层', () => {
  it('未测/进行中/小样本/合格/不达标/暂停分开，不用空白冒充', () => {
    const { repo, service } = setup();
    // deepseek-v4-pro：10个validation ok→qualified；glm-5.3：2个screen→small_sample；kimi-k3：无case但working run→in_progress
    seedRun(repo, 'rv-pro', 'skeleton', 'deepseek-v4-pro', 'validation');
    for (let i = 0; i < 10; i++) seedCase(repo, 'rv-pro', 'skeleton', 'deepseek-v4-pro', i);
    seedRun(repo, 'rs-glm', 'skeleton', 'glm-5.3', 'screen');
    for (let i = 0; i < 2; i++) seedCase(repo, 'rs-glm', 'skeleton', 'glm-5.3', i);
    seedRun(repo, 'rq-k3', 'skeleton', 'kimi-k3', 'screen', 'working');
    repo.upsertNodePolicy('skeleton', 'doubao-seed-2.1-turbo', 'suspended', '人工暂停', null, 'admin');
    const view = service.adminView().find(v => v.nodeKey === 'skeleton')!;
    const byModel = new Map(view.models.map(m => [m.modelProfileKey, m]));
    expect(byModel.get('deepseek-v4-pro')!.state).toBe('qualified');
    expect(byModel.get('glm-5.3')!.state).toBe('small_sample');
    expect(byModel.get('kimi-k3')!.state).toBe('in_progress');
    expect(byModel.get('doubao-seed-2.1-turbo')!.state).toBe('suspended');
    expect(byModel.get('deepseek-v4-flash')!.state).toBe('untested');
    // 名册7个文字模型全部列出，未测不静默漏项
    expect(view.models).toHaveLength(7);
    expect(view.purpose).toContain('全书骨架');
  });
  it('审查节点视图含植入召回与误报指标', () => {
    const { repo, service } = setup();
    seedRun(repo, 'rv-rev', 'review-source', 'deepseek-v4-pro', 'validation');
    for (let i = 0; i < 5; i++) seedCase(repo, 'rv-rev', 'review-source', 'deepseek-v4-pro', i, 'cfg-validation-default', { sample_kind: 'negative', quality_pass: i < 4 ? 1 : 0 });
    for (let i = 5; i < 10; i++) seedCase(repo, 'rv-rev', 'review-source', 'deepseek-v4-pro', i, 'cfg-validation-default', { sample_kind: 'positive', quality_pass: 1 });
    const view = service.adminView().find(v => v.nodeKey === 'review-source')!;
    const model = view.models.find(m => m.modelProfileKey === 'deepseek-v4-pro')!;
    expect(model.stats!.seededErrorRecall).toBeCloseTo(0.8);
    expect(model.stats!.cleanFalseAlarmRate).toBe(0);
    expect(model.state).toBe('below_threshold'); // 召回<1零漏报不满足
    expect(model.admissionReasons.join()).toContain('漏报');
  });
});

describe('排名计算', () => {
  it('无保留验证样本拒绝生成排名（初筛不称稳定结论）', () => {
    const { repo, service } = setup();
    seedRun(repo, 'rs-only', 'skeleton', 'deepseek-v4-pro', 'screen');
    seedCase(repo, 'rs-only', 'skeleton', 'deepseek-v4-pro', 0);
    expect(() => service.computeRanking('skeleton', 'admin')).toThrowError(/保留验证/);
  });
  it('保留验证≥10生成排名：合格池按Wilson下界排序，证据可复算', () => {
    const { repo, service } = setup();
    seedRun(repo, 'rv-a', 'skeleton', 'deepseek-v4-pro', 'validation');
    seedRun(repo, 'rv-b', 'skeleton', 'glm-5.3', 'validation');
    for (let i = 0; i < 10; i++) {
      seedCase(repo, 'rv-a', 'skeleton', 'deepseek-v4-pro', i, 'cfg-validation-default', { duration_ms: 800 });
      seedCase(repo, 'rv-b', 'skeleton', 'glm-5.3', i, 'cfg-validation-default', { quality_pass: i < 7 ? 1 : 0 });
    }
    const { id, qualifiedTop } = service.computeRanking('skeleton', 'admin');
    expect(qualifiedTop).toBe(1); // glm质量70%不准入
    const ranking = repo.readRanking(id)!;
    expect(ranking.status).toBe('draft');
    const entries = JSON.parse(ranking.entries_json) as { rank: number; modelProfileKey: string }[];
    expect(entries.find(e => e.rank === 1)!.modelProfileKey).toBe('deepseek-v4-pro');
    // 同输入可复算：再算一次条目一致（新修订号）
    const again = service.computeRanking('skeleton', 'admin');
    const e2 = JSON.parse(repo.readRanking(again.id)!.entries_json) as typeof entries;
    expect(e2.map(e => `${e.rank}:${e.modelProfileKey}`)).toEqual(entries.map(e => `${e.rank}:${e.modelProfileKey}`));
  });
});

describe('排名应用与回滚策略同步', () => {
  it('应用写node_policy含rankingRevision；回滚恢复上一版（机制仅隔离显式启用时可用）', () => {
    const { repo, service } = setup({ rankingStrategyEnabled: true });
    seedRun(repo, 'rv-a', 'skeleton', 'deepseek-v4-pro', 'validation');
    seedRun(repo, 'rv-b', 'skeleton', 'glm-5.3-flash', 'validation');
    for (let i = 0; i < 10; i++) {
      seedCase(repo, 'rv-a', 'skeleton', 'deepseek-v4-pro', i, 'cfg-validation-default');
      seedCase(repo, 'rv-b', 'skeleton', 'glm-5.3-flash', i, 'cfg-validation-default');
    }
    const v1 = service.computeRanking('skeleton', 'admin');
    service.applyRanking('admin', v1.id);
    let policies = repo.nodePolicies('skeleton');
    expect(policies.filter(p => p.state === 'active').length).toBe(2);
    expect(policies[0]!.ranking_revision).toBe(1);
    const v2 = service.computeRanking('skeleton', 'admin');
    service.applyRanking('admin', v2.id);
    expect(repo.appliedRanking('skeleton', 'all')!.ranking_revision).toBe(2);
    service.rollbackRanking('admin', v2.id);
    expect(repo.appliedRanking('skeleton', 'all')!.ranking_revision).toBe(1);
    policies = repo.nodePolicies('skeleton');
    expect(policies.every(p => p.ranking_revision === 1)).toBe(true);
  });
  it('S1-FAST-CLOSE：服务端默认禁止应用/回滚排名（实验预览/未验收），且不写任何策略', () => {
    const { repo, service } = setup(); // 生产路由用默认构造=禁止
    seedRun(repo, 'rv-x', 'skeleton', 'deepseek-v4-pro', 'validation');
    for (let i = 0; i < 10; i++) seedCase(repo, 'rv-x', 'skeleton', 'deepseek-v4-pro', i, 'cfg-validation-default');
    const v1 = service.computeRanking('skeleton', 'admin'); // 计算草稿仍允许（只读证据）
    expect(() => service.applyRanking('admin', v1.id)).toThrowError(/实验预览阶段.*禁止应用/);
    expect(() => service.rollbackRanking('admin', v1.id)).toThrowError(/实验预览阶段.*禁止回滚/);
    expect(repo.nodePolicies('skeleton')).toHaveLength(0); // 未写任何策略
    expect(repo.appliedRanking('skeleton', 'all')).toBeUndefined(); // 无applied排名
  });
});

describe('自动暂停规则', () => {
  it('连续3次技术失败→暂停；5次内2次截断→暂停；正常模型不误伤', () => {
    const { repo, service } = setup();
    seedRun(repo, 'rf-a', 'volume-card', 'glm-5.3', 'screen');
    for (let i = 0; i < 3; i++) seedCase(repo, 'rf-a', 'volume-card', 'glm-5.3', i, 'cfg-screen-default', { outcome: 'http_error', technical_ok: 0, quality_pass: null });
    seedRun(repo, 'rf-b', 'volume-card', 'deepseek-v4-flash', 'screen');
    for (let i = 0; i < 5; i++) seedCase(repo, 'rf-b', 'volume-card', 'deepseek-v4-flash', i, 'cfg-screen-default', { outcome: i < 2 ? 'truncated' : 'ok', technical_ok: i < 2 ? 0 : 1, quality_pass: i < 2 ? null : 1 });
    seedRun(repo, 'rf-c', 'volume-card', 'deepseek-v4-pro', 'screen');
    for (let i = 0; i < 5; i++) seedCase(repo, 'rf-c', 'volume-card', 'deepseek-v4-pro', i);
    const suspended = service.evaluateSuspensionRules('admin');
    const keys = suspended.map(s => s.modelProfileKey).toSorted();
    expect(keys).toEqual(['deepseek-v4-flash', 'glm-5.3']);
    expect(repo.suspendedModels('volume-card').toSorted()).toEqual(['deepseek-v4-flash', 'glm-5.3']);
  });
});

describe('手工策略', () => {
  it('必须填原因；未登记节点拒绝', () => {
    const { repo, service } = setup();
    expect(() => service.setNodePolicy('admin', 'skeleton', 'glm-5.3', 'suspended', '')).toThrowError(/原因/);
    expect(() => service.setNodePolicy('admin', 'no-such-node', 'glm-5.3', 'suspended', 'x')).toThrowError(/未登记/);
    service.setNodePolicy('admin', 'skeleton', 'glm-5.3', 'pending_retest', '复测排队');
    expect(repo.nodePolicies('skeleton')[0]!.state).toBe('pending_retest');
  });
});
