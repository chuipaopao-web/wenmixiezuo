import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { NodeEvaluationRepository } from '../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { buildJudgePrompt, parseJudgeVerdict, judgePoolFor, loadJudgmentInput, buildCalibrationCases, shouldSpotCheck, SPOT_CHECK_EVERY, CALIBRATION_CONFIG_ID } from '../../../apps/api/src/application/evaluation/eval-judge.js';
import { buildFixture } from '../../../apps/api/src/application/evaluation/eval-sample-factory.js';
import type { EvalCaseRow } from '../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';

// MODEL-NODE-EVAL盲评离线验证：提示不泄露候选模型身份/结论解析/评审池排除本案例模型/复核排除主评/取数与写回。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));
function setup() {
  const c = createTestContext(); contexts.push(c);
  return { c, repo: new NodeEvaluationRepository(c.database) };
}
function seedCase(repo: NodeEvaluationRepository, overrides: { phase?: string; nodeKey?: string; outcome?: string; artifact?: string | null; judgeSource?: string | null } = {}): { caseId: string; runId: string } {
  const runId = `run-${overrides.phase ?? 'validation'}-${Math.random().toString(36).slice(2, 8)}`;
  repo.createRun({
    id: runId, batch_id: 'batch-j', node_key: overrides.nodeKey ?? 'skeleton', length_band: 'all', member_role: 'writer',
    model_profile_key: 'deepseek-v4-pro', provider: 'volcengine-ark-agent-plan', model_id: 'deepseek-v4-pro',
    model_plan: 'agent', config_version: 'cfg-validation-default', prompt_version: 'skeleton-v2-compact',
    phase: overrides.phase ?? 'validation', status: 'succeeded', sample_set_id: 'set-1', planned_cases: 1
  });
  const caseId = repo.insertCase({
    run_id: runId, node_key: overrides.nodeKey ?? 'skeleton', model_profile_key: 'deepseek-v4-pro',
    sample_hash: 'h1', attempt_seq: 1, genre: '玄幻成长', length_band: 'medium', time_slot: 'T1', sample_kind: 'positive',
    input_hash: 'ih', config_version: 'cfg-validation-default', prompt_version: 'skeleton-v2-compact', http_status: 200,
    outcome: overrides.outcome ?? 'ok', technical_ok: 1, contract_ok: 1, quality_pass: null, quality_note: null,
    judge_source: overrides.judgeSource ?? null, judge_model_id: null,
    input_tokens: 10, output_tokens: 20, reasoning_tokens: 0, usage_known: 1, reserved_tokens: 100, retry_count: 0,
    queued_at: '2026-09-16T00:00:00Z', started_at: '2026-09-16T00:00:01Z', finished_at: '2026-09-16T00:00:02Z',
    queue_ms: 1000, duration_ms: 1000, error_code: null, artifact_path: overrides.artifact === undefined ? 'a.json' : overrides.artifact,
    provider_model_version: null
  });
  return { caseId, runId };
}

