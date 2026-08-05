import { describe, expect, it } from 'vitest';
import {
  compactChapterModelTaskInput,
  decideRewriteCandidateRecovery,
  hasExhaustedExactManuscriptReviewAttempts,
  nextExactManuscriptReviewAttempt,
  revisionRoundForRewriteCount,
  rewriteLengthGuardAction,
  resumedRewriteCount,
  shouldAutomaticallyRewriteReview
} from '../../apps/api/src/application/creation/chapter-pipeline-service.js';

describe('章节审校提示合同', () => {
  it('订阅模型的紧凑审校输入保留Schema、严重级别与前史边界规则', () => {
    const requiredSchema = { type: 'object', required: ['verdict'] };
    const sourceBoundaryContract = [
      'current_manuscript是唯一待审正文',
      '不得仅凭行为后果推断主观故意'
    ];
    const severityRubric = ['局部问题不得升级为blocker'];

    expect(compactChapterModelTaskInput('review-2-literary-panel', {
      reviewerRole: 'literary',
      manuscriptVersionId: 'manuscript-1',
      modelSnapshotId: 'snapshot-1',
      requiredSchema,
      sourceBoundaryContract,
      severityRubric,
      contract: '文学审校合同',
      redundantField: '应被紧凑输入移除'
    })).toEqual({
      operation: 'review',
      reviewerRole: 'literary',
      manuscriptVersionId: 'manuscript-1',
      modelSnapshotId: 'snapshot-1',
      requiredSchema,
      sourceBoundaryContract,
      severityRubric,
      contract: '文学审校合同'
    });
  });

  it('同稿审校上限按真实完成次数计算，不把流水线轮号误当尝试次数', () => {
    expect(hasExhaustedExactManuscriptReviewAttempts(1, false)).toBe(false);
    expect(hasExhaustedExactManuscriptReviewAttempts(2, false)).toBe(false);
    expect(hasExhaustedExactManuscriptReviewAttempts(3, false)).toBe(true);
    expect(hasExhaustedExactManuscriptReviewAttempts(3, true)).toBe(false);
    expect(nextExactManuscriptReviewAttempt([1])).toBe(2);
    expect(nextExactManuscriptReviewAttempt([3])).toBe(1);
    expect(nextExactManuscriptReviewAttempt([1, 2], 2)).toBe(2);
    expect(nextExactManuscriptReviewAttempt([1, 2, 3])).toBe(4);
    expect(revisionRoundForRewriteCount(2)).toBe(3);
    expect(nextExactManuscriptReviewAttempt([1])).not.toBe(revisionRoundForRewriteCount(2));
  });

  it('同稿复审保留自动重写上限，老板主动重写获得新的有界修订窗口', () => {
    expect(resumedRewriteCount(2, true, 'review_existing')).toBe(2);
    expect(resumedRewriteCount(2, true, 'rewrite_existing')).toBe(0);
    expect(resumedRewriteCount(2, false, 'review_existing')).toBe(0);
  });
  it('does not let automatic rewrites overwrite an owner-selected finalization draft', () => {
    expect(shouldAutomaticallyRewriteReview('review_existing', 0)).toBe(false);
    expect(shouldAutomaticallyRewriteReview('review_existing', 1)).toBe(false);
    expect(shouldAutomaticallyRewriteReview('rewrite_existing', 0)).toBe(true);
    expect(shouldAutomaticallyRewriteReview(undefined, 1)).toBe(true);
    expect(shouldAutomaticallyRewriteReview(undefined, 2)).toBe(false);
  });

  it('每轮点评修订都把硬字数边界作为同级不可覆盖动作', () => {
    const action = rewriteLengthGuardAction(3_420);
    expect(action).toContain('3420个有效字符');
    expect(action).toContain('2700至3200');
    expect(action).toContain('严禁少于2350或超过3650');
    expect(action).toContain('不得破坏已通过的硬门禁');
  });

  it('点评修订破坏已通过的客观门禁时有界重试，不接纳缺陷稿也不无限循环', () => {
    expect(decideRewriteCandidateRecovery(true, false, 0)).toBe('retry_rewrite');
    expect(decideRewriteCandidateRecovery(true, false, 1)).toBe('retain_for_owner');
    expect(decideRewriteCandidateRecovery(true, true, 1)).toBe('accept');
    expect(decideRewriteCandidateRecovery(false, false, 1)).toBe('accept');
  });
});
