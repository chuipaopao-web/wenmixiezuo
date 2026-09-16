import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { buildSamples, buildFixture } from '../../../apps/api/src/application/evaluation/eval-sample-factory.js';
import { buildEvalPrompt, validateEvalOutput } from '../../../apps/api/src/application/evaluation/eval-prompt-builders.js';
import { NodeEvaluationExecutor, EvalContractError, type EvalAdapter, type EvalRunPlan } from '../../../apps/api/src/application/evaluation/node-evaluation-executor.js';
import { NodeEvaluationRepository } from '../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { EVAL_BATCH1_NODE_KEYS } from '../../../apps/api/src/application/evaluation/node-registry.js';

// MODEL-NODE-EVAL样本与提示层离线验证：样本集构成/确定性/调参与保留分离；
// 提示含生产合同关键语句（漂移防护）；校验器正反例判定；执行器语义分析入库。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));

describe('合成样本工厂', () => {
  it('生成节点：screen=2共同样本，holdout=10覆盖3题材×3长度档×2时间段', () => {
    const screen = buildSamples('skeleton', 'screen');
    expect(screen).toHaveLength(2);
    expect(screen.every(s => s.kind === 'positive')).toBe(true);
    const holdout = buildSamples('skeleton', 'holdout');
    expect(holdout).toHaveLength(10);
    expect(new Set(holdout.map(s => s.genre)).size).toBe(3);
    expect(new Set(holdout.map(s => s.lengthBand)).size).toBe(3);
    expect(new Set(holdout.map(s => s.timeSlot)).size).toBe(2);
  });
  it('审查节点：screen=1干净+1植入；holdout=5干净+5植入', () => {
    const screen = buildSamples('review-source', 'screen');
    expect(screen).toHaveLength(2);
    expect(screen.map(s => s.kind).toSorted()).toEqual(['negative', 'positive']);
    const holdout = buildSamples('review-anchors', 'holdout');
    expect(holdout).toHaveLength(10);
    expect(holdout.filter(s => s.kind === 'positive')).toHaveLength(5);
    expect(holdout.filter(s => s.kind === 'negative')).toHaveLength(5);
  });
  it('调参样本与保留验证样本分离（hash不相交）且确定性可复算', () => {
    const screen = buildSamples('skeleton', 'screen');
    const holdout = buildSamples('skeleton', 'holdout');
    const screenHashes = new Set(screen.map(s => s.sampleHash));
    expect(holdout.every(s => !screenHashes.has(s.sampleHash))).toBe(true);
    const again = buildSamples('skeleton', 'screen');
    expect(again.map(s => s.sampleHash)).toEqual(screen.map(s => s.sampleHash));
  });
  it('fixture含作者已确认故事线（关键约束测试基础）', () => {
    const f = buildFixture('玄幻成长', 'medium');
    expect(f.authorStorylines.length).toBeGreaterThanOrEqual(2);
    expect(f.seededErrors.length).toBe(3);
    expect(f.documents.length).toBe(3);
  });
  it('长度档文档规模递增', () => {
    const s = buildFixture('都市感情', 'short');
    const l = buildFixture('都市感情', 'long');
    const len = (f: typeof s) => f.documents.reduce((a, d) => a + d.text.length, 0);
    expect(len(l)).toBeGreaterThan(len(s) * 3);
  });
});

describe('提示构建器', () => {
  it('八个首批节点均可构建非空提示且含合同关键语句', () => {
    for (const nodeKey of EVAL_BATCH1_NODE_KEYS) {
      const sample = buildSamples(nodeKey, 'screen')[0]!;
      const prompt = buildEvalPrompt(nodeKey, sample);
      expect(prompt.length).toBeGreaterThan(200);
    }
    const skeleton = buildEvalPrompt('skeleton', buildSamples('skeleton', 'screen')[0]!);
    expect(skeleton).toContain('设计全书骨架。只设计大方向');
    expect(skeleton).toContain('作者已确认的故事线共2条，必须全部承接');
    expect(skeleton).toContain('各卷volumeBriefs的words.target合计必须等于全书words.target');
    const volumeCard = buildEvalPrompt('volume-card', buildSamples('volume-card', 'screen')[0]!);
    expect(volumeCard).toContain('按既定骨架补全本卷卷卡');
    expect(volumeCard).toContain('anchors必须恰好两个');
    expect(volumeCard).toContain('正式资料短卡（原始约束，不得被候选覆盖）');
    const reviewSource = buildEvalPrompt('review-source', buildSamples('review-source', 'screen')[0]!);
    expect(reviewSource).toContain('核对候选骨架是否符合来源');
    expect(reviewSource).toContain('区分阻断问题与文学建议');
  });
  it('漂移防护：提示关键语句仍与生产设计服务源码一致', () => {
    const source = readFileSync('apps/api/src/application/books/time-machine-design-service.ts', 'utf8');
    const anchors = [
      '设计全书骨架。只设计大方向',
      '按既定骨架补全本卷卷卡',
      '核对候选骨架是否符合来源',
      '核对候选锚点与条件（本批卷）',
      '正式资料短卡（原始约束，不得被候选覆盖）',
      'anchors必须恰好两个'
    ];
    for (const phrase of anchors) expect(source.includes(phrase), `生产源码已漂移：${phrase}`).toBe(true);
  });
});

