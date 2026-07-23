import { describe, expect, it } from 'vitest';
import type { EditorReviewSynthesis, ProductionReview, ReviewerRole } from '../../apps/api/src/contracts/production-review.js';
import { decideProductionReviewOutcome, isSelfContradictoryFactFinding, reportsForEditorSynthesis } from '../../apps/api/src/application/creation/production-review-service.js';

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