describe('盲评提示与结论解析', () => {
  const fixture = buildFixture('玄幻成长', 'medium');
  it('提示不泄露候选模型身份且含量规与作者故事线', () => {
    for (const modelId of ['deepseek-v4-pro', 'glm-5.3', 'kimi-k3', 'doubao-seed-2.1-turbo', 'glm-5.3-flash', 'kimi-k2.7-code', 'deepseek-v4-flash']) {
      expect(buildJudgePrompt('skeleton', fixture, '{"structure":"x"}')).not.toContain(modelId);
    }
    const prompt = buildJudgePrompt('skeleton', fixture, '{"structure":"x"}');
    expect(prompt).toContain('独立文学评审');
    expect(prompt).toContain('评审要点');
    for (const line of fixture.authorStorylines) expect(prompt).toContain(line.title);
    expect(buildJudgePrompt('volume-card', fixture, '{}')).toContain('具体事件');
    expect(buildJudgePrompt('card-extract', fixture, '{}')).toContain('忠于所给资料');
  });
  it('评审资料口径与候选实际所见对齐（防资料错配误判）', () => {
    // card-extract：候选只见开篇/设定分页，评审不得拿意图页与故事线标题判"遗漏"
    const extractPrompt = buildJudgePrompt('card-extract', fixture, '{}');
    expect(extractPrompt).not.toContain('intent:author:1');
    expect(extractPrompt).not.toContain('不虐主');
    for (const line of fixture.authorStorylines) expect(extractPrompt).not.toContain(line.title);
    expect(extractPrompt).toContain('候选从未见过');
    // card-finalize：任务禁止把故事方向放偏好栏，评审不得反向要求
    const finalizePrompt = buildJudgePrompt('card-finalize', fixture, '{}');
    expect(finalizePrompt).toContain('不得把故事方向误放为风格偏好');
    expect(finalizePrompt).toContain('intent:author:1');
    // card-merge：评审资料是分页短卡内容而非原始全文（原始分页正文含"档扩写第"扩写标记，短卡字段不含）
    const mergePrompt = buildJudgePrompt('card-merge', fixture, '{}');
    expect(mergePrompt).toContain('cardFields');
    expect(mergePrompt).not.toContain('档扩写第');
    // skeleton/volume：全量资料+故事线标题（候选所见一致）
    expect(buildJudgePrompt('skeleton', fixture, '{}')).toContain('intent:author:1');
    for (const line of fixture.authorStorylines) expect(buildJudgePrompt('volumes-batch', fixture, '{}')).toContain(line.title);
  });
  it('结论解析：pass/fail合法；非JSON/缺字段/无理由判false均拒绝', () => {
    expect(parseJudgeVerdict('{"pass":true,"issues":[]}').pass).toBe(true);
    expect(parseJudgeVerdict('前文噪音{"pass":false,"issues":["转折是空话"]}').issues).toEqual(['转折是空话']);
    expect(() => parseJudgeVerdict('不是JSON')).toThrowError();
    expect(() => parseJudgeVerdict('{"pass":"yes","issues":[]}')).toThrowError();
    expect(() => parseJudgeVerdict('{"pass":false,"issues":[]}')).toThrowError('判false必须给出具体问题');
  });
  it('评审池：排除本案例模型；复核再排除主评审；名册即全部排除时返回null', () => {
    const roster = ['deepseek-v4-pro', 'glm-5.3-flash', 'doubao-seed-2.1-turbo'];
    expect(judgePoolFor('deepseek-v4-pro', roster, 0)).toBe('glm-5.3-flash');
    expect(judgePoolFor('deepseek-v4-pro', roster, 1)).toBe('doubao-seed-2.1-turbo');
    expect(judgePoolFor('deepseek-v4-pro', roster, 0, 'glm-5.3-flash')).toBe('doubao-seed-2.1-turbo');
    expect(judgePoolFor('glm-5.3-flash', ['glm-5.3-flash'], 0)).toBeNull();
  });
});

describe('评审取数与写回（仓储）', () => {
  it('只取validation阶段生成节点ok且有工件未评审case', () => {
    const { repo } = setup();
    const target = seedCase(repo); // validation + skeleton + ok + artifact
    seedCase(repo, { phase: 'screen' }); // 阶段不符
    seedCase(repo, { nodeKey: 'review-source' }); // 审查节点走机检信号
    seedCase(repo, { outcome: 'contract_error' }); // 结构未过不评
    seedCase(repo, { artifact: null }); // 无工件
    seedCase(repo, { judgeSource: 'blind-v1' }); // 已评审
    const pending = repo.casesNeedingJudgment();
    expect(pending.map(p => p.id)).toEqual([target.caseId]);
  });
  it('写回评审结论后不再进入待评取数；分歧null与复核模型串原样保存', () => {
    const { repo } = setup();
    const { caseId, runId } = seedCase(repo);
    repo.setCaseJudgment(caseId, { quality_pass: null, quality_note: '评审分歧（a判不过/b判过）：x', judge_source: 'blind-v1(t=0.2,max=2000)', judge_model_id: 'glm-5.3-flash+doubao-seed-2.1-turbo' });
    expect(repo.casesNeedingJudgment()).toHaveLength(0);
    const row = repo.casesForRun(runId)[0]!;
    expect(row.quality_pass).toBeNull();
    expect(row.judge_model_id).toBe('glm-5.3-flash+doubao-seed-2.1-turbo');
    expect(row.quality_note).toContain('评审分歧');
  });
});

describe('评审输入加载', () => {
  it('读取工件输出并确定性重建fixture；工件缺失/损坏返回null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'judge-input-'));
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ output: '{"structure":"四幕"}' }), 'utf8');
    writeFileSync(join(dir, 'bad.json'), '不是JSON', 'utf8');
    const base = { artifact_path: 'ok.json', genre: '玄幻成长', length_band: 'medium' } as EvalCaseRow;
    const loaded = loadJudgmentInput(dir, base);
    expect(loaded?.output).toBe('{"structure":"四幕"}');
    expect(loaded?.fixture.authorStorylines.length).toBeGreaterThanOrEqual(2);
    expect(loadJudgmentInput(dir, { ...base, artifact_path: 'missing.json' })).toBeNull();
    expect(loadJudgmentInput(dir, { ...base, artifact_path: 'bad.json' })).toBeNull();
    expect(loadJudgmentInput(dir, { ...base, artifact_path: null })).toBeNull();
  });
});

