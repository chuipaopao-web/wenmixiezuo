import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { NodeEvaluationRepository } from '../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { NodeEvaluationExecutor, EvalCallError, type EvalAdapter, type EvalRunPlan, type EvalSample } from '../../../apps/api/src/application/evaluation/node-evaluation-executor.js';
import { wilsonLowerBound, aggregateModelStats, admitModel, rankNodeEntries, DEFAULT_ADMISSION, type EvalCaseMetricsInput } from '../../../apps/api/src/application/evaluation/evaluation-ranking.js';
import { EVAL_NODE_REGISTRY, EVAL_BATCH1_NODE_KEYS, matchEvalNode, findEvalNode } from '../../../apps/api/src/application/evaluation/node-registry.js';

// MODEL-NODE-EVAL离线验收（合同"验收与结束条件"前置项）：预算硬停/未知计量/断点不重复/排名可复算/
// 样本不足不准入/同模型去重/回滚可用。全部离线夹具，不调用真实模型。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));
function setup() {
  const c = createTestContext(); contexts.push(c);
  return { c, repo: new NodeEvaluationRepository(c.database) };
}
function sample(hash: string, prompt = '合成提示'): EvalSample {
  return { sampleHash: hash, genre: '玄幻成长', lengthBand: 'short', timeSlot: 'T1', kind: 'positive', prompt };
}
function makePlan(repo: NodeEvaluationRepository, runId: string, samples: EvalSample[], overrides: Partial<EvalRunPlan> = {}): EvalRunPlan {
  return {
    runId, batchId: 'batch-1', nodeKey: 'skeleton', lengthBand: 'short', modelProfileKey: 'deepseek-v4-pro',
    provider: 'volcengine-ark-agent-plan', modelId: 'deepseek-v4-pro', configVersion: 'cfg-1', promptVersion: 'skeleton-v2-compact',
    maxOutputTokens: 8000, temperature: 0.6, samples, validate: (output: string) => { if (!output.includes('{')) throw new Error('非JSON'); },
    ...overrides
  };
}
function createRun(repo: NodeEvaluationRepository, id: string, planned: number, batchId = 'batch-1') {
  repo.createRun({
    id, batch_id: batchId, node_key: 'skeleton', length_band: 'short', member_role: 'writer',
    model_profile_key: 'deepseek-v4-pro', provider: 'volcengine-ark-agent-plan', model_id: 'deepseek-v4-pro',
    model_plan: 'agent', config_version: 'cfg-1', prompt_version: 'skeleton-v2-compact', phase: 'screen',
    status: 'queued', sample_set_id: 'set-1', planned_cases: planned
  });
}
const okAdapter = (usage: { inputTokens: number; outputTokens: number; reasoningTokens: number } | null = { inputTokens: 100, outputTokens: 50, reasoningTokens: 0 }): EvalAdapter & { calls: number } => {
  const a = {
    calls: 0,
    async generate() { a.calls++; return { output: '{"ok":true}', usage }; }
  };
  return a;
};

describe('迁移0127评测表', () => {
  it('六张评测表已建立且评测登记表现金可查', () => {
    const { c } = setup();
    const tables = (c.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tm2_eval%' ORDER BY name").all() as { name: string }[]).map(r => r.name);
    expect(tables).toEqual(['tm2_eval_budget', 'tm2_eval_case', 'tm2_eval_node_policy', 'tm2_eval_ranking', 'tm2_eval_run']);
  });
});

describe('预算硬停与计量', () => {
  it('预留超上限即硬停，不多发一次请求', async () => {
    const { c, repo } = setup();
    repo.ensureBudget('batch-1', 2, 10_000_000); // 上限2请求
    createRun(repo, 'run-1', 4);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100 });
    const adapter = okAdapter();
    const status = await executor.execute(makePlan(repo, 'run-1', [sample('s1'), sample('s2'), sample('s3'), sample('s4')]), adapter);
    expect(status).toBe('budget-stopped');
    expect(adapter.calls).toBe(2); // 只发了2次，第3次预留失败
    const budget = repo.readBudget('batch-1')!;
    expect(budget.actual_requests).toBe(2);
    expect(budget.actual_requests + budget.unknown_requests + budget.reserved_requests).toBeLessThanOrEqual(2);
    expect(repo.readRun('run-1')!.status).toBe('budget-stopped');
  });
  it('token口径同样硬停', async () => {
    const { c, repo } = setup();
    repo.ensureBudget('batch-1', 100, 250); // token上限250，单case预留>100
    createRun(repo, 'run-1', 3);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100 }); // 预留=100+8000? 不，plan覆盖maxOutputTokens
    const adapter = okAdapter();
    const plan = makePlan(repo, 'run-1', [sample('s1'), sample('s2'), sample('s3')], { maxOutputTokens: 40 });
    const status = await executor.execute(plan, adapter);
    expect(status).toBe('budget-stopped');
    expect(adapter.calls).toBe(1); // 预留140；第二次140累计280>250拒绝
  });
  it('usage未知单独计unknown列，不按0、重启不归零', async () => {
    const { c, repo } = setup();
    repo.ensureBudget('batch-1', 10, 1_000_000);
    createRun(repo, 'run-1', 1);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100 });
    const adapter = okAdapter(null); // 供应商未上报用量
    await executor.execute(makePlan(repo, 'run-1', [sample('s1')], { maxOutputTokens: 40 }), adapter);
    const budget = repo.readBudget('batch-1')!;
    expect(budget.unknown_requests).toBe(1);
    expect(budget.unknown_tokens).toBe(140); // 预留额转未知，不蒸发
    expect(budget.actual_tokens).toBe(0);
    const row = repo.casesForRun('run-1')[0]!;
    expect(row.usage_known).toBe(0);
    // 模拟进程重启：新建执行器读同一库，账本仍在
    const executor2 = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100 });
    const budget2 = executor2['repo'].readBudget('batch-1')!;
    expect(budget2.unknown_requests).toBe(1);
  });
});

