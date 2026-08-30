import { describe, expect, it } from 'vitest';
import {
  V7_CREATION_MEMBERS,
  creationFallbackChain,
  manuscriptPrompt,
  parseChapterSequence,
  parseChapterReview,
  parseChapterSettlement,
  parseStageSettlement,
  parseContextSelection,
  parseOptionReview,
  parseOptionRevisionRequest,
  parseVolumeOption,
  optionReviewRepairPrompt,
  reviewPrompt,
  validateCreationRoster
} from './creation-runtime.js';

describe('V7 creation runtime contracts', () => {
  it('keeps every role independently recoverable', () => {
    expect(validateCreationRoster()).toEqual([]);
    expect(new Set(V7_CREATION_MEMBERS.map((item) => item.memberKey)).size).toBe(V7_CREATION_MEMBERS.length);
    expect(V7_CREATION_MEMBERS.some((item) => item.roleKey === 'outline_writer')).toBe(false);
    expect(creationFallbackChain('outline_writer').every((item) => item.roleKey === 'planning_writer')).toBe(true);
    expect(creationFallbackChain('outline_writer', 'creation-outline-glm-5-3')[0]?.memberKey).toBe('planner-glm-5-3');
    expect(creationFallbackChain('lead_writer')[0]?.memberKey).toBe('writer-deepseek-v4-pro');
    expect(creationFallbackChain('lead_writer')[0]?.memberKey).toBe('writer-deepseek-v4-pro');
  });

  it('requires formal sources in semantic selection', () => {
    const candidates = [
      { sourceKey: 'opening:1', sourceKind: 'opening' as const, sourceId: 'opening', sourceVersion: '1', authority: 'formal' as const,
        label: '开书资料', content: {}, contentHash: 'a'.repeat(64), required: true, includedReason: '正式来源' },
      { sourceKey: 'method:1', sourceKind: 'method' as const, sourceId: 'method', sourceVersion: '1', authority: 'reference' as const,
        label: '方法', content: {}, contentHash: 'b'.repeat(64), required: false, includedReason: '候选' }
    ];
    expect(() => parseContextSelection(JSON.stringify({ schema: 'v7-creation-context-v1', publicSummary: '已整理', selectedSourceKeys: ['method:1'],
      selectionReasons: [{ sourceKey: 'method:1', reason: '参考' }], excludedSourceKeys: ['opening:1'], openQuestions: [] }), candidates, 8)).toThrow('必要正式来源');
  });

  it('separates blocking review from suggestions', () => {
    const review = parseChapterReview(JSON.stringify({ schema: 'v7-chapter-review-v1', passed: true, publicSummary: '可以继续',
      hardConflicts: [], continuityRisks: [], qualitySuggestions: [{ evidence: '一句说明偏长', impact: '节奏稍慢', action: '压缩一句' }], rewriteInstructions: [] }));
    expect(review.passed).toBe(true);
    expect(review.qualitySuggestions).toHaveLength(1);
  });

  it('gives manuscript review an explicit stopping rule instead of an exhaustive hunt', () => {
    const prompt = reviewPrompt({
      outline: { chapterNumber: 7, title: '查账', objective: '查清粮袋差额' } as never,
      contextPack: { selectedSources: [] },
      manuscript: '张三当众复核了粮袋数。'
    });
    expect(prompt).toContain('有停止条件的裁决');
    expect(prompt).toContain('硬门禁只核对五项');
    expect(prompt).toContain('最多给3条qualitySuggestions');
    expect(prompt).toContain('没有可引用的正文证据就不要提出问题');
  });

  it('accepts a reviewer alternate verdict contract without paying for a format-only retry', () => {
    const review = parseChapterReview(JSON.stringify({
      verdict: 'pass', summary: '正文可以继续，仅有局部优化。',
      issues: [
        { location: '门口对峙', issueType: 'continuity', severity: 'observation', evidence: '开门时缺少短暂停手说明', requiredAction: '补一句人群停手。' },
        { location: '一句对白', issueType: 'style', severity: 'minor', evidence: '对白稍长', requiredAction: '压短对白。' }
      ], scores: { pacing: 85 }
    }));
    expect(review).toMatchObject({ passed: true, publicSummary: '正文可以继续，仅有局部优化。' });
    expect(review.continuityRisks).toHaveLength(1);
    expect(review.qualitySuggestions).toHaveLength(1);
    expect(review.rewriteInstructions).toEqual([]);
  });

  it('accepts the legacy rewrite verdict as a failed review without a format-only retry', () => {
    const review = parseChapterReview(JSON.stringify({
      verdict: 'rewrite', summary: '一处人物身份与正式资料冲突。',
      issues: [{
        location: '仓门对话', issueType: 'character', severity: 'major',
        evidence: '正文把老驿卒称为贴书。', requiredAction: '恢复老驿卒的正式身份。'
      }]
    }));
    expect(review).toMatchObject({ passed: false, publicSummary: '一处人物身份与正式资料冲突。' });
    expect(review.hardConflicts).toHaveLength(1);
    expect(review.rewriteInstructions).toEqual(['恢复老驿卒的正式身份。']);
  });

  it('normalizes object-shaped rewrite instructions without paying for a format-only retry', () => {
    const review = parseChapterReview(JSON.stringify({
      schema: 'v7-chapter-review-v1', passed: false, publicSummary: '时间线需要调整。',
      hardConflicts: [{ evidence: '当日傍晚设施已修好', impact: '修复时间不足', action: '把来袭时间改到三日后。' }],
      continuityRisks: [], qualitySuggestions: [],
      rewriteInstructions: [{ target: '第11章时间线', instruction: '把来袭时间改到三日后。' }]
    }));
    expect(review.passed).toBe(false);
    expect(review.rewriteInstructions).toEqual(['第11章时间线：把来袭时间改到三日后。']);
  });

  it('does not formalize a contradictory pass verdict that contains a major conflict', () => {
    const review = parseChapterReview(JSON.stringify({
      verdict: 'pass', summary: '整体可读，但数字证据链必须补齐。',
      issues: [{
        location: '清点粮袋', issueType: 'causality', severity: 'major',
        evidence: '尚未点完就断言总数不符。', requiredAction: '先补总袋数与折算过程，再得出结论。'
      }],
      scores: { continuity: 70 }
    }));
    expect(review.passed).toBe(false);
    expect(review.hardConflicts).toHaveLength(1);
    expect(review.rewriteInstructions).toEqual(['先补总袋数与折算过程，再得出结论。']);
  });

  it('keeps a single chapter open question without changing its meaning', () => {
    const chapter = (chapterNumber: number) => ({
      chapterNumber, title: `第${chapterNumber}章`, objective: '完成当前责任', openingHook: '冲突立刻发生。',
      sceneSetup: '柳林驿粮仓', protagonistChoice: '林砚选择当众清点', opposition: '饥民不愿等待',
      turn: '旧驿卒出面作证', emotionalMovement: '紧张转为暂时稳定', payoff: '仓门暂时守住',
      continuity: '承接当前单元链', openQuestions: '谁提前撬过仓门？', nextChapterInterface: '继续清点存粮'
    });
    const result = parseChapterSequence(JSON.stringify({
      schema: 'v7-chapter-sequence-v1', chainScopeId: 'chain-1', publicSummary: '章纲已经拆分。',
      chapterStart: 1, chapterEnd: 2, chapters: [chapter(1), chapter(2)], sourceRefs: []
    }), 'chain-1', 1, 6);
    expect(result.chapters[0]?.openQuestions).toEqual(['谁提前撬过仓门？']);
  });

  it('rejects settlement evidence outside the finalized manuscript', () => {
    expect(() => parseChapterSettlement(JSON.stringify({ schema: 'v7-chapter-settlement-v1', publicSummary: '完成', irreversibleResults: [], entityStates: [],
      relationshipChanges: [], knowledgeChanges: [], resourceChanges: [], ruleChanges: [], storyLines: [{ stableKey: 'main', title: '主线', state: 'advancing', summary: '推进', evidenceRefs: ['plan:1'] }],
      foreshadowing: [], openQuestions: [], treeActuals: [] }), ['manuscript:1'])).toThrow('非正式证据');
  });

  it('binds every generic settlement change to the finalized manuscript evidence', () => {
    const settlement = parseChapterSettlement(JSON.stringify({
      schema: 'v7-chapter-settlement-v1', publicSummary: '张三确认粮车少了一辆。',
      irreversibleResults: ['粮车少了一辆'],
      entityStates: [{ summary: '张三开始怀疑交接记录', evidenceRefs: ['manuscript:1'] }],
      relationshipChanges: [], knowledgeChanges: [], resourceChanges: [], ruleChanges: [],
      storyLines: [], foreshadowing: [], openQuestions: [], treeActuals: []
    }), ['manuscript:1']);
    expect(settlement.irreversibleResults).toEqual([{ summary: '粮车少了一辆', evidenceRefs: ['manuscript:1'] }]);
    expect(settlement.entityStates).toEqual([{ summary: '张三开始怀疑交接记录', evidenceRefs: ['manuscript:1'] }]);
    expect(() => parseChapterSettlement(JSON.stringify({
      ...settlement,
      entityStates: [{ summary: '张三掌握了真相', evidenceRefs: ['plan:1'] }]
    }), ['manuscript:1'])).toThrow('非正式证据');
  });

  it('normalizes localized settlement state labels without changing their content', () => {
    const settlement = parseChapterSettlement(JSON.stringify({
      schema: 'v7-chapter-settlement-v1', publicSummary: '第一章完成封门。',
      irreversibleResults: [], entityStates: [], relationshipChanges: [], knowledgeChanges: [], resourceChanges: [], ruleChanges: [],
      storyLines: [{ stableKey: 'granary-defense', title: '守粮', state: '进行中', summary: '仓门暂时封住。', evidenceRefs: ['manuscript:1'] }],
      foreshadowing: [{ stableKey: 'door-mark', title: '撬痕', state: '已埋设', summary: '门内留下新撬痕。', evidenceRefs: ['manuscript:1'] }],
      openQuestions: [{ stableKey: 'who-pried', question: '谁撬了门？', state: '待解', answer: '', evidenceRefs: ['manuscript:1'] }],
      treeActuals: [{ treeKind: 'chain', scopeId: 'chain-1', nodeKey: 'event-1', state: '已完成', summary: '封门完成。',
        emotionResult: '惊慌转为暂稳。', experienceResult: '主角靠行动稳住人群。', outcome: '获得清点时间。', evidenceRefs: ['manuscript:1'] }]
    }), ['manuscript:1']);
    expect(settlement.storyLines[0]?.state).toBe('advancing');
    expect(settlement.foreshadowing[0]?.state).toBe('planted');
    expect(settlement.openQuestions[0]?.state).toBe('open');
    expect(settlement.treeActuals[0]?.state).toBe('completed');
  });

  it('requires a chain or volume settlement to cover every formal child settlement', () => {
    expect(() => parseStageSettlement(JSON.stringify({
      schema: 'v7-stage-settlement-v1', settlementKind: 'chain', scopeId: 'chain-1', publicSummary: '阶段完成',
      irreversibleResults: [], entityStates: [], closedThreads: [], openThreads: [], relationshipChanges: [],
      knowledgeChanges: [], resourceChanges: [], ruleChanges: [], protagonistChange: '主角站稳脚跟',
      outcome: '完成本链目标', nextStep: '进入下一链', evidenceRefs: ['chapter-settlement:1']
    }), { settlementKind: 'chain', scopeId: 'chain-1', allowedEvidenceRefs: ['chapter-settlement:1', 'chapter-settlement:2'] })).toThrow('遗漏');
  });

  it('guards manuscript and review against unsupported clever-sounding deductions', () => {
    const outline = {
      chapterNumber: 1, title: '夜查粮册', objective: '确认粮草去向', openingHook: '粮车少了一辆。',
      sceneSetup: '边寨粮仓', protagonistChoice: '张三决定核对交接记录', opposition: '值守者拒绝配合',
      turn: '交接时刻与巡检记录不一致', emotionalMovement: '怀疑转为警惕', payoff: '锁定需要复查的时段',
      continuity: '承接入营', openQuestions: ['谁改了记录？'], nextChapterInterface: '寻找第二份可核对证据'
    };
    expect(manuscriptPrompt({ outline, contextPack: {} })).toContain('不能用脚印深浅、表情或单一巧合直接断定');
    const review = reviewPrompt({ outline, contextPack: {}, manuscript: '待审正文' });
    expect(review).toContain('伪聪明和假推理');
    expect(review).toContain('确定长度是4个字符');
    expect(review).toContain('不得自行估算字数');
  });

  it('rejects internal identifiers in author-facing option reviews', () => {
    const optionIds = ['option-1', 'option-2', 'option-3'];
    expect(() => parseOptionReview(JSON.stringify({
      schema: 'v7-planning-option-review-v1',
      publicSummary: '推荐方案三（optionId 123e4567-e89b-12d3-a456-426614174000），按issues修改。',
      recommendedOptionId: optionIds[2],
      differences: optionIds.map((optionId, index) => ({ optionId, difference: `方案${index + 1}抓力明确，但要留意中段节奏。` })),
      risks: [], authorDecisions: []
    }), optionIds)).toThrow('内部字段或编号');
    expect(optionReviewRepairPrompt({
      invalidOutput: '{}', validationMessage: '主编点评格式无效', optionIds,
      optionLabels: optionIds.map((optionId, index) => ({ optionId, label: `方案${index + 1}`, name: `方向${index + 1}` }))
    })).toContain('不得出现optionId、issues、schema');
  });

  it('keeps a chief rewrite verdict as explicit redesign feedback', () => {
    expect(parseOptionRevisionRequest(JSON.stringify({
      verdict: 'rewrite', summary: '三套方向过于接近，需要重新拉开路径。',
      issues: [{ evidence: '三套都沿用了同一条事件链。', requiredAction: '下一轮改变关键转折和主角代价。' }]
    }))).toEqual({
      publicSummary: '三套方向过于接近，需要重新拉开路径。',
      risks: ['三套都沿用了同一条事件链。'],
      authorDecisions: ['下一轮改变关键转折和主角代价。']
    });
  });

  it('rejects a long volume disguised as a few oversized chains', () => {
    const node = (sequence: number, start: number, end: number, wordTarget: number) => ({
      key: `volume-1:chain:${sequence}`, kind: 'chain', sequence, title: `单元链${sequence}`,
      story: { summary: '推进一次明确冲突。', majorEvents: ['触发', '升级', '兑现'], protagonistChange: '主角作出选择。', outcome: '本链得到明确结果。', nextStep: '结果触发下一链。' },
      emotion: { publicSummary: '压力抬升后释放。', openingEmotion: '紧张', pressureMovement: '逐步抬升', releaseEmotion: '短暂释放', intensity: 'moderate' },
      experience: { publicSummary: '短链内完成期待和回报。', pressureRhythm: '先紧后松', payoffCadence: '链末兑现', informationRhythm: '逐步揭示', contrastWithPrevious: '冲突升级', designReason: '服务本卷推进' },
      causality: { trigger: '上一结果触发', causes: ['人物选择'], coreConflict: '目标受阻', turningPoint: '主角改变做法', consequences: ['得到阶段结果'] },
      threads: { foreshadowing: [], openQuestions: [] },
      budget: { wordTarget, chapterRange: [start, end] }, linkedTree: { treeKind: 'chain', scopeId: `chain-${sequence}` }, children: []
    });
    const option = {
      schema: 'v7-volume-option-v1', optionKind: 'volume', publicName: '紧凑卷方案', publicSummary: '完整卷方案。',
      designRationale: '每条链短促兑现。', readerExperience: '节奏明快。', coreConflict: '求生与规则冲突。',
      protagonistChoice: '主动承担代价。', priceAndChange: '付出代价并成长。', payoff: '卷末完成阶段目标。', strengths: ['因果清晰'], risks: [],
      tree: {
        schema: 'v7-planning-tree-v1', treeKind: 'volume', scopeId: 'volume-1', title: '第一卷',
        root: {
          ...node(1, 1, 64, 180_000), key: 'volume-1', kind: 'volume', title: '第一卷', linkedTree: null,
          budget: { wordTarget: 180_000, chapterRange: [56, 64] },
          children: Array.from({ length: 8 }, (_, index) => node(index + 1, index * 8 + 1, index * 8 + 8, 22_500))
        }
      }
    };
    expect(parseVolumeOption(JSON.stringify(option), 'volume-1').tree.root.children).toHaveLength(8);
    option.tree.root.children = [
      node(1, 1, 16, 45_000), node(2, 17, 32, 45_000), node(3, 33, 48, 45_000), node(4, 49, 64, 45_000)
    ];
    expect(() => parseVolumeOption(JSON.stringify(option), 'volume-1')).toThrow('4至8章');
  });
});