describe('主判通过抽查（防误放）', () => {
  it('按序号确定性每3抽1，可复现', () => {
    expect(SPOT_CHECK_EVERY).toBe(3);
    expect([0, 1, 2, 3, 4, 5, 6].map(shouldSpotCheck)).toEqual([true, false, false, true, false, false, true]);
    // 抽查与评审池轮换用同一序号：judgePoolFor(index+1)取到的复核模型必异于主评审（排除参数生效）
    const roster = ['a', 'b', 'c', 'd'];
    for (const index of [0, 3, 6, 9]) {
      const primary = judgePoolFor('x', roster, index);
      const checker = judgePoolFor('x', roster, index + 1, primary ?? undefined);
      expect(checker).not.toBe(primary);
    }
  });
});

describe('评审可靠性校准样本', () => {
  const fixture = buildFixture('玄幻成长', 'medium');
  it('三探针：已知正确应判过、两类量规下已知缺陷应判不过', () => {
    const cases = buildCalibrationCases(fixture);
    expect(cases.map(c => c.label)).toEqual(['clean-skeleton', 'flawed-skeleton', 'flawed-volume']);
    expect(cases.map(c => c.expectPass)).toEqual([true, false, false]);
    const flawed = cases.filter(c => !c.expectPass);
    for (const probe of flawed) {
      expect(probe.seededErrors).toEqual(fixture.seededErrors);
      expect(probe.seededErrors.length).toBeGreaterThanOrEqual(3);
    }
    // 校准提示仍是盲评提示：不含任何模型身份；clean与flawed输出不同
    for (const probe of cases) {
      for (const modelId of ['deepseek-v4-pro', 'glm-5.3', 'kimi-k3', 'doubao-seed-2.1-turbo']) expect(probe.prompt).not.toContain(modelId);
    }
    expect(cases[0]!.prompt).not.toBe(cases[1]!.prompt);
    expect(CALIBRATION_CONFIG_ID).toContain('calibration');
  });
  it('校准样本植入的错误真实存在于flawedPlan输出中', () => {
    const flawedPrompt = buildCalibrationCases(fixture)[1]!.prompt;
    // 锚点“主角已经获得全城认可”（将来承诺当已达成）必须出现在评审可见输出里，否则探针失效
    expect(flawedPrompt).toContain('主角已经获得全城认可');
    expect(buildCalibrationCases(fixture)[0]!.prompt).not.toContain('主角已经获得全城认可');
  });
  it('干净方案两卷真实承接作者确认对抗线；缺陷方案第二卷无任何职责（防探针自身失真）', () => {
    const cleanVolumes = fixture.cleanPlan.volumes as { duties: { lineId: string }[] }[];
    expect(cleanVolumes).toHaveLength(2);
    for (const v of cleanVolumes) {
      const lineIds = v.duties.map(d => d.lineId);
      expect(lineIds).toContain('main');
      expect(lineIds).toContain('rival'); // 作者明确要求对抗线全书贯穿：clean必须承接，否则评审按量规判不过=探针失真
    }
    const flawedVolumes = fixture.flawedPlan.volumes as { duties: { lineId: string }[] }[];
    expect(flawedVolumes[1]!.duties).toHaveLength(0); // seededError②：对抗线（及主线）第二卷无去向
    expect(flawedVolumes[0]!.duties.map(d => d.lineId)).toContain('rival'); // 缺陷只在第二卷，v1仍承接
  });
});

describe('预算合并核算（仓储）', () => {
  it('budgetTotals汇总全部批次分账与合计，合计=各账之和', () => {
    const { repo } = setup();
    repo.createRun({
      id: 'run-bt-1', batch_id: 'batch-a', node_key: 'skeleton', length_band: 'all', member_role: 'writer',
      model_profile_key: 'm1', provider: 'p', model_id: 'm1', model_plan: 'agent',
      config_version: 'cfg', prompt_version: 'pv', phase: 'validation', status: 'succeeded', sample_set_id: 's', planned_cases: 1
    });
    repo.ensureBudget('batch-a', 400, 12_000_000);
    repo.ensureBudget('batch-b', 400, 12_000_000);
    expect(repo.tryReserve('batch-a', 'run-bt-1', 2, 1000)).toBe(true);
    repo.settle('batch-a', 'run-bt-1', { requests: 1, reservedTokens: 500, actualTokens: 300 });
    repo.settle('batch-a', 'run-bt-1', { requests: 1, reservedTokens: 500, actualTokens: null });
    const all = repo.budgetTotals();
    expect(all.batches.map(b => b.batch_id).sort()).toEqual(['batch-a', 'batch-b']);
    const a = all.batches.find(b => b.batch_id === 'batch-a')!;
    expect(a.actual_requests).toBe(1);
    expect(a.unknown_requests).toBe(1);
    expect(a.actual_tokens).toBe(300);
    expect(a.unknown_tokens).toBe(500);
    expect(all.totals.actual_requests).toBe(all.batches.reduce((s, b) => s + b.actual_requests, 0));
    expect(all.totals.unknown_tokens).toBe(all.batches.reduce((s, b) => s + b.unknown_tokens, 0));
    expect(all.totals.actual_requests + all.totals.unknown_requests).toBeGreaterThanOrEqual(2);
  });
});