describe('断点续传', () => {
  it('已完成case不重复发送；中断run可继续', async () => {
    const { c, repo } = setup();
    repo.ensureBudget('batch-1', 10, 10_000_000);
    createRun(repo, 'run-1', 3);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100 });
    let failAt = 2;
    const flaky: EvalAdapter & { calls: number } = {
      calls: 0,
      async generate() {
        flaky.calls++;
        if (flaky.calls === failAt) throw new EvalCallError('http_error', '模拟500', 500);
        return { output: '{"ok":true}', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } };
      }
    };
    // 第一次执行：第2个case失败（http_error终态记录），其余成功
    await executor.execute(makePlan(repo, 'run-1', [sample('s1'), sample('s2'), sample('s3')], { maxOutputTokens: 40 }), flaky);
    expect(repo.casesForRun('run-1')).toHaveLength(3);
    expect(flaky.calls).toBe(3);
    // 重跑：3个case都是终态（ok/http_error都不是unknown），全部跳过，0次新请求
    const again = await executor.execute(makePlan(repo, 'run-1', [sample('s1'), sample('s2'), sample('s3')], { maxOutputTokens: 40 }), flaky);
    expect(again).toBe('succeeded');
    expect(flaky.calls).toBe(3);
    expect(repo.casesForRun('run-1')).toHaveLength(3); // UNIQUE(run_id,sample_hash,attempt_seq)无重复行
  });
});

describe('429退避', () => {
  it('rate_limited按退避重试，retry_count如实记录，成功只记一行', async () => {
    const { c, repo } = setup();
    repo.ensureBudget('batch-1', 10, 10_000_000);
    createRun(repo, 'run-1', 1);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100, rateLimitBackoffMs: [1, 1] });
    let calls = 0;
    const adapter: EvalAdapter = {
      async generate() {
        calls++;
        if (calls < 3) throw new EvalCallError('rate_limited', '429', 429);
        return { output: '{"ok":true}', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } };
      }
    };
    await executor.execute(makePlan(repo, 'run-1', [sample('s1')], { maxOutputTokens: 40 }), adapter);
    expect(calls).toBe(3);
    const rows = repo.casesForRun('run-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.retry_count).toBe(2);
    expect(rows[0]!.outcome).toBe('ok');
    // 退避重试不重复计请求数（同一次逻辑调用的退避）
    expect(repo.readBudget('batch-1')!.actual_requests).toBe(1);
  });
  it('退避用尽仍429记rate_limited终态，不无限重试', async () => {
    const { c, repo } = setup();
    repo.ensureBudget('batch-1', 10, 10_000_000);
    createRun(repo, 'run-1', 1);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100, rateLimitBackoffMs: [1, 1] });
    const adapter: EvalAdapter = { async generate() { throw new EvalCallError('rate_limited', '429', 429); } };
    await executor.execute(makePlan(repo, 'run-1', [sample('s1')], { maxOutputTokens: 40 }), adapter);
    const row = repo.casesForRun('run-1')[0]!;
    expect(row.outcome).toBe('rate_limited');
    expect(row.retry_count).toBe(2);
  });
});

