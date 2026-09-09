import { describe, expect, it } from 'vitest';
import { planningSourceProjection, removeEmpty } from '../../apps/api/src/application/planning/v7-planning-source-projection.js';
import { preparePlanningEvidence, planningPromptSnapshot } from '../../apps/api/src/application/planning/v7-planning-source-compiler.js';

describe('planning transport projection', () => {
  it('retains legacy qualifiers, global boundaries and unique reviewed facts without mutating originals', () => {
    const original = { schema: 'v7-setting-fact-source-v1', itemKey: 'ability', contextSummary: '复核通过',
      rules: [{ level: 'topic', statement: '损伤可以修复', conditions: ['核心完整'], costs: ['灵材'], exceptions: ['核心毁坏不能复活'], objects: [], scope: '' },
        { level: 'global', statement: '不得进入星域', conditions: [], costs: [], exceptions: [] }],
      facts: ['损伤可以修复', '不得进入星域', '只有主角拥有蓝图'] };
    const before = JSON.stringify(original);
    const compact = planningSourceProjection(original) as typeof original;
    expect(JSON.stringify(compact)).toContain('核心完整');
    expect(JSON.stringify(compact)).toContain('核心毁坏不能复活');
    expect(JSON.stringify(compact)).toContain('灵材');
    expect(compact.rules[1]).toMatchObject({ level: 'global', statement: '不得进入星域', conditions: [] });
    expect(compact.facts).toEqual(['只有主角拥有蓝图']);
    expect(planningSourceProjection(compact)).toEqual(compact);
    expect(JSON.stringify(original)).toBe(before);
    expect(removeEmpty({ zero: 0, no: false, blank: '', group: { list: [] }, text: '主角要求' })).toEqual({ zero: 0, no: false, text: '主角要求' });
  });

  it('fits 24 complete topic sources without asking an agent to discard facts solely duplicated by serialization', async () => {
    const sources = Array.from({ length: 24 }, (_, i) => {
      const statements = Array.from({ length: 4 }, (_, j) => `第${i}组第${j}项：只能接触实物解析，不得读心，制造仍需材料和能源。`);
      return { sourceKind: 'setting' as const, sourceId: `setting-${i}`, sourceVersion: '3', authority: 'formal' as const,
        label: `主题${i}`, contentHash: `hash-${i}`, includedReason: '正式来源',
        content: { schema: 'v7-setting-fact-source-v1', itemKey: `topic-${i}`, contextSummary: '复核通过',
          rules: statements.map(statement => ({ level: 'topic', statement, conditions: [], costs: [], exceptions: [], objects: [], scope: '' })), facts: statements } };
    });
    const snapshot = { snapshotId: 'frozen', ownerId: 'owner', bookId: 'book', treeKind: 'book' as const, scopeId: 'book',
      purpose: 'recipe_design' as const, sourceFingerprint: 'hash', createdAt: 'now', excludedSources: [], excludedSourceDecisions: [], sources };
    const before = JSON.stringify(snapshot);
    expect(JSON.stringify(planningPromptSnapshot(snapshot)).length).toBeGreaterThan(18000);
    const result = await preparePlanningEvidence(snapshot, async () => { throw new Error('Unnecessary selection'); });
    expect(JSON.stringify(planningPromptSnapshot(result)).length).toBeLessThan(18000);
    expect(result.sources).toHaveLength(24);
    for (const s of sources) for (const rule of s.content.rules) expect(JSON.stringify(result)).toContain(rule.statement);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
