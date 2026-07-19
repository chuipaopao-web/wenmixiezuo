import { describe, expect, it } from 'vitest';
import { planContinuityRetrieval } from '../../../apps/api/src/application/continuity/continuity-trigger-policy.js';

describe('500/1000/1500章连续性触发', () => {
  it.each([500, 1000, 1500])('第%d章先用阶段结算导航，关键实体仍回查正史原文', (currentChapter) => {
    const levels = planContinuityRetrieval({ currentChapter, referencedEntityIds: ['张三'], activeCommitmentEntityIds: [], ruleKeys: ['宣战规则'], causalThreadIds: [] });
    expect(levels.map((item) => item.level)).toEqual(['recent_chapters', 'active_arc', 'stage_settlement', 'canon_drilldown']);
    expect(levels.at(-1)?.reason).toContain('正史原文');
  });
  it('没有关键触发时不盲目钻取数百章原文', () => {
    expect(planContinuityRetrieval({ currentChapter: 500, referencedEntityIds: [], activeCommitmentEntityIds: [], ruleKeys: [], causalThreadIds: [] }).at(-1)?.level).toBe('stage_settlement');
  });
});