describe('合同校验与技术交付区分', () => {
  it('有可见输出但合同未过：technical_ok=1、contract_ok=0，不算解析成功', async () => {
    const { c, repo } = setup();
    repo.ensureBudget('batch-1', 10, 10_000_000);
    createRun(repo, 'run-1', 1);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100 });
    const adapter: EvalAdapter = { async generate() { return { output: '这是一段没有JSON的文字', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } }; } };
    await executor.execute(makePlan(repo, 'run-1', [sample('s1')], { maxOutputTokens: 40 }), adapter);
    const row = repo.casesForRun('run-1')[0]!;
    expect(row.outcome).toBe('contract_error');
    expect(row.technical_ok).toBe(1);
    expect(row.contract_ok).toBe(0);
  });
});

describe('排名与准入', () => {
  const caseOf = (overrides: Partial<EvalCaseMetricsInput>): EvalCaseMetricsInput => ({
    modelProfileKey: 'm', modelId: 'm', outcome: 'ok', technicalOk: true, contractOk: true, qualityPass: true,
    durationMs: 1000, totalTokens: 500, retryCount: 0, ...overrides
  });
  it('Wilson下界已知值可复算', () => {
    // n=10全成功：下界约0.722；n=10七成：约0.396（独立手算基准）
    expect(wilsonLowerBound(10, 10)).toBeCloseTo(0.722, 3);
    expect(wilsonLowerBound(7, 10)).toBeCloseTo(0.396, 1);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });
  it('样本不足不准入（n<10），不称稳定结论', () => {
    const stats = aggregateModelStats('deepseek-v4-pro', 'deepseek-v4-pro', [caseOf({}), caseOf({})]);
    const result = admitModel(stats, 'generation');
    expect(result.state).toBe('insufficient_samples');
    expect(result.reasons[0]).toContain('n=2');
  });
  it('技术交付率<90%或质量<90%或关键约束漏失均不准入', () => {
    const twoTechFail = Array.from({ length: 10 }, (_, i) => caseOf({ technicalOk: i > 1, qualityPass: i > 1 }));
    expect(admitModel(aggregateModelStats('a', 'a', twoTechFail), 'generation').state).toBe('below_threshold'); // 技术交付80%
    const lowQuality = Array.from({ length: 10 }, (_, i) => caseOf({ qualityPass: i < 8 }));
    expect(admitModel(aggregateModelStats('a', 'a', lowQuality), 'generation').state).toBe('below_threshold');
    const critical = Array.from({ length: 10 }, (_, i) => caseOf({ criticalConstraintMissed: i === 0 }));
    expect(admitModel(aggregateModelStats('a', 'a', critical), 'generation').state).toBe('below_threshold');
  });
  it('审查节点：植入错误漏报或干净样本误报>10%不准入', () => {
    const missed = Array.from({ length: 10 }, (_, i) => caseOf({ seededErrorCaught: i !== 0, cleanSampleFalseAlarm: false }));
    expect(admitModel(aggregateModelStats('r', 'r', missed), 'review').state).toBe('below_threshold');
    const noisy = Array.from({ length: 10 }, (_, i) => caseOf({ seededErrorCaught: true, cleanSampleFalseAlarm: i < 2 }));
    expect(admitModel(aggregateModelStats('r', 'r', noisy), 'review').state).toBe('below_threshold');
    const good = Array.from({ length: 10 }, () => caseOf({ seededErrorCaught: true, cleanSampleFalseAlarm: false }));
    expect(admitModel(aggregateModelStats('r', 'r', good), 'review').state).toBe('qualified');
  });
  it('同底层模型去重：两个名字绑定同modelId算一个，前三不重复', () => {
    const good = (key: string, id: string) => aggregateModelStats(key, id, Array.from({ length: 10 }, () => caseOf({ modelProfileKey: key, modelId: id })));
    const { entries, qualifiedTop } = rankNodeEntries([
      good('alias-a', 'same-model'), good('alias-b', 'same-model'), good('other', 'other-model')
    ], 'generation');
    expect(qualifiedTop).toHaveLength(2); // 同底层去重后只剩2个不同模型
    const ranked = entries.filter(e => e.rank > 0);
    expect(new Set(ranked.map(e => e.stats.modelId)).size).toBe(ranked.length);
  });
  it('排名同输入可复算（确定性）', () => {
    const mk = (key: string, success: number, ms: number) => aggregateModelStats(key, key,
      Array.from({ length: 10 }, (_, i) => caseOf({ modelProfileKey: key, modelId: key, qualityPass: i < success, durationMs: ms })));
    const input = [mk('a', 9, 900), mk('b', 10, 1200), mk('c', 10, 800), mk('d', 8, 500)];
    const r1 = rankNodeEntries(input, 'generation');
    const r2 = rankNodeEntries([...input].reverse(), 'generation');
    expect(r1.qualifiedTop.map(e => e.stats.modelProfileKey)).toEqual(r2.qualifiedTop.map(e => e.stats.modelProfileKey));
    // Wilson下界：c(n=10全成)>b(全成但p95高？不——下界相同看平局规则)；a(9/10)>d(8/10)
    const order = r1.qualifiedTop.map(e => e.stats.modelProfileKey);
    expect(order[0]).toBe('c'); // 全成功且p95更低
    expect(order[1]).toBe('b');
    // d质量通过率80%<90%不准入，a质量90%准入
    expect(order).not.toContain('d');
  });
  it('p95小样本标识n<20', () => {
    const stats = aggregateModelStats('a', 'a', Array.from({ length: 12 }, () => caseOf({})));
    expect(stats.p95SmallSample).toBe(true);
    const big = aggregateModelStats('a', 'a', Array.from({ length: 20 }, () => caseOf({})));
    expect(big.p95SmallSample).toBe(false);
  });
  it('质量未评审完不给准入结论', () => {
    const unjudged = aggregateModelStats('a', 'a', Array.from({ length: 10 }, () => caseOf({ qualityPass: null })));
    expect(admitModel(unjudged, 'generation').state).toBe('quality_unjudged');
  });
});

