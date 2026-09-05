import { describe, expect, it } from 'vitest';
import { readBudgetedEvidence } from '../../apps/api/src/application/creation/v7-context-evidence-reader.js';
import { compilePack } from '../../apps/api/src/application/creation/v7-creation-context-compiler.js';
import { preparePlanningEvidence, planningPromptSnapshot } from '../../apps/api/src/application/planning/v7-planning-source-compiler.js';
import { evidenceFixtureAnswer } from '../helpers/v7-context-evidence-fixture.js';
import { type V7CreationContextSelection, type V7CreationTaskKind } from '@wenmi/v7-backend';

const hard = '主人公必须在开场坦白此前已知的真相，不得拖到卷末。';
const source = { key: 'opening-v1', label: '作者正式要求', authority: 'formal', required: true,
  content: { introduction: '背景介绍。'.repeat(4000), mustFollow: [hard], endingBoundary: '不得提前开启远期封印。' } };
const selection: V7CreationContextSelection = {
  schema: 'v7-creation-context-v1', publicSummary: '承接当前正式资料。', selectedSourceKeys: [source.key],
  selectionReasons: [{ sourceKey: source.key, reason: '作者正式要求' }], excludedSourceKeys: [], openQuestions: [],
  taskPersona: { publicLabel: '资料任务', workingIdentity: '依据事实工作', priorities: [], authenticityChecks: [], avoidPatterns: [] },
  taskResponsibilities: ['设计当前任务'], creativeSpace: ['正式边界内可以创新'],
  methodStrategy: { mode: 'none', publicSummary: '无需方法', searchRequest: null }
};