describe('合同校验器', () => {
  const fixture = buildFixture('玄幻成长', 'medium');
  const sampleOf = (nodeKey: string, kind: 'positive' | 'negative' = 'positive') => {
    const s = buildSamples(nodeKey, 'screen')[0]!;
    return { ...s, kind, fixture };
  };
  it('骨架：合规输出通过；字数合计不等/丢失作者线为关键约束漏失', () => {
    const ok = validateEvalOutput('skeleton', sampleOf('skeleton'), JSON.stringify(fixture.skeleton));
    expect(ok.contractOk).toBe(true);
    const badSum = { ...fixture.skeleton, volumeBriefs: [{ id: 'v1', title: '一', goal: 'g', words: { target: 150000 } }] };
    expect(() => validateEvalOutput('skeleton', sampleOf('skeleton'), JSON.stringify(badSum))).toThrowError(EvalContractError);
    try {
      const noCover = { ...fixture.skeleton, lines: [{ id: 'x', role: 'main', title: '原创', covers: [] }] };
      validateEvalOutput('skeleton', sampleOf('skeleton'), JSON.stringify(noCover));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EvalContractError);
      expect((error as EvalContractError).critical).toBe(true);
    }
  });
  it('卷卡：恰好两锚点entry/exit且ownerEntityId正确；反例被拒', () => {
    const volume = (fixture.cleanPlan.volumes as Record<string, unknown>[])[0]!;
    const ok = validateEvalOutput('volume-card', sampleOf('volume-card'), JSON.stringify({ volumes: [volume] }));
    expect(ok.contractOk).toBe(true);
    const three = { volumes: [{ ...volume, anchors: [...(volume.anchors as unknown[]), (volume.anchors as unknown[])[0]] }] };
    expect(() => validateEvalOutput('volume-card', sampleOf('volume-card'), JSON.stringify(three))).toThrowError(EvalContractError);
  });
  it('批量卷卡：镜像生产批路径合同——不强制逐卷60字上限（初筛误套曾致5模型集体失真），缺卷/锚点非数组仍被拒；逐卷路径保持强制', () => {
    const briefs = fixture.skeleton.volumeBriefs as Record<string, unknown>[];
    const cleanVols = fixture.cleanPlan.volumes as Record<string, unknown>[];
    const long = '这是一段故意超过六十字的正文字段，用来断言批量路径不强制逐卷长度上限这一生产合同分界是否仍然成立，必须足够长才可以达到目的。';
    expect(long.length).toBeGreaterThan(60);
    const items = briefs.map((b, i) => ({ ...cleanVols[i % cleanVols.length]!, id: b.id, start: long }));
    // 生产批路径（design-service批分支）不强制逐字段≤60字：超60字仍应通过
    expect(validateEvalOutput('volumes-batch', sampleOf('volumes-batch'), JSON.stringify({ volumes: items })).contractOk).toBe(true);
    // 缺卷/锚点形态错误仍被拒（生产批分支与组装段的真实校验）
    expect(() => validateEvalOutput('volumes-batch', sampleOf('volumes-batch'), JSON.stringify({ volumes: items.slice(1) }))).toThrowError(EvalContractError);
    expect(() => validateEvalOutput('volumes-batch', sampleOf('volumes-batch'), JSON.stringify({ volumes: items.map((v, i) => i === 0 ? { ...v, anchors: null } : v) }))).toThrowError(EvalContractError);
    // 逐卷（volume-card）路径保持60字强制
    const one = { ...cleanVols[0]!, id: briefs[0]!.id, start: long };
    expect(() => validateEvalOutput('volume-card', sampleOf('volume-card'), JSON.stringify({ volumes: [one] }))).toThrowError(EvalContractError);
  });
  it('短卡提取：来源key不可创造（parseCard来源校验）', () => {
    const fields = { premise: [{ text: '方向', sourceKeys: ['opening:main:1'] }], protagonists: [{ text: '主角', sourceKeys: ['opening:main:1'] }], world: [], openingEnding: [], preferences: [], prohibitions: [] };
    expect(validateEvalOutput('card-extract', sampleOf('card-extract'), JSON.stringify({ fields })).contractOk).toBe(true);
    const fake = { ...fields, premise: [{ text: '编造', sourceKeys: ['opening:fake:9'] }] };
    expect(() => validateEvalOutput('card-extract', sampleOf('card-extract'), JSON.stringify({ fields: fake }))).toThrowError(EvalContractError);
  });
  it('审查：干净候选误报与植入召回判定', () => {
    const cleanSample = sampleOf('review-source', 'positive');
    const clean = validateEvalOutput('review-source', cleanSample, JSON.stringify({ action: 'verdict', pass: true, issues: [], suggestions: ['节奏可以更紧凑'], hasMoreIssues: false }));
    expect(clean.cleanFalseAlarm).toBe(false);
    const alarm = validateEvalOutput('review-source', cleanSample, JSON.stringify({ action: 'verdict', pass: false, issues: ['卷A字数不对'], suggestions: [], hasMoreIssues: false }));
    expect(alarm.cleanFalseAlarm).toBe(true);
    const negSample = sampleOf('review-source', 'negative');
    const full = validateEvalOutput('review-source', negSample, JSON.stringify({ action: 'verdict', pass: false, issues: ['分卷字数合计350000不等于全书400000', '对抗线在第二卷没有职责去向', '把将来承诺当已达成，无法核对'], suggestions: [], hasMoreIssues: false }));
    expect(full.seededCaught).toBe(true);
    const partial = validateEvalOutput('review-source', negSample, JSON.stringify({ action: 'verdict', pass: false, issues: ['分卷字数合计不对'], suggestions: [], hasMoreIssues: false }));
    expect(partial.seededCaught).toBe(false);
  });
  it('审查动作循环：已提供回查片段仍read_source记合同未过（不谎称覆盖补查能力）', () => {
    expect(() => validateEvalOutput('review-source', sampleOf('review-source'), JSON.stringify({ action: 'read_source', key: 'opening:main', offset: 0 }))).toThrowError(EvalContractError);
  });
});

