import { describe, expect, it } from 'vitest';
import type { EditorReviewSynthesis, ProductionReview, ReviewerRole } from '../../apps/api/src/contracts/production-review.js';
import { decideProductionReviewOutcome, enforceReviewerResponsibilityBoundary, groundProductionReviewEvidence, isSelfContradictoryFactFinding, removeDeterministicLengthIssues, reportsForEditorSynthesis } from '../../apps/api/src/application/creation/production-review-service.js';

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
  it('keeps objective continuity authority with the fact seat', () => {
    const experience = report('experience', 'rewrite', 'major');
    experience.issues[0] = {
      location: '残图比对段', issueType: '事实衔接误差', severity: 'major',
      evidence: '他自己那张的边缘是撕的。', requiredAction: '请事实席核对两半残图。'
    };
    const normalized = enforceReviewerResponsibilityBoundary(experience);
    expect(normalized.verdict).toBe('pass');
    expect(normalized.issues[0]?.severity).toBe('minor');

    const fact = report('fact', 'rewrite', 'major');
    fact.issues[0] = experience.issues[0]!;
    expect(enforceReviewerResponsibilityBoundary(fact)).toEqual(fact);
  });

  it('downgrades a one-sentence subjective edit that a literary reviewer overstates as major', () => {
    const literary = report('literary', 'rewrite', 'major');
    literary.issues[0] = {
      location: '全文节奏，集中在暗阵节点段', issueType: '视角解释过早', severity: 'major',
      evidence: '裴玄度不是凭空布阵，他是借用了这些残阵做基础。',
      requiredAction: '删除此句，把结论留到楚白蘅后文分析拓片时说出。'
    };
    const normalized = enforceReviewerResponsibilityBoundary(literary);
    expect(normalized.verdict).toBe('pass');
    expect(normalized.issues[0]?.severity).toBe('minor');

    literary.issues[0] = {
      location: '全文节奏，集中在撤离段', issueType: '代价外化不足', severity: 'major',
      evidence: '她闷哼了一声，但剑鞘纹丝未动。',
      requiredAction: '在闷哼后加一个剑鞘压出裂痕的外化细节，并在前面插入一句知觉过渡。'
    };
    const insertedDetail = enforceReviewerResponsibilityBoundary(literary);
    expect(insertedDetail.verdict).toBe('pass');
    expect(insertedDetail.issues[0]?.severity).toBe('minor');

    literary.issues[0] = {
      location: '钟遥问完能否赢训练赛后的一句回答', issueType: '人物弧线与章末留白', severity: 'major',
      evidence: '眼位习惯、团战站位，还有临场选择。少一样，方案就可能错。',
      requiredAction: '删除或大幅压缩“眼位习惯、团战站位、临场选择”三选的具体拆解，只保留“有赢面，不是稳赢”的态度层回应，把数据需求推迟到后续章节。'
    };
    const compressedPassage = enforceReviewerResponsibilityBoundary(literary);
    expect(compressedPassage.verdict).toBe('pass');
    expect(compressedPassage.issues[0]?.severity).toBe('minor');

    literary.issues[0] = {
      location: '钟遥问“包括我的”到江序点头', issueType: '反应对位过整齐', severity: 'major',
      evidence: '她抹平折痕。江序点了一下头。',
      requiredAction: '将江序的点头推迟一两句，或让钟遥先做一个属于她自己的判断动作，然后再回应。'
    };
    const movedReaction = enforceReviewerResponsibilityBoundary(literary);
    expect(movedReaction.verdict).toBe('pass');
    expect(movedReaction.issues[0]?.severity).toBe('minor');

    literary.issues[0] = {
      location: '全章', issueType: '人物动机全面失效', severity: 'major',
      evidence: '众人没有任何行动理由。',
      requiredAction: '整章重写并重建核心人物动机。'
    };
    expect(enforceReviewerResponsibilityBoundary(literary).issues[0]?.severity).toBe('major');
  });

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

  it('结构修复时丢弃非事实席无正文证据的单条意见，但事实席仍严格拒绝', () => {
    const literary = report('literary', 'rewrite', 'major');
    literary.issues.push({
      location: '旧稿段落', issueType: '旧稿观察', severity: 'major',
      evidence: '这句话只存在于上一版正文。', requiredAction: '删除这一句。'
    });
    const manuscript = literary.issues[0]!.evidence;
    const grounded = groundProductionReviewEvidence(literary, manuscript, {
      allowGroundedEvidenceExcerptRecovery: true,
      allowDroppingUngroundedIssues: true
    });
    expect(grounded.issues).toHaveLength(1);
    expect(grounded.verdict).toBe('rewrite');

    const fact = report('fact', 'rewrite', 'major');
    fact.issues[0]!.evidence = '这句话只存在于上一版正文。';
    expect(() => groundProductionReviewEvidence(fact, '当前正文没有那一句。', {
      allowGroundedEvidenceExcerptRecovery: true,
      allowDroppingUngroundedIssues: true
    })).toThrow('必须逐字来自当前完整正文');
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

  it('把模型使用的直引号与正文弯引号视为同一段逐字证据', () => {
    const fact = report('fact', 'pass', 'minor');
    const quote = String.fromCharCode(34);
    fact.issues[0]!.evidence = `${quote}你父亲的尺子，${quote}她说，${quote}还在不在？${quote}`;
    const grounded = groundProductionReviewEvidence(fact, '“你父亲的尺子，”她说，“还在不在？”');
    expect(grounded.issues[0]?.evidence).toBe(`${quote}你父亲的尺子,${quote}她说,${quote}还在不在?${quote}`);
  });

  it('允许三字的精确时间引文进入报告，但拒绝含义不足的单字碎片', () => {
    const fact = report('fact', 'rewrite', 'major');
    fact.issues[0]!.evidence = '三天。';
    expect(groundProductionReviewEvidence(fact, '周照抬起三根手指。\n三天。').issues[0]?.evidence)
      .toBe('三天。');

    fact.issues[0]!.evidence = '天';
    expect(() => groundProductionReviewEvidence(fact, '三天。'))
      .toThrow('必须逐字来自当前完整正文');
  });

  it('结构修复会丢弃越界的AI风格样本，但不会丢弃有正文证据的文学报告', () => {
    const literary = report('literary', 'rewrite', 'major');
    literary.issues[0]!.evidence = '周照把冻裂的袖口压在膝上。';
    literary.aiStyle = {
      riskScore: 30,
      flaggedParagraphCount: 2,
      totalParagraphCount: 10,
      flaggedParagraphRatio: 0.2,
      isAuthorshipProbability: false,
      evidence: ['周照把冻裂的袖口压在膝上。', '旧稿里并不存在于本章的句子。']
    };
    expect(() => groundProductionReviewEvidence(literary, '周照把冻裂的袖口压在膝上。', {
      allowGroundedEvidenceExcerptRecovery: true
    })).toThrow('必须逐字来自当前完整正文');
    const grounded = groundProductionReviewEvidence(literary, '周照把冻裂的袖口压在膝上。', {
      allowGroundedEvidenceExcerptRecovery: true,
      allowDroppingUngroundedAiStyleEvidence: true
    });
    expect(grounded.verdict).toBe('rewrite');
    expect(grounded.issues).toHaveLength(1);
    expect(grounded.aiStyle?.evidence).toEqual(['周照把冻裂的袖口压在膝上。']);
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
