import { describe, expect, it } from 'vitest';
import { parseChiefReview, parseWriterProposal } from '../../rebuild/packages/backend/src/legacy-opening/setting-agent/setting-agent-support.js';
import { confirmedSettingProjection } from '../../rebuild/packages/backend/src/legacy-opening/setting-agent/setting-context-projection.js';
import { assertConciseSetting } from '../../rebuild/packages/backend/src/legacy-opening/setting-agent/setting-delivery-policy.js';

const rule = {
  level: 'topic', statement: '加急公文通过驿站传递。', scope: '本书设定的官用驿路',
  conditions: ['持有合法驿券'], costs: ['沿途征用马匹'], exceptions: ['战乱封路时停递'], objects: ['驿站']
};

describe('设定规则单一来源', () => {
  it('主编合并辅助事实后展示和注入仅含完整短句，旧版本仍保留原条件', () => {
    const source = parseWriterProposal(JSON.stringify({ rules: [rule], contextSummary: '驿路' }));
    const statement = '官用驿路凭合法驿券传递加急公文，沿途征用马匹；战乱封路时停递。';
    const review = parseChiefReview(JSON.stringify({ verdict: 'pass', summary: '合并重复表达', issues: [],
      ruleChanges: [{ index: 0, action: 'replace', reason: '保留范围、条件、代价和例外',
        rule: { level: 'topic', statement, scope: '', conditions: [], costs: [], exceptions: [], objects: [] } }]
    }), source.content, source.rules);
    const projection = confirmedSettingProjection({ item_key: 'information', item_label: '信息传播',
      version_id: 'merged', revision: 2, content_json: JSON.stringify(review) });
    expect(review.finalContent).toBe(statement);
    expect(projection.factEntries).toEqual([statement]);
    expect(source.rules?.[0]?.conditions).toEqual(['持有合法驿券']);
    expect(source.content).toContain('战乱封路时停递');
  });
  it('局部审查使用原始索引，保留未修改规则及其限定，不修改源方案', () => {
    const original = parseWriterProposal(JSON.stringify({ rules: [rule, { ...rule, statement: '错误规则' },
      { ...rule, statement: '另一条规则' }], contextSummary: '传递规则' }));
    const review = parseChiefReview(JSON.stringify({ verdict: 'pass', summary: '修正完成', issues: [],
      ruleChanges: [{ index: 1, action: 'remove', reason: '重复且无依据' },
        { index: 2, action: 'replace', reason: '恢复作者明确范围', rule: { ...rule, statement: '主要靠口传' } }]
    }), original.content, original.rules);
    expect(review.rules).toHaveLength(2);
    expect(review.rules?.[0]).toEqual(original.rules?.[0]);
    expect(review.rules?.[1]?.statement).toBe('主要靠口传');
    expect(review.finalContent).toContain('战乱封路时停递');
    expect(original.rules).toHaveLength(3);
  });

  it('错误索引、重复修改、缺少依据或双份结果不能静默交付', () => {
    const original = parseWriterProposal(JSON.stringify({ rules: [rule], contextSummary: '传递规则' }));
    const change = { index: 0, action: 'remove', reason: '无依据' };
    for (const ruleChanges of [[{ ...change, index: 8 }], [change, change], [{ ...change, reason: '' }], [change]]) {
      expect(() => parseChiefReview(JSON.stringify({ verdict: 'pass', summary: '审核完成', ruleChanges }),
        original.content, original.rules)).toThrow();
    }
    expect(() => parseChiefReview(JSON.stringify({ verdict: 'pass', summary: '审核完成', ruleChanges: [], rules: [rule] }),
      original.content, original.rules)).toThrow();
    expect(() => parseChiefReview(JSON.stringify({ verdict: 'pass', summary: '审核完成', ruleChanges: [] }))).toThrow();
    expect(parseChiefReview(JSON.stringify({ verdict: 'pass', summary: '审核完成', ruleChanges: [] }),
      original.content, original.rules).rules).toEqual(original.rules);
  });

  it('展示和注入都来自同一规则，忽略与规则冲突的旧正文及事实副本', () => {
    const review = parseChiefReview(JSON.stringify({ rules: [rule], verdict: 'pass', summary: '可以使用',
      contextSummary: '驿路传递规则', finalContent: '任何人都可以免费使用', factEntries: ['没有限制'] }));
    const projection = confirmedSettingProjection({ item_key: 'information', item_label: '信息传播',
      version_id: 'v2', revision: 2, content_json: JSON.stringify(review) });
    expect(review.finalContent).toBe(projection.factEntries.join('\n\n'));
    expect(review.finalContent).toContain('战乱封路时停递');
    expect(review.finalContent).toContain('持有合法驿券');
    expect(review.finalContent).not.toContain('任何人');
    expect(projection.rules?.[0]?.level).toBe('topic');
    expect(projection.projectionSource).toBe('canonical_rules');
  });

  it('规则格式不完整时明确报错，不回退到另一份正文掩盖错误', () => {
    expect(() => parseWriterProposal(JSON.stringify({ rules: [{ ...rule, exceptions: '没有' }], content: '备用正文' }))).toThrow(/完整列表/);
    expect(() => parseWriterProposal(JSON.stringify({ rules: [], content: '备用正文' }))).toThrow(/规则列表/);
  });

  it('复杂规则超过600字仍完整保留；技术容量超限时拒绝截断', () => {
    const statement = '必要的具体条件。'.repeat(90);
    const proposal = parseWriterProposal(JSON.stringify({ rules: [{ ...rule, statement }], contextSummary: '复杂机制' }));
    expect(proposal.content.length).toBeGreaterThan(600);
    expect(() => assertConciseSetting(proposal)).not.toThrow();
    expect(proposal.content).toContain(statement);
    expect(() => parseWriterProposal(JSON.stringify({ content: '字'.repeat(12001) }))).toThrow();
  });

  it('旧版本事实不再静默丢掉第25项或第33项', () => {
    const facts = Array.from({ length: 40 }, (_, i) => `第${i + 1}项有来源的事实`);
    const proposal = parseWriterProposal(JSON.stringify({ content: facts.join('；'), factEntries: facts, contextSummary: '旧版事实' }));
    expect(proposal.factEntries).toEqual(facts);
    expect(confirmedSettingProjection({ item_key: 'legacy', item_label: '旧设定', version_id: 'old', revision: 1,
      content_json: JSON.stringify(proposal) }).factEntries).toEqual(facts);
  });
});
