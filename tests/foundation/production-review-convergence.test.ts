import { describe, expect, it } from 'vitest';
import type { EditorReviewSynthesis, ProductionReview, ReviewerRole } from '../../apps/api/src/contracts/production-review.js';
import { decideProductionReviewOutcome, groundProductionReviewEvidence, isSelfContradictoryFactFinding, removeDeterministicLengthIssues, reportsForEditorSynthesis } from '../../apps/api/src/application/creation/production-review-service.js';

function report(role: ReviewerRole, verdict: ProductionReview['verdict'], severity?: 'blocker' | 'major' | 'minor'): ProductionReview {
  return {
    reviewerRole: role,
    manuscriptVersionId: 'manuscript-1',
    modelSnapshotId: `model-${role}`,
    verdict,
    summary: `${role} ${verdict}`,
    issues: severity === undefined ? [] : [{
      location: `${role}-location`,
      issueType: `${role}-issue`,
      severity,
      evidence: `${role}-evidence`,
      requiredAction: `${role}-action`
    }],
    scores: {}
  };
}

function synthesis(verdict: EditorReviewSynthesis['recommendedVerdict']): EditorReviewSynthesis {
  return {
    panelId: 'panel-1',
    manuscriptVersionId: 'manuscript-1',
    recommendedVerdict: verdict,
    priorityIssueIndexes: [0],
    preservedDisagreements: [],
    rationale: 'Preserve evidence and bounded disagreement.'
  };
}

