import { describe, expect, it } from 'vitest';
import { RoleContextCompiler } from '../../../apps/api/src/application/memory/role-context-compiler.js';
import { TokenBudgetService } from '../../../apps/api/src/application/memory/token-budget-service.js';
import type { EvidenceCluster } from '../../../apps/api/src/contracts/retrieval-plan.js';

describe('岗位差异化上下文与Token预留', () => {
  it('先预留输出/工具/20%安全边界，主笔保留0—4灵感和明确自由创作区', () => {
    const budget = new TokenBudgetService().allocate({ modelContextTokens: 32_000, requestedOutputTokens: 8_000, toolTokens: 1_000 });
    expect(budget).toEqual({ modelContextTokens: 32_000, outputReserved: 8_000, toolReserved: 1_000, safetyReserved: 6_400, inputAvailable: 16_600 });
    const hard = cluster('hard', 'H', '人物不能瞬移。');
    const evidence = Array.from({ length: 12 }, (_, index) => cluster(`e-${index}`, 'E', `证据${index}`));
    const inspiration = Array.from({ length: 8 }, (_, index) => cluster(`i-${index}`, 'I', `灵感${index}`));
    const pack = new RoleContextCompiler().compile({
      roleKey: 'lead_writer', mode: 'formal_production', inputTokenBudget: budget.inputAvailable,
      clusters: [hard, ...evidence, ...inspiration], closures: [{ clusterId: 'hard', result: 'closed' } as never],
      taskInstruction: '完成当前章节', expressionBaseline: '克制、人物声音可辨'
    });
    expect(pack.hard).toHaveLength(1);
    expect(pack.evidence).toHaveLength(8);
    expect(pack.inspiration).toHaveLength(4);
    expect(pack.creativeFreedom).toContain('允许不用或变形');
  });

  it('硬资料超预算或未闭环时阻断正式生产而非静默截断', () => {
    const hard = cluster('hard', 'H', '硬事实'.repeat(1_000));
    expect(() => new RoleContextCompiler().compile({
      roleKey: 'lead_writer', mode: 'formal_production', inputTokenBudget: 20,
      clusters: [hard], closures: [{ clusterId: 'hard', result: 'unknown' } as never], taskInstruction: '写作'
    })).toThrow('未闭环硬证据');
  });
});

function cluster(id: string, lane: 'H' | 'E' | 'I', content: string): EvidenceCluster {
  return { clusterId: id, clusterKey: id, lane, primary: { content } as never, candidates: [], channelRanks: {}, rrfScore: 0, conflictGroup: null, adopted: true, adoptionReason: 'test' };
}
