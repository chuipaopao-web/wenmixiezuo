import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { NodeEvaluationRepository } from '../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { buildJudgePrompt, parseJudgeVerdict, judgePoolFor, loadJudgmentInput } from '../../../apps/api/src/application/evaluation/eval-judge.js';
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
