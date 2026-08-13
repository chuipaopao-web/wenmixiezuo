import { describe, expect, it } from 'vitest';
import { parseEditorReviewSynthesis, parseProductionReview } from '../../apps/api/src/contracts/production-review.js';

const expected = { reviewerRole: 'literary' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-1' };

it('仅一次性修复通道可以恢复冻结绑定标识', () => {
  const frozen = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-correct', modelSnapshotId: 'model-correct' };
  const raw = JSON.stringify({
    ...frozen,
    manuscriptVersionId: 'manuscript-miscopied',
    verdict: 'pass',
    summary: '事实检查通过',
    issues: [],
    scores: { continuity: 90 },
    factCandidates: []
  });

  expect(() => parseProductionReview(raw, frozen)).toThrow('manuscriptVersionId与冻结任务不一致');
  expect(parseProductionReview(raw, frozen, { normalizeFrozenBindings: true }))
    .toEqual(expect.objectContaining(frozen));
});

describe('三点评结构化契约', () => {
  it('接受可解释的AI腔风险但明确拒绝作者概率', () => {
    const report = parseProductionReview(JSON.stringify({
      ...expected, verdict: 'pass', summary: '通过', issues: [], scores: { literary: 90 },
      aiStyle: { riskScore: 10, flaggedParagraphCount: 1, totalParagraphCount: 10, flaggedParagraphRatio: 0.1, isAuthorshipProbability: false, evidence: ['第2段套话'] }
    }), expected);
    expect(report.aiStyle?.flaggedParagraphRatio).toBe(0.1);
    expect(() => parseProductionReview(JSON.stringify({
      ...expected, verdict: 'pass', summary: '通过', issues: [], scores: { literary: 90 },
      aiStyle: { riskScore: 80, flaggedParagraphCount: 1, totalParagraphCount: 10, flaggedParagraphRatio: 0.1, isAuthorshipProbability: true, evidence: ['猜测AI生成'] }
    }), expected)).toThrow('不得冒充AI作者概率');
  });

  it('按段落计数重算AI腔比例并接受常规小数舍入', () => {
    const report = parseProductionReview(JSON.stringify({
      ...expected, verdict: 'rewrite', summary: '需要定点修改', issues: [], scores: { literary: 70 },
      aiStyle: { riskScore: 67, flaggedParagraphCount: 4, totalParagraphCount: 47, flaggedParagraphRatio: 0.085, isAuthorshipProbability: false, evidence: ['第14段概念化表达'] }
    }), expected);
    expect(report.aiStyle?.flaggedParagraphRatio).toBeCloseTo(4 / 47, 12);
  });

  it('只在一次修复后把AI腔证据对象无损转为可追溯文本', () => {
    const raw = JSON.stringify({
      ...expected, verdict: 'rewrite', summary: '需要定点修改', issues: [], scores: { literary: 70 },
      aiStyle: {
        riskScore: 25, flaggedParagraphCount: 1, totalParagraphCount: 10, flaggedParagraphRatio: 0.1,
        isAuthorshipProbability: false,
        evidence: [{ paragraphIndex: 2, text: '像一段预制的警句。', pattern: '抽象判断', confidence: 0.72 }]
      }
    });
    expect(() => parseProductionReview(raw, expected)).toThrow('aiStyle.evidence必须是字符串数组');
    const repaired = parseProductionReview(raw, expected, { normalizeAiStyleEvidence: true });
    expect(repaired.aiStyle?.evidence).toEqual([
      '{"paragraphIndex":2,"text":"像一段预制的警句。","pattern":"抽象判断","confidence":0.72}'
    ]);
  });

  it('修复通道保留数值评分并忽略scores中的非数值附加统计', () => {
    const raw = JSON.stringify({
      ...expected,
      verdict: 'rewrite',
      summary: '两处因果问题需要定点修改',
      issues: [{
        location: '第一幕', issueType: '场景因果', severity: 'major',
        evidence: '证据数量与指控数量不一致', requiredAction: '补齐反驳与压制过程'
      }],
      scores: {
        narrativeMomentum: 78,
        sceneLogic: 58,
        issueSeverityDistribution: { blocker: 0, major: 1, minor: 0 }
      },
      aiStyle: {
        riskScore: 20, flaggedParagraphCount: 1, totalParagraphCount: 20,
        flaggedParagraphRatio: 0.05, isAuthorshipProbability: false, evidence: ['第3段排比略整齐']
      }
    });
    expect(() => parseProductionReview(raw, expected)).toThrow('issueSeverityDistribution无效');
    const repaired = parseProductionReview(raw, expected, { normalizeScoreArray: true });
    expect(repaired.scores).toEqual({ narrativeMomentum: 78, sceneLogic: 58 });
    expect(repaired.verdict).toBe('rewrite');
    expect(repaired.issues).toHaveLength(1);
  });

  it('只在一次修复后把明确的minor_issues枚举归一为通过且保留问题', () => {
    const fact = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-fact' };
    const raw = JSON.stringify({
      ...fact, verdict: 'minor_issues', summary: '只有一处轻微连续性问题',
      issues: [{ location: '第2段', issueType: 'continuity', severity: 'minor', evidence: '钥匙位置略模糊', requiredAction: '补一句空间过渡' }],
      scores: { continuity: 88 }, factCandidates: []
    });
    expect(() => parseProductionReview(raw, fact)).toThrow('verdict无效');
    const repaired = parseProductionReview(raw, fact, { normalizeRepairedVerdict: true });
    expect(repaired.verdict).toBe('pass');
    expect(repaired.issues).toHaveLength(1);
    expect(repaired.issues[0]?.severity).toBe('minor');
  });

  it('拒绝pass与major自相矛盾，并在一次修复路径中保留严重度改为rewrite', () => {
    const fact = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-fact' };
    const raw = JSON.stringify({
      ...fact, verdict: 'pass', summary: '仍列出一个重大连续性问题',
      issues: [{ location: '第5段与第9段', issueType: 'continuity', severity: 'major', evidence: '同一道具先毁后出现', requiredAction: '统一道具状态' }],
      scores: { continuity: 60 }, factCandidates: []
    });
    expect(() => parseProductionReview(raw, fact)).toThrow('pass结论不能包含major或blocker');
    const repaired = parseProductionReview(raw, fact, { normalizeRepairedVerdict: true });
    expect(repaired.verdict).toBe('rewrite');
    expect(repaired.issues[0]?.severity).toBe('major');
  });

  it('事实席不能把未重复前文细节升级为major，修复路径降为软提醒并通过', () => {
    const fact = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-fact' };
    const raw = JSON.stringify({
      ...fact, verdict: 'rewrite', summary: '遗漏了一项前章细节',
      issues: [{
        location: '归还单检查段落', issueType: '遗漏关键物证细节', severity: 'major',
        evidence: '前章定稿写过日期栏涂改痕迹，本章详细检查时完全未提及该痕迹。',
        requiredAction: '在检查段落中插入一句对日期栏涂改痕迹的观察。'
      }],
      scores: { continuity: 80 }, factCandidates: []
    });
    expect(() => parseProductionReview(raw, fact)).toThrow('不能把未重复前文细节判为major');
    const repaired = parseProductionReview(raw, fact, {
      normalizeFactOmissionMajor: true,
      normalizeRepairedVerdict: true
    });
    expect(repaired.verdict).toBe('pass');
    expect(repaired.issues[0]?.severity).toBe('minor');
  });

  it('事实席仍把章纲硬要求缺失保留为major', () => {
    const fact = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-fact' };
    const raw = JSON.stringify({
      ...fact, verdict: 'rewrite', summary: '缺少章纲强制结尾',
      issues: [{
        location: '章末', issueType: '遗漏章纲硬要求', severity: 'major',
        evidence: '章纲requiredEnding要求主角取得账本，本章完全未提及且导致下一章因果无法成立。',
        requiredAction: '在章末补充一句取得账本的明确动作。'
      }],
      scores: { continuity: 50 }, factCandidates: []
    });
    expect(parseProductionReview(raw, fact).issues[0]?.severity).toBe('major');
  });

  it('拒绝把可以定点修改的普通质量问题标成阻断', () => {
    const raw = JSON.stringify({
      ...expected, verdict: 'rewrite', summary: '人物动机需要补强', scores: { literary: 70 },
      issues: [{ location: '第3段', issueType: 'motivation', severity: 'blocker', evidence: '折返前缺少触发', requiredAction: '在折返前补入一个身体记忆触发。' }],
      aiStyle: { riskScore: 10, flaggedParagraphCount: 0, totalParagraphCount: 10, flaggedParagraphRatio: 0, isAuthorshipProbability: false, evidence: [] }
    });
    expect(() => parseProductionReview(raw, expected)).toThrow('blocker只用于不能自动定点修复');
    expect(parseProductionReview(raw, expected, { normalizeLocalBlockers: true }).issues[0]?.severity).toBe('major');
  });

  it('修复稿没有真实blocker时只把blocked降为rewrite而不降为pass', () => {
    const raw = JSON.stringify({
      ...expected, verdict: 'blocked', summary: '需要定点修改', scores: { literary: 65 },
      issues: [{ location: '结尾', issueType: 'hook', severity: 'major', evidence: '钩子对象不清', requiredAction: '重写最后一句，明确钩子对象。' }],
      aiStyle: { riskScore: 10, flaggedParagraphCount: 0, totalParagraphCount: 10, flaggedParagraphRatio: 0, isAuthorshipProbability: false, evidence: [] }
    });
    expect(() => parseProductionReview(raw, expected)).toThrow('blocked结论必须至少包含一个');
    const repaired = parseProductionReview(raw, expected, { normalizeLocalBlockers: true });
    expect(repaired.verdict).toBe('rewrite');
    expect(repaired.issues[0]?.severity).toBe('major');
  });

  it('政治或情色风险非零时强制要求位置、证据、动作和策略版本', () => {
    const experience = { reviewerRole: 'experience' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-2' };
    expect(() => parseProductionReview(JSON.stringify({
      ...experience, verdict: 'rewrite', summary: '有风险', issues: [], scores: { compliance: 50 },
      politicalRisk: { level: 'medium', locations: [], evidence: [], recommendedAction: '定位修改', policyVersion: 'p1' },
      sexualContentRisk: { level: 'none', locations: [], evidence: [], recommendedAction: '无需修改', policyVersion: 'p1' }
    }), experience)).toThrow('必须带位置和证据');
  });

  it('只规范化不改变含义的中文通过枚举与none级空证据', () => {
    const experience = { reviewerRole: 'experience' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-2' };
    const parsed = parseProductionReview(JSON.stringify({
      ...experience, verdict: '通过', summary: '正文合规且具备追读动力。', issues: [], scores: { 追读意愿: 93 },
      politicalRisk: { level: 'none', locations: [], evidence: '', recommendedAction: '无', policyVersion: '当前版本' },
      sexualContentRisk: { level: 'none', locations: [], evidence: '', recommendedAction: '无', policyVersion: '当前版本' }
    }), experience);
    expect(parsed.verdict).toBe('pass');
    expect(parsed.politicalRisk?.evidence).toEqual([]);
    expect(parsed.sexualContentRisk?.evidence).toEqual([]);
  });

  it('只在一次修复后把风险位置与证据文本无损包装成数组', () => {
    const experience = { reviewerRole: 'experience' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-2' };
    const raw = JSON.stringify({
      ...experience, verdict: 'pass', summary: '正文合规。', issues: [], scores: { compliance: 95 },
      politicalRisk: { level: 'none', locations: '', evidence: '架空世界，不涉及现实政治。', recommendedAction: '无', policyVersion: 'p1' },
      sexualContentRisk: { level: 'none', locations: [], evidence: '没有涉性内容。', recommendedAction: '无', policyVersion: 'p1' }
    });
    expect(() => parseProductionReview(raw, experience)).toThrow('必须是字符串数组');
    const repaired = parseProductionReview(raw, experience, { normalizeRiskArrays: true });
    expect(repaired.politicalRisk).toMatchObject({ locations: [], evidence: ['架空世界，不涉及现实政治。'] });
    expect(repaired.sexualContentRisk?.evidence).toEqual(['没有涉性内容。']);
  });

  it('none级风险在修复路径保留空动作且不伪造建议', () => {
    const experience = { reviewerRole: 'experience' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-2' };
    const raw = JSON.stringify({
      ...experience, verdict: 'pass', summary: '没有合规风险。', issues: [], scores: { compliance: 100 },
      politicalRisk: { level: 'none', locations: [], evidence: '', recommendedAction: '', policyVersion: 'p1' },
      sexualContentRisk: { level: 'none', locations: [], evidence: '', recommendedAction: '', policyVersion: 'p1' }
    });
    expect(() => parseProductionReview(raw, experience)).toThrow('recommendedAction缺失');
    const repaired = parseProductionReview(raw, experience, { normalizeRiskArrays: true });
    expect(repaired.politicalRisk?.recommendedAction).toBe('');
    expect(repaired.sexualContentRisk?.recommendedAction).toBe('');
  });

  it('只在一次修复后把评分对象数组无损归一为评分映射', () => {
    const experience = { reviewerRole: 'experience' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-2' };
    const raw = JSON.stringify({
      ...experience, verdict: 'pass', summary: '正文合规且具备追读动力。', issues: [],
      scores: [
        { dimension: 'opening_gripping', score: 80, reason: '开篇有效。' },
        { dimension: 'information_hook', score: 90, reason: '钩子明确。' }
      ],
      politicalRisk: { level: 'none', locations: [], evidence: [], recommendedAction: '无', policyVersion: 'p1' },
      sexualContentRisk: { level: 'none', locations: [], evidence: [], recommendedAction: '无', policyVersion: 'p1' }
    });
    expect(() => parseProductionReview(raw, experience)).toThrow('scores必须是对象');
    expect(parseProductionReview(raw, experience, { normalizeScoreArray: true }).scores).toEqual({
      opening_gripping: 80,
      information_hook: 90
    });
  });

  it('只在一次修复后把结构化问题位置无损保存为可追溯文本', () => {
    const experience = { reviewerRole: 'experience' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-2' };
    const raw = JSON.stringify({
      ...experience, verdict: 'pass', summary: '只有轻微体验建议。',
      issues: [{
        location: { sourceId: 'manuscript-1', startChar: 12, endChar: 28, lineNumber: 2 },
        issueType: 'scene_transition', severity: 'minor', evidence: '空间转换稍快。', requiredAction: '补一句过渡动作。'
      }],
      scores: { experience: 86 },
      politicalRisk: { level: 'none', locations: [], evidence: [], recommendedAction: '无', policyVersion: 'p1' },
      sexualContentRisk: { level: 'none', locations: [], evidence: [], recommendedAction: '无', policyVersion: 'p1' }
    });
    expect(() => parseProductionReview(raw, experience)).toThrow('location无效');
    expect(parseProductionReview(raw, experience, { normalizeIssueLocations: true }).issues[0]?.location)
      .toBe('{"sourceId":"manuscript-1","startChar":12,"endChar":28,"lineNumber":2}');
  });

  it('只在修复结果中按严重程度保留最多八条点评问题', () => {
    const issues = Array.from({ length: 9 }, (_, index) => ({
      location: `第${index + 1}段`, issueType: 'style', severity: index === 8 ? 'major' : 'observation',
      evidence: `证据${index + 1}`, requiredAction: `修改${index + 1}`
    }));
    const raw = JSON.stringify({
      ...expected, verdict: 'rewrite', summary: '问题过多，需要只保留最重要的内容。', issues,
      scores: { literary: 60 },
      aiStyle: { riskScore: 10, flaggedParagraphCount: 0, totalParagraphCount: 10, flaggedParagraphRatio: 0, isAuthorshipProbability: false, evidence: [] }
    });
    expect(() => parseProductionReview(raw, expected)).toThrow('单席点评问题超过8条上限');
    const repaired = parseProductionReview(raw, expected, { normalizeIssueLimit: true });
    expect(repaired.issues).toHaveLength(8);
    expect(repaired.issues[0]).toMatchObject({ severity: 'major', evidence: '证据9' });
  });

  it('只在一次修复后把moderate严重度保守归入major', () => {
    const raw = JSON.stringify({
      ...expected, verdict: 'rewrite', summary: '存在中等程度问题。',
      issues: [{ location: '结尾', issueType: 'hook', severity: 'moderate', evidence: '钩子对象略显模糊。', requiredAction: '明确钩子对象。' }],
      scores: { literary: 65 },
      aiStyle: { riskScore: 10, flaggedParagraphCount: 0, totalParagraphCount: 10, flaggedParagraphRatio: 0, isAuthorshipProbability: false, evidence: [] }
    });
    expect(() => parseProductionReview(raw, expected)).toThrow('severity无效');
    expect(parseProductionReview(raw, expected, { normalizeRepairedSeverity: true }).issues[0]?.severity).toBe('major');
  });

  it('只在一次修复后无损接收requiredFix字段别名', () => {
    const raw = JSON.stringify({
      ...expected, verdict: 'pass', summary: '只有轻微措辞建议。',
      issues: [{ location: '第3段', issueType: 'style', severity: 'minor', evidence: '句式略显对称。', requiredFix: '改成具体动作。' }],
      scores: { literary: 82 },
      aiStyle: { riskScore: 10, flaggedParagraphCount: 0, totalParagraphCount: 10, flaggedParagraphRatio: 0, isAuthorshipProbability: false, evidence: [] }
    });
    expect(() => parseProductionReview(raw, expected)).toThrow('requiredAction无效');
    expect(parseProductionReview(raw, expected, { normalizeIssueFieldAliases: true }).issues[0]?.requiredAction)
      .toBe('改成具体动作。');
  });

  it('事实席必须返回带原文证据和认知状态的结构化候选', () => {
    const fact = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-fact' };
    const parsed = parseProductionReview(JSON.stringify({
      ...fact, verdict: 'pass', summary: '事实通过', issues: [], scores: { continuity: 92 },
      factCandidates: [{
        subjectName: '张三', entityType: 'character', relationKey: 'declared_war_on', value: '天安城',
        evidenceQuote: '张三今日向天安城宣战。', evidenceLocation: '第12段',
        epistemicStatus: 'objective', negated: false, viewpointName: null, knowledgeSubjectName: null,
        knowledgeTimeStart: null, knowledgeTimeEnd: null, storyTimeStart: '第三日', storyTimeEnd: null
      }]
    }), fact);
    expect(parsed.factCandidates?.[0]).toMatchObject({ subjectName: '张三', relationKey: 'declared_war_on' });
    expect(() => parseProductionReview(JSON.stringify({
      ...fact, verdict: 'pass', summary: '事实通过', issues: [], scores: { continuity: 92 }
    }), fact)).toThrow('factCandidates');
  });

  it('限制单章点评与事实候选数量，避免长输出挤压注意力并污染正史', () => {
    const fact = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-fact' };
    const candidate = {
      subjectName: '张三', entityType: 'character', relationKey: 'state', value: 'active', evidenceQuote: '张三站起身。',
      evidenceLocation: '第1段', epistemicStatus: 'objective', negated: false, viewpointName: null,
      knowledgeSubjectName: null, knowledgeTimeStart: null, knowledgeTimeEnd: null, storyTimeStart: null, storyTimeEnd: null
    };
    expect(() => parseProductionReview(JSON.stringify({
      ...fact, verdict: 'pass', summary: '事实通过', issues: [], scores: { continuity: 90 },
      factCandidates: Array.from({ length: 17 }, () => candidate)
    }), fact)).toThrow('超过16条上限');
    expect(() => parseProductionReview(JSON.stringify({
      ...fact, verdict: 'rewrite', summary: '问题过多',
      issues: Array.from({ length: 9 }, (_, index) => ({ location: `第${index + 1}段`, issueType: 'continuity', severity: 'minor', evidence: '原句', requiredAction: '定点修改' })),
      scores: { continuity: 70 }, factCandidates: []
    }), fact)).toThrow('超过8条上限');
  });

  it('仅在一次修复后丢弃字段不完整的事实候选且不猜测缺失语义', () => {
    const fact = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-fact' };
    const valid = {
      subjectName: '林砚', entityType: 'character', relationKey: 'state', value: '受伤', evidenceQuote: '掌心被铁锈割开。',
      evidenceLocation: '开头', epistemicStatus: 'objective', negated: false, viewpointName: null,
      knowledgeSubjectName: null, knowledgeTimeStart: null, knowledgeTimeEnd: null, storyTimeStart: null, storyTimeEnd: null
    };
    const invalid = { ...valid, subjectName: '守塔人' } as Record<string, unknown>;
    delete invalid.negated;
    const raw = JSON.stringify({
      ...fact, verdict: 'rewrite', summary: '有一处连续性问题', issues: [], scores: { continuity: 80 },
      factCandidates: [valid, invalid]
    });
    expect(() => parseProductionReview(raw, fact)).toThrow('negated');
    expect(parseProductionReview(raw, fact, { allowDroppingInvalidFactCandidates: true }).factCandidates)
      .toEqual([valid]);
  });

  it('仅在一次修复后转义字符串内部的模型双引号且不改变字段语义', () => {
    const fact = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-fact' };
    const malformed = `{
      "reviewerRole":"fact",
      "manuscriptVersionId":"manuscript-1",
      "modelSnapshotId":"model-fact",
      "verdict":"pass",
      "summary":"账簿写着"灰塔零号"，但结论不变。",
      "issues":[],
      "scores":{"continuity":90},
      "factCandidates":[]
    }`;
    expect(() => parseProductionReview(malformed, fact)).toThrow('JSON无法解析');
    const parsed = parseProductionReview(malformed, fact, { normalizeMalformedJsonStrings: true });
    expect(parsed.summary).toBe('账簿写着"灰塔零号"，但结论不变。');
    expect(parsed).toMatchObject({ verdict: 'pass', scores: { continuity: 90 }, factCandidates: [] });
  });

  it('仅在一次修复后补回相邻已知字段之间漏掉的JSON逗号', () => {
    const fact = { reviewerRole: 'fact' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-fact' };
    const malformed = `{
      "reviewerRole":"fact",
      "manuscriptVersionId":"manuscript-1",
      "modelSnapshotId":"model-fact",
      "verdict":"pass",
      "summary":"事实一致",
      "issues":[{
        "location":"第7段",
        "issueType":"人物状态",
        "severity":"minor",
        "evidence":"伤情正在好转"
        "requiredAction":"后续保持同一状态基线"
      }],
      "scores":{"continuity":90},
      "factCandidates":[]
    }`;
    expect(() => parseProductionReview(malformed, fact)).toThrow('JSON无法解析');
    const repaired = parseProductionReview(malformed, fact, { normalizeMalformedJsonStrings: true });
    expect(repaired.issues[0]).toMatchObject({
      evidence: '伤情正在好转',
      requiredAction: '后续保持同一状态基线'
    });
  });

  it('主编修复结果只做有界结构归一化且首轮仍严格拒绝', () => {
    const expectedSynthesis = { panelId: 'panel-1', manuscriptVersionId: 'manuscript-1', issueCount: 3 };
    const raw = JSON.stringify({
      panelId: 'panel-1', manuscriptVersionId: 'manuscript-1', recommendedVerdict: 'rewrite',
      priorityIssueIndexes: [0, 0, 2, 99],
      preservedDisagreements: {
        fact_vs_literary: '事实席通过，但文学席要求修正文风。',
        experience_vs_literary: '体验席保留开篇抓力，文学席要求修复钩子。'
      },
      rationale: '保留真实分歧并定点重写。'
    });
    expect(() => parseEditorReviewSynthesis(raw, expectedSynthesis)).toThrow();
    expect(parseEditorReviewSynthesis(raw, expectedSynthesis, { normalizeRepairedShape: true })).toMatchObject({
      priorityIssueIndexes: [0, 2],
      preservedDisagreements: [
        'fact_vs_literary: 事实席通过，但文学席要求修正文风。',
        'experience_vs_literary: 体验席保留开篇抓力，文学席要求修复钩子。'
      ]
    });
  });

  it('主编修复结果把分歧对象数组无损保存为可追溯文本', () => {
    const parsed = parseEditorReviewSynthesis(JSON.stringify({
      panelId: 'panel-2', manuscriptVersionId: 'manuscript-2', recommendedVerdict: 'rewrite',
      priorityIssueIndexes: [0],
      preservedDisagreements: [{ issueIndex: 0, disagreement: '事实席通过，文学席要求重写。' }],
      rationale: '保留真实分歧。'
    }), { panelId: 'panel-2', manuscriptVersionId: 'manuscript-2', issueCount: 1 }, { normalizeRepairedShape: true });
    expect(parsed.preservedDisagreements).toEqual([
      '{"issueIndex":0,"disagreement":"事实席通过，文学席要求重写。"}'
    ]);
  });

  it('binds repaired editor synthesis to the server-known panel and manuscript ids', () => {
    const expected = { panelId: 'panel-canonical', manuscriptVersionId: 'manuscript-canonical', issueCount: 1 };
    const raw = JSON.stringify({
      panelId: 'panel-one-character-typo',
      manuscriptVersionId: 'manuscript-one-character-typo',
      recommendedVerdict: 'pass',
      priorityIssueIndexes: [0],
      preservedDisagreements: [],
      rationale: 'All three submitted reports passed.'
    });

    expect(() => parseEditorReviewSynthesis(raw, expected)).toThrow();
    expect(parseEditorReviewSynthesis(raw, expected, { normalizeRepairedShape: true })).toMatchObject({
      panelId: expected.panelId,
      manuscriptVersionId: expected.manuscriptVersionId,
      recommendedVerdict: 'pass'
    });
  });
});