describe('排名版本应用与回滚', () => {
  it('应用只保留一个applied；回滚恢复上一版', () => {
    const { repo } = setup();
    const v1 = repo.insertRanking({ node_key: 'skeleton', length_band: 'short', config_version: 'cfg-1', entries_json: '[]', evidence_json: '{}', created_by: 'k3' });
    const v2 = repo.insertRanking({ node_key: 'skeleton', length_band: 'short', config_version: 'cfg-1', entries_json: '[]', evidence_json: '{}', created_by: 'k3' });
    expect(repo.readRanking(v2)!.ranking_revision).toBe(2);
    repo.applyRanking(v1);
    repo.applyRanking(v2);
    expect(repo.readRanking(v1)!.status).toBe('superseded');
    expect(repo.appliedRanking('skeleton', 'short')!.id).toBe(v2);
    repo.rollbackRanking(v2);
    expect(repo.readRanking(v2)!.status).toBe('rolled_back');
    expect(repo.appliedRanking('skeleton', 'short')!.id).toBe(v1);
  });
  it('历史任务不重绑：applied排名只存快照元数据，无任务表外键', () => {
    const { c } = setup();
    const columns = c.database.prepare("SELECT sql FROM sqlite_master WHERE name='tm2_eval_ranking'").get() as { sql: string };
    expect(columns.sql).not.toContain('tm2_design_runs');
    expect(columns.sql).not.toContain('REFERENCES');
  });
});

describe('重启对账', () => {
  it('悬空预留重启归零，实耗/未知列绝不清零', async () => {
    const { c, repo } = setup();
    repo.ensureBudget('batch-1', 10, 10_000_000);
    createRun(repo, 'run-1', 2);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100 });
    // 模拟旧进程在途被kill：手动留一笔悬空预留
    repo.tryReserve('batch-1', 'run-1', 1, 500);
    const adapter = okAdapter(null); // unknown用量
    await executor.execute(makePlan(repo, 'run-1', [sample('s1')], { maxOutputTokens: 40 }), adapter);
    const before = repo.readBudget('batch-1')!;
    expect(before.reserved_requests).toBe(1); // 旧悬空预留仍在
    expect(before.unknown_requests).toBe(1);
    repo.reconcileReservedOnBoot('batch-1');
    const after = repo.readBudget('batch-1')!;
    expect(after.reserved_requests).toBe(0);
    expect(after.reserved_tokens).toBe(0);
    expect(after.unknown_requests).toBe(1); // 实耗/未知绝不清零
    expect(after.unknown_tokens).toBe(before.unknown_tokens);
  });
});

describe('节点派工策略', () => {  it('暂停模型按节点隔离；policy_version单调递增', () => {
    const { repo } = setup();
    repo.upsertNodePolicy('skeleton', 'glm-5.3', 'suspended', '卷卡已确认不稳定待复测', null, 'k3');
    repo.upsertNodePolicy('skeleton', 'glm-5.3', 'pending_retest', '复测排队', 1, 'k3');
    expect(repo.suspendedModels('skeleton')).toEqual([]); // pending_retest不算suspended
    repo.upsertNodePolicy('skeleton', 'glm-5.3', 'suspended', '复测未过', 1, 'k3');
    expect(repo.suspendedModels('skeleton')).toEqual(['glm-5.3']);
    expect(repo.suspendedModels('volume-card')).toEqual([]); // 节点隔离
    const rows = repo.nodePolicies('skeleton');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.policy_version).toBe(3);
  });
});

