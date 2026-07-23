import { describe, expect, it } from 'vitest';
import {
  compactChapterModelTaskInput,
  hasExhaustedExactManuscriptReviewAttempts,
  nextExactManuscriptReviewAttempt,
  revisionRoundForRewriteCount,
  resumedRewriteCount
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
});
