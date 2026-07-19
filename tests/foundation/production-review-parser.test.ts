import { describe, expect, it } from 'vitest';
import { parseProductionReview } from '../../apps/api/src/contracts/production-review.js';

const expected = { reviewerRole: 'literary' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-1' };

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

  it('政治或情色风险非零时强制要求位置、证据、动作和策略版本', () => {
    const experience = { reviewerRole: 'experience' as const, manuscriptVersionId: 'manuscript-1', modelSnapshotId: 'model-2' };
    expect(() => parseProductionReview(JSON.stringify({
      ...experience, verdict: 'rewrite', summary: '有风险', issues: [], scores: { compliance: 50 },
      politicalRisk: { level: 'medium', locations: [], evidence: [], recommendedAction: '定位修改', policyVersion: 'p1' },
      sexualContentRisk: { level: 'none', locations: [], evidence: [], recommendedAction: '无需修改', policyVersion: 'p1' }
    }), experience)).toThrow('必须带位置和证据');
  });
});