describe('production review convergence', () => {
  it('删除越权的AI字数重判，并由确定性硬检查独占机械字数裁决', () => {
    const fact = report('fact', 'rewrite', 'major');
    fact.issues[0] = {
      location: '全章', issueType: '字数超出写作契约硬约束', severity: 'major',
      evidence: '风从窗缝钻进来。', requiredAction: 'source标注tokenCount=3707，需压缩至3650字以内。'
    };
    const normalized = removeDeterministicLengthIssues(fact);
    expect(normalized.issues).toEqual([]);
    expect(normalized.verdict).toBe('pass');
    expect(normalized.summary).toContain('确定性硬检查独立裁决');

    fact.issues.push({
      location: '第2段', issueType: '同一实体位置冲突', severity: 'major',
      evidence: '灵石碎渣仍在箱底。', requiredAction: '统一前后章位置。'
    });
    const retained = removeDeterministicLengthIssues(fact);
    expect(retained.issues).toHaveLength(1);
    expect(retained.issues[0]?.issueType).toBe('同一实体位置冲突');
    expect(retained.verdict).toBe('rewrite');
    expect(retained.summary).toContain('仍需处理的内容问题');

    const blocked = report('fact', 'blocked', 'major');
    blocked.issues[0] = {
      location: '全章', issueType: '有效字数超限', severity: 'major',
      evidence: '风从窗缝钻进来。', requiredAction: '有效字符数超过3650。'
    };
    expect(removeDeterministicLengthIssues(blocked).verdict).toBe('blocked');
  });

  it('只允许当前完整正文中的逐字证据进入审查报告和事实候选', () => {
    const fact = report('fact', 'pass');
    fact.factCandidates = [{
      subjectName: '林砚', entityType: 'character', relationKey: 'state', value: '受伤',
      evidenceQuote: '林砚左肩渗血。', evidenceLocation: '第2段', epistemicStatus: 'objective', negated: false,
      viewpointName: null, knowledgeSubjectName: null, knowledgeTimeStart: null, knowledgeTimeEnd: null,
      storyTimeStart: null, storyTimeEnd: null
    }];
    expect(groundProductionReviewEvidence(fact, '雨水打在石阶上。\n林砚左肩渗血。').factCandidates).toHaveLength(1);

    fact.factCandidates[0]!.evidenceQuote = '旧章纲写林砚十八岁';
    expect(() => groundProductionReviewEvidence(fact, '雨水打在石阶上。\n林砚左肩渗血。'))
      .toThrow('必须逐字来自当前完整正文');
    expect(groundProductionReviewEvidence(fact, '雨水打在石阶上。\n林砚左肩渗血。', {
      allowDroppingUngroundedFactCandidates: true
    }).factCandidates).toEqual([]);
  });

  it('拒绝把旧改写要求或解释性文本冒充当前正文问题证据', () => {
    const literary = report('literary', 'rewrite', 'major');
    literary.issues[0]!.evidence = '删除掏出又塞回去';
    expect(() => groundProductionReviewEvidence(literary, '周照把冻裂的袖口压在膝上。'))
      .toThrow('不能引用章纲、旧稿、作者要求或模型猜测');

    literary.issues[0]!.evidence = '周照把冻裂的袖口压在膝上。';
    expect(groundProductionReviewEvidence(literary, '周照把冻裂的袖口压在膝上。').issues[0]?.evidence)
      .toBe('周照把冻裂的袖口压在膝上。');
  });

  it('结构修复只能从混合说明中截取正文真实存在的连续原句', () => {
    const literary = report('literary', 'rewrite', 'major');
    literary.issues[0]!.evidence = '当前写法“周照把冻裂的袖口压在膝上。”说明动作还可压缩。';
    const grounded = groundProductionReviewEvidence(literary, '风从窗缝钻进来。周照把冻裂的袖口压在膝上。', {
      allowGroundedEvidenceExcerptRecovery: true
    });
    expect(grounded.issues[0]?.evidence).toBe('周照把冻裂的袖口压在膝上。');

    literary.issues[0]!.evidence = '旧章纲要求补写方无咎布置下一步。';
    expect(() => groundProductionReviewEvidence(literary, '风从窗缝钻进来。', {
      allowGroundedEvidenceExcerptRecovery: true
    })).toThrow('必须逐字来自当前完整正文');
  });

  it('rewrites a single literary major finding during the bounded rewrite rounds', () => {
    const result = decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), report('literary', 'rewrite', 'major'), report('experience', 'pass')],
      editorSynthesis: synthesis('rewrite'),
      revisionRound: 1
    });
    expect(result).toEqual({ blocked: false, rewrite: true, boundedSingleSubjectiveDissent: false });
  });

  it('preserves one remaining subjective dissent for owner confirmation after two rewrites', () => {
    const result = decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), report('literary', 'rewrite', 'major'), report('experience', 'pass')],
      editorSynthesis: synthesis('blocked'),
      revisionRound: 3
    });
    expect(result).toEqual({ blocked: false, rewrite: false, boundedSingleSubjectiveDissent: true });
  });

  it('never applies the convergence exception to fact, blocker, compliance or corroborated hard findings', () => {
    const fact = decideProductionReviewOutcome({
      reports: [report('fact', 'rewrite', 'major'), report('literary', 'pass'), report('experience', 'pass')],
      editorSynthesis: synthesis('rewrite'),
      revisionRound: 3
    });
    expect(fact).toMatchObject({ blocked: false, rewrite: true, boundedSingleSubjectiveDissent: false });

    const blocker = decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), report('literary', 'blocked', 'blocker'), report('experience', 'pass')],
      editorSynthesis: synthesis('blocked'),
      revisionRound: 3
    });
    expect(blocker).toMatchObject({ blocked: true, rewrite: false, boundedSingleSubjectiveDissent: false });

    const experience = report('experience', 'rewrite', 'major');
    experience.politicalRisk = {
      level: 'medium', locations: ['paragraph 4'], evidence: ['risk evidence'],
      recommendedAction: 'revise', policyVersion: 'test-v1'
    };
    const compliance = decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), report('literary', 'pass'), experience],
      editorSynthesis: synthesis('rewrite'),
      revisionRound: 3
    });
    expect(compliance).toMatchObject({ blocked: false, rewrite: true, boundedSingleSubjectiveDissent: false });

    const corroborated = decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), report('literary', 'rewrite', 'major'), report('experience', 'rewrite', 'major')],
      editorSynthesis: synthesis('rewrite'),
      revisionRound: 3
    });
    expect(corroborated).toMatchObject({ blocked: false, rewrite: true, boundedSingleSubjectiveDissent: false });
  });

  it('does not let editor synthesis alone promote fixable major issues into blocked', () => {
    const result = decideProductionReviewOutcome({
      reports: [report('fact', 'rewrite', 'major'), report('literary', 'pass'), report('experience', 'pass')],
      editorSynthesis: synthesis('blocked'),
      revisionRound: 2
    });
    expect(result).toEqual({ blocked: false, rewrite: true, boundedSingleSubjectiveDissent: false });
  });

  it('routes a literary-only objective canon blocker back to bounded review when the fact seat explicitly passes', () => {
    const literary = report('literary', 'blocked', 'blocker');
    literary.issues[0]!.issueType = '正史断裂';
    const roundTwo = decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), literary, report('experience', 'pass')],
      editorSynthesis: synthesis('blocked'),
      revisionRound: 2
    });
    expect(roundTwo).toEqual({ blocked: false, rewrite: true, boundedSingleSubjectiveDissent: false });

    const roundThree = decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), literary, report('experience', 'pass')],
      editorSynthesis: synthesis('blocked'),
      revisionRound: 3
    });
    expect(roundThree).toEqual({ blocked: false, rewrite: false, boundedSingleSubjectiveDissent: true });
  });

  it('does not let a literary rewrite verdict smuggle an uncorroborated continuity blocker past the fact seat', () => {
    const literary = report('literary', 'rewrite', 'blocker');
    literary.issues[0]!.issueType = 'continuity conflict';
    const roundTwo = decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), literary, report('experience', 'pass')],
      editorSynthesis: synthesis('rewrite'),
      revisionRound: 2
    });
    expect(roundTwo).toEqual({ blocked: false, rewrite: true, boundedSingleSubjectiveDissent: false });

    const roundThree = decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), literary, report('experience', 'pass')],
      editorSynthesis: synthesis('rewrite'),
      revisionRound: 3
    });
    expect(roundThree).toEqual({ blocked: false, rewrite: false, boundedSingleSubjectiveDissent: true });
  });

  it('keeps literary blockers outside the fact-seat authority boundary fully blocking', () => {
    const literary = report('literary', 'blocked', 'blocker');
    literary.issues[0]!.issueType = '核心人物动机崩塌';
    expect(decideProductionReviewOutcome({
      reports: [report('fact', 'pass'), literary, report('experience', 'pass')],
      editorSynthesis: synthesis('blocked'),
      revisionRound: 3
    })).toEqual({ blocked: true, rewrite: false, boundedSingleSubjectiveDissent: false });
  });

  it('主编综合保留裁决证据但不重复携带事实晋升候选', () => {
    const fact = report('fact', 'pass');
    fact.factCandidates = [{
      subjectName: '林砚', entityType: 'character', relationKey: 'state', value: '受伤',
      evidenceQuote: '林砚左肩渗血。', evidenceLocation: '第2段', epistemicStatus: 'objective', negated: false,
      viewpointName: null, knowledgeSubjectName: null, knowledgeTimeStart: null, knowledgeTimeEnd: null,
      storyTimeStart: null, storyTimeEnd: null
    }];
    const literary = report('literary', 'rewrite', 'major');
    literary.aiStyle = {
      riskScore: 20, flaggedParagraphCount: 1, totalParagraphCount: 10,
      flaggedParagraphRatio: 0.1, isAuthorshipProbability: false, evidence: ['第3段套话']
    };
    const compact = reportsForEditorSynthesis([fact, literary, report('experience', 'pass')]);
    expect(compact[0]).not.toHaveProperty('factCandidates');
    expect(compact[1]).toMatchObject({ issues: literary.issues, aiStyle: literary.aiStyle });
  });

  it('事实席证据含矛盾软化词却标硬冲突时报告无效，不生成重写单（三百步反例）', () => {
    const fact = report('fact', 'rewrite', 'major');
    fact.issues[0]!.issueType = '正史冲突';
    fact.issues[0]!.evidence = '章纲称三百步内可达，正文写不到三百步，两者在数学上与语义上是一致的';
    expect(isSelfContradictoryFactFinding(fact)).toBe(true);
    const result = decideProductionReviewOutcome({
      reports: [fact, report('literary', 'pass'), report('experience', 'pass')],
      editorSynthesis: synthesis('rewrite'),
      revisionRound: 1
    });
    expect(result.rewrite).toBe(false);
    expect(result.blocked).toBe(true);
  });
});