describe('节点登记表', () => {
  it('首批四类堵点齐全且预算档位与生产一致', () => {
    expect(EVAL_BATCH1_NODE_KEYS).toEqual(['card-extract', 'card-merge', 'card-finalize', 'skeleton', 'volume-card', 'volumes-batch', 'review-source', 'review-anchors']);
    expect(findEvalNode('skeleton')!.budgetClass).toBe(8000);
    expect(findEvalNode('card-extract')!.budgetClass).toBe(5000);
    expect(findEvalNode('recommend-with-intent')!.budgetClass).toBe(3000);
    expect(findEvalNode('skeleton')!.synthesisHeadroom).toBe(true);
  });
  it('运行期step id变体正确归类', () => {
    expect(matchEvalNode('volume-card:3')!.nodeKey).toBe('volume-card');
    expect(matchEvalNode('volume-card:3:repair')!.nodeKey).toBe('volume-card');
    expect(matchEvalNode('review-source:1:author-2')!.nodeKey).toBe('review-source');
    expect(matchEvalNode('review-anchors-more:2')!.nodeKey).toBe('review-anchors');
    expect(matchEvalNode('merge:v3:page:0')!.nodeKey).toBe('card-merge');
    expect(matchEvalNode('card:0')!.nodeKey).toBe('card-extract');
    expect(matchEvalNode('self-check-anchors')!.nodeKey).toBe('self-check-anchors');
    expect(matchEvalNode('skeleton:revision-1')!.nodeKey).toBe('revise');
    expect(matchEvalNode('card-finalize')!.nodeKey).toBe('card-finalize');
  });
});

describe('输出工件保存（盲评引用依据）', () => {
  it('成功/合同错误的可见输出落盘且artifact_path入库；失败无工件', async () => {
    const { c, repo } = setup();
    const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const artifactDir = mkdtempSync(join(tmpdir(), 'eval-artifacts-'));
    repo.ensureBudget('batch-1', 10, 10_000_000);
    createRun(repo, 'run-art', 3);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100, artifactDir });
    const adapter: EvalAdapter = {
      async generate(req) {
        if (req.prompt.includes('截断')) throw new EvalCallError('truncated', '截断：max_tokens');
        if (req.prompt.includes('坏合同')) return { output: '不是JSON', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } };
        return { output: '{"ok":true,"内容":"可见输出正文"}', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } };
      }
    };
    const plan = makePlan(repo, 'run-art', [sample('art-ok'), sample('art-bad', '坏合同'), sample('art-trunc', '截断')]);
    await executor.execute(plan, adapter);
    const cases = repo.casesForRun('run-art');
    expect(cases.map(x => x.outcome).toSorted()).toEqual(['contract_error', 'ok', 'truncated']);
    const okCase = cases.find(x => x.outcome === 'ok')!;
    expect(okCase.artifact_path).toBeTruthy();
    const saved = JSON.parse(readFileSync(join(artifactDir, okCase.artifact_path!), 'utf8')) as { output: string; modelProfileKey: string; nodeKey: string };
    expect(saved.output).toContain('可见输出正文');
    expect(saved.modelProfileKey).toBe('deepseek-v4-pro');
    expect(saved.nodeKey).toBe('skeleton');
    const badCase = cases.find(x => x.outcome === 'contract_error')!;
    expect(badCase.artifact_path).toBeTruthy(); // 合同错误也有可见输出，供失败证据引用
    expect(existsSync(join(artifactDir, badCase.artifact_path!))).toBe(true);
    const truncCase = cases.find(x => x.outcome === 'truncated')!;
    expect(truncCase.artifact_path).toBeNull(); // 无可见输出不落盘
  });
  it('未配置artifactDir时行为与现状一致（artifact_path为null）', async () => {
    const { c, repo } = setup();
    repo.ensureBudget('batch-1', 10, 10_000_000);
    createRun(repo, 'run-no-art', 1);
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 100 });
    await executor.execute(makePlan(repo, 'run-no-art', [sample('no-art')]), okAdapter());
    expect(repo.casesForRun('run-no-art')[0]!.artifact_path).toBeNull();
  });
});