describe('执行器语义分析入库', () => {
  it('validate返回的质量信号写入quality_pass/quality_note；critical错误带前缀', async () => {
    const c = createTestContext(); contexts.push(c);
    const repo = new NodeEvaluationRepository(c.database);
    repo.ensureBudget('batch-q', 10, 10_000_000);
    repo.createRun({
      id: 'run-q', batch_id: 'batch-q', node_key: 'review-source', length_band: 'short', member_role: 'chief',
      model_profile_key: 'glm-5.3', provider: 'volcengine-ark-agent-plan', model_id: 'glm-5.3', model_plan: 'agent',
      config_version: 'cfg-1', prompt_version: 'review-source-v2', phase: 'screen', status: 'queued', sample_set_id: 'set-1', planned_cases: 2
    });
    const executor = new NodeEvaluationExecutor(c.database, { estimateTokens: () => 10 });
    const fixture = buildFixture('玄幻成长', 'medium');
    const outputs = [
      JSON.stringify({ action: 'verdict', pass: true, issues: [], suggestions: [], hasMoreIssues: false }), // 干净样本→quality_pass=1
      'not json at all' // 解析失败→contract_error
    ];
    let i = 0;
    const adapter: EvalAdapter = { async generate() { return { output: outputs[i++]!, usage: { inputTokens: 5, outputTokens: 5, reasoningTokens: 0 } }; } };
    const samples = [
      { sampleHash: 'q1', genre: '玄幻成长' as const, lengthBand: 'short' as const, timeSlot: 'T1', kind: 'positive' as const, prompt: 'p1' },
      { sampleHash: 'q2', genre: '玄幻成长' as const, lengthBand: 'short' as const, timeSlot: 'T1', kind: 'positive' as const, prompt: 'p2' }
    ];
    const plan: EvalRunPlan = {
      runId: 'run-q', batchId: 'batch-q', nodeKey: 'review-source', lengthBand: 'short', modelProfileKey: 'glm-5.3',
      provider: 'volcengine-ark-agent-plan', modelId: 'glm-5.3', configVersion: 'cfg-1', promptVersion: 'review-source-v2',
      maxOutputTokens: 8000, temperature: 0.6, samples,
      validate: (output: string) => {
        const sample = samples[i - 1]!;
        const a = validateEvalOutput('review-source', { ...buildSamples('review-source', 'screen')[0]!, kind: sample.kind, fixture }, output);
        return { qualityPass: sample.kind === 'negative' ? (a.seededCaught ?? null) : !(a.cleanFalseAlarm ?? false), qualityNote: a.note };
      }
    };
    await executor.execute(plan, adapter);
    const rows = repo.casesForRun('run-q');
    expect(rows).toHaveLength(2);
    const q1 = rows.find(r => r.sample_hash === 'q1')!;
    const q2 = rows.find(r => r.sample_hash === 'q2')!;
    expect(q1.quality_pass).toBe(1);
    expect(q1.quality_note).toContain('干净候选正确通过');
    expect(q2.outcome).toBe('contract_error');
    expect(q2.quality_pass).toBeNull();
  });
});