describe('分批原文证据与预算', () => {
  it('小资料完全保留，不产生额外模型调用', async () => {
    const content = { actual: '正文已发生事实', future: '未来计划' };
    expect(await readBudgetedEvidence({ task: '续写', sources: [{ ...source, content }], budget: 3000,
      generate: async () => { throw new Error('不应调用'); } })).toEqual([content]);
  });

  it('读到长材料末尾硬要求，引用由系统原样回填，全部输入页有界，原数据不变', async () => {
    const before = JSON.stringify(source);
    const prompts: string[] = [];
    const result = await readBudgetedEvidence({ task: '设计第一卷', sources: [source], budget: 2500,
      generate: async ({ prompt }) => { prompts.push(prompt); return evidenceFixtureAnswer(prompt); } });
    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts.every((prompt) => Array.from(prompt).length <= 48000)).toBe(true);
    expect(JSON.stringify(result)).toContain(hard);
    expect(JSON.stringify(result)).toContain('不得提前开启远期封印。');
    expect(Array.from(JSON.stringify(result)).length).toBeLessThanOrEqual(2500);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('伪造来源有限补交，连续不合法不产生可用资料；未知调用不补发', async () => {
    let calls = 0;
    await expect(readBudgetedEvidence({ task: '设计', sources: [source], budget: 2500,
      generate: async () => { calls++; return '{"keepIds":[999999],"essentialIds":[]}'; } })).rejects.toThrow('无需删除');
    expect(calls).toBe(3);
    calls = 0;
    await expect(readBudgetedEvidence({ task: '设计', sources: [source], budget: 2500,
      generate: async () => { calls++; throw new Error('结果未知'); } })).rejects.toThrow('结果未知');
    expect(calls).toBe(1);
  });

  it.each(['volume', 'chain', 'outline', 'manuscript', 'review', 'settlement'] as V7CreationTaskKind[])(
    '%s执行包包含真实原文及版本，并满足最终字符预算', async (taskKind) => {
      const candidate = { sourceKey: source.key, sourceId: 'formal-v1', sourceVersion: '1', contentHash: 'immutable-hash',
        sourceKind: 'opening' as const, includedReason: '当前正式作者要求', authority: 'formal' as const,
        label: source.label, content: source.content, required: true };
      const pack = await compilePack({ ownerId: 'owner', bookId: 'book', workflowId: 'workflow', taskKind,
        taskId: 'scope', firstVolume: true, taskBrief: '设计当前任务' }, [candidate], selection,
      async ({ prompt }) => evidenceFixtureAnswer(prompt));
      expect(pack.characterCount).toBeLessThanOrEqual(pack.budgetChars);
      expect(JSON.stringify(pack.selectedSources)).toContain(hard);
      expect(pack.selectedSources[0]).toMatchObject({ sourceId: 'formal-v1', sourceVersion: '1', contentHash: 'immutable-hash' });
      expect(pack.contextPolicyVersion).toBe('layered-context-v5-evidence');
    });

  it.each(['approved', 'denied', 'unknown'] as const)('旧硬标签纠正需要覆盖核对：%s，原文仍不可改写', async (mode) => {
    let reviews = 0;
    const repeated = { ...source, content: '这道门必须等到成年才能开启，不得提前。'.repeat(1600) };
    const original = JSON.stringify(repeated);
    const run = readBudgetedEvidence({ task: '设计开场', sources: [repeated], budget: 1200,
      generate: async ({ prompt }) => {
        if (prompt.includes('本轮执行资料约束覆盖核对')) {
          reviews++;
          if (mode === 'unknown') throw new Error('覆盖核对结果未知');
          const removed = JSON.parse(prompt.split('拟移除旧标记：')[1]!.split('。')[0]!) as number[];
          return JSON.stringify({ approvedRemovalIds: mode === 'approved' ? removed : [] });
        }
        const entries = JSON.parse(prompt.split('可选原文：')[1]!.split('\n')[0]!) as Array<{ id: number; text: string }>;
        const prior = JSON.parse(prompt.split('此前必须保留编号：')[1]!.split('\n')[0]!) as number[];
        const replacement = entries.find((entry) => !prior.includes(entry.id))!;
        return JSON.stringify({ keepIds: [replacement.id], essentialIds: [replacement.id], reconsiderIds: prior });
      } });
    if (mode === 'approved') {
      const result = await run;
      expect(JSON.stringify(result)).toContain('必须等到成年才能开启，不得提前');
      expect(Array.from(JSON.stringify(result)).length).toBeLessThanOrEqual(1200);
      expect(reviews).toBeGreaterThan(0);
    } else {
      await expect(run).rejects.toThrow(mode === 'unknown' ? '结果未知' : '无需删除');
      expect(reviews).toBe(mode === 'unknown' ? 1 : 3);
    }
    expect(JSON.stringify(repeated)).toBe(original);
  });

  it('恢复只给失败页新批次，前面已通过的页复用，最终完整包装不超限', async () => {
    const cache = new Map<string, string>();
    const freshPages: string[] = [];
    const generate = async ({ key, prompt }: { key: string; prompt: string }): Promise<string> => {
      if (!cache.has(key)) {
        const page = /第(\d+)\//u.exec(prompt)![1]!;
        freshPages.push(page);
        cache.set(key, page === '1' || prompt.includes('恢复批次：') ? evidenceFixtureAnswer(prompt)
          : '{"keepIds":[999999],"essentialIds":[]}');
      }
      return cache.get(key)!;
    };
    const input = { task: '设计', sources: [source], budget: 3000,
      measure: (contents: unknown[]) => Array.from(JSON.stringify({ metadata: '完整包装'.repeat(50), contents })).length, generate };
    await expect(readBudgetedEvidence(input)).rejects.toThrow('无需删除');
    const recovered = await readBudgetedEvidence({ ...input, recoveryKey: 'retry-1' });
    expect(freshPages.filter((page) => page === '1')).toHaveLength(1);
    expect(input.measure(recovered)).toBeLessThanOrEqual(input.budget);
    expect(JSON.stringify(recovered)).toContain(hard);
    const before = freshPages.length;
    expect(await readBudgetedEvidence({ ...input, recoveryKey: 'retry-1' })).toEqual(recovered);
    expect(freshPages).toHaveLength(before);
  });

  it.each(['book', 'volume', 'chain'] as const)('%s规划投影保留身份、规模和原文，完整快照不被覆盖', async (treeKind) => {
    const snapshot = { snapshotId: 'snapshot-v1', ownerId: 'owner', bookId: 'book', treeKind, scopeId: 'scope',
      purpose: 'tree_generation' as const, sourceFingerprint: 'fingerprint', createdAt: 'now', excludedSources: [], excludedSourceDecisions: [],
      sources: [{ sourceKind: 'opening' as const, sourceId: 'opening-v1', sourceVersion: '1', authority: 'formal' as const,
        label: source.label, content: { ...source.content, introduction: '背景介绍。'.repeat(6000),
          planningProfile: { publishingPlatform: 'fanqie', expectedTotalWords: 1500000 } }, contentHash: 'hash', includedReason: '正式资料' }] };
    const before = JSON.stringify(snapshot);
    const prepared = await preparePlanningEvidence(snapshot, async ({ prompt }) => evidenceFixtureAnswer(prompt));
    expect(JSON.stringify(planningPromptSnapshot(prepared))).toContain(hard);
    expect(prepared.sources[0]?.content).toHaveProperty('planningProfile.expectedTotalWords', 1500000);
    expect(Array.from(JSON.stringify(planningPromptSnapshot(prepared))).length).toBeLessThanOrEqual(treeKind === 'book' ? 18000 : treeKind === 'volume' ? 14000 : 10000);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('冻结设定选择后的规划续跑复用同一批阅读页，不因required标记变化重复调用', async () => {
    const snapshot = { snapshotId: 'snapshot-v1', ownerId: 'owner', bookId: 'book', treeKind: 'volume' as const, scopeId: 'scope',
      purpose: 'tree_generation' as const, sourceFingerprint: 'fingerprint', createdAt: 'now', excludedSources: [], excludedSourceDecisions: [],
      sources: [{ sourceKind: 'opening' as const, sourceId: 'opening-v1', sourceVersion: '1', authority: 'formal' as const,
        label: source.label, content: source.content, contentHash: 'opening-hash', includedReason: '正式资料' },
      { sourceKind: 'setting' as const, sourceId: 'setting-v1', sourceVersion: '1', authority: 'formal' as const,
        label: '正式设定', content: { schema: 'v7-setting-fact-source-v1', itemKey: 'rule', facts: ['桥梁尚未修好。'],
          background: '设定背景。'.repeat(2000) }, contentHash: 'setting-hash', includedReason: '正式资料' }] };
    const cache = new Map<string, string>();
    const generate = async ({ key, prompt }: { key: string; prompt: string }): Promise<string> => {
      if (!cache.has(key)) cache.set(key, evidenceFixtureAnswer(prompt));
      return cache.get(key)!;
    };
    const first = await preparePlanningEvidence(snapshot, generate);
    const calls = cache.size;
    expect(calls).toBeGreaterThan(1);
    const resumed = await preparePlanningEvidence(snapshot, generate, ['setting-v1']);
    expect(cache.size).toBe(calls);
    expect(resumed.sources).toEqual(first.sources);
  });
});
