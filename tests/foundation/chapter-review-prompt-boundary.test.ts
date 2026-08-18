import { describe, expect, it } from 'vitest';
import {
  compactChapterModelTaskInput,
  chapterReviewSourceBoundaryContract,
  compactWriterPromptSources,
  boundedRewriteCountAfterAttempt,
  decideRewriteCandidateRecovery,
  decideUnchangedRewriteRecovery,
  finalLengthHardRepairAction,
  isBoundedLengthHardRepairEligible,
  isFinalLengthOnlyRepairEligible,
  hasExhaustedExactManuscriptReviewAttempts,
  nextExactManuscriptReviewAttempt,
  revisionRoundForRewriteCount,
  rewriteLengthGuardAction,
  recollectionContinuityReviewRule,
  characterPlanOrderReviewRule,
  factInferenceBoundaryReviewRules,
  experienceReviewJurisdictionRule,
  literaryReviewJurisdictionRule,
  shouldStopHardCheckRepair,
  resumedRewriteCount,
  shouldAutomaticallyRewriteReview,
  targetedRewriteContractCharacterLimit,
  isTargetedRewriteContractSource
} from '../../apps/api/src/application/creation/chapter-pipeline-service.js';

describe('章节审校提示合同', () => {
  it('主笔只接收有创作意义的资料，不接收ID、哈希、优先级和检索理由', () => {
    const compact = compactWriterPromptSources([{
      sourceType: 'previous_chapter_tail', sourceId: 'version-1', version: 3,
      content: '她推开门，雪从门缝里扑进来。', reason: '前章结尾原文', priority: 100,
      tokenCount: 20, hard: true
    }, {
      sourceType: 'retrieval:voice', sourceId: 'chunk-2', content: '他说话一向简短。',
      reason: '向量召回', priority: 70, hard: false
    }]);
    expect(compact).toEqual([
      { role: '上一章结尾原文', required: true, content: '她推开门，雪从门缝里扑进来。' },
      { role: '与本章有关的人物声音', required: false, content: '他说话一向简短。' }
    ]);
    expect(JSON.stringify(compact)).not.toMatch(/sourceId|version|priority|reason|tokenCount/u);
  });
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
  it('treats explicit recollection as continuity rather than a repeated event', () => {
    const rule = recollectionContinuityReviewRule();
    expect(rule).toContain('昨夜');
    expect(rule).toContain('回忆');
    expect(rule).toContain('必须同时引用重复发生的两端证据');
  });

  it('does not turn a character plan into a rigid first-line execution order', () => {
    const rule = characterPlanOrderReviewRule();
    expect(rule).toContain('行动意图');
    expect(rule).toContain('不自动锁死下一章第一句话或动作顺序');
    expect(rule).toContain('仍完成该意图');
  });

  it('prevents fact review from inventing timing, knowledge-boundary, or ending-order conflicts', () => {
    const rules = factInferenceBoundaryReviewRules().join('');
    expect(rules).toContain('自行估算');
    expect(rules).toContain('两个互相排斥的明确时间戳');
    expect(rules).toContain('不得臆造两个数量之间的一一对应关系');
    expect(rules).toContain('累计获得过三次奖励');
    expect(rules).toContain('同一对象、同一指标、同一范围');
    expect(rules).toContain('公开来源本身不能判major');
    expect(rules).toContain('requiredEndingState约束本章结束时');
    expect(rules).toContain('不默认锁死具体句子');
  });

  it('keeps canon and continuity verdicts out of the experience reviewer', () => {
    const rule = experienceReviewJurisdictionRule();
    expect(rule).toContain('由事实席独立裁决');
    expect(rule).toContain('不得把这类客观核对判为blocker');
    expect(rule).toContain('不得要求作者再次确认');
  });

  it('keeps knowledge-boundary and canon verdicts out of the literary reviewer', () => {
    const rule = literaryReviewJurisdictionRule();
    expect(rule).toContain('均由事实席裁决');
    expect(rule).toContain('不得以“可能泄露事实”');
    expect(rule).toContain('必须降为minor并给出pass');
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
    expect(decideRewriteCandidateRecovery(true, false, 1, true)).toBe('retry_hard_repair');
    expect(decideRewriteCandidateRecovery(true, false, 2, true)).toBe('retain_for_owner');
    expect(decideRewriteCandidateRecovery(true, true, 1)).toBe('accept');
    expect(decideRewriteCandidateRecovery(false, false, 1)).toBe('accept');
  });

  it('模型重复返回同一稿时不重复登记版本或硬检查，并在有界次数后安全收敛', () => {
    expect(decideUnchangedRewriteRecovery(true, 0)).toBe('retry_rewrite');
    expect(decideUnchangedRewriteRecovery(true, 1)).toBe('retain_for_owner');
    expect(decideUnchangedRewriteRecovery(false, 0)).toBe('restore_hard_valid_ancestor');
    expect(decideUnchangedRewriteRecovery(false, 2)).toBe('restore_hard_valid_ancestor');
    expect(boundedRewriteCountAfterAttempt(0)).toBe(1);
    expect(boundedRewriteCountAfterAttempt(1)).toBe(2);
    expect(boundedRewriteCountAfterAttempt(2)).toBe(2);
    expect(boundedRewriteCountAfterAttempt(3)).toBe(2);
  });

  it('keeps the one-time mechanical length repair inside the persisted two-rewrite boundary', () => {
    expect(shouldStopHardCheckRepair(1, false, false)).toBe(false);
    expect(shouldStopHardCheckRepair(2, true, false)).toBe(false);
    expect(shouldStopHardCheckRepair(2, true, true)).toBe(true);
    expect(shouldStopHardCheckRepair(2, false, false)).toBe(true);
  });

  it('只为其他硬检查全通过的近距离字数越界稿开放一次最终补救', () => {
    expect(isBoundedLengthHardRepairEligible(3_669, 2_350, 3_650, true)).toBe(true);
    expect(isBoundedLengthHardRepairEligible(3_851, 2_350, 3_650, true)).toBe(false);
    expect(isBoundedLengthHardRepairEligible(2_200, 2_350, 3_650, true)).toBe(true);
    expect(isBoundedLengthHardRepairEligible(3_669, 2_350, 3_650, false)).toBe(false);
    expect(isBoundedLengthHardRepairEligible(3_200, 2_350, 3_650, true)).toBe(false);
  });

  it('最终字数补救只允许局部补足或删减，不再次执行创意重写', () => {
    const expand = finalLengthHardRepairAction(2_280);
    expect(expand).toContain('唯一一次最终字数补救');
    expect(expand).toContain('不得删除或缩写');
    expect(expand).toContain('至少420个');
    expect(expand).toContain('不得新增事件');
    const trim = finalLengthHardRepairAction(3_700);
    expect(trim).toContain('只删除至少');
    expect(trim).toContain('不得新增或改写事实');
  });

  it('普通点评修订失败后只为纯字数问题开放一次更宽但有界的最终补救', () => {
    expect(isFinalLengthOnlyRepairEligible(4_005, 2_350, 3_650, true)).toBe(true);
    expect(isFinalLengthOnlyRepairEligible(5_307, 2_350, 3_650, true)).toBe(false);
    expect(isFinalLengthOnlyRepairEligible(4_005, 2_350, 3_650, false)).toBe(false);
    expect(isFinalLengthOnlyRepairEligible(3_200, 2_350, 3_650, true)).toBe(false);
  });

  it('作者最新修改要求优先于互斥的章纲软细节，下一章接口允许本章铺垫', () => {
    const contract = chapterReviewSourceBoundaryContract();
    expect(contract.join('')).toContain('作者针对当前版本的最新修改要求');
    expect(contract.join('')).toContain('不得要求正文同时满足两个互斥动作');
    expect(contract.join('')).toContain('不得要求删除必写人物线');
    expect(contract.join('')).toContain('不是禁止本章提前收到消息');
    expect(contract.join('')).toContain('事件结束状态属于多章事件全部完成后的目标');
    expect(contract.join('')).toContain('本章工单明确禁止');
    expect(contract.join('')).toContain('必须搜索完整current_manuscript');
    expect(contract.join('')).toContain('不得使用ContextPack的tokenCount');
  });

  it('定点修订压缩继承契约但保留完整正文和修改要求', () => {
    expect(targetedRewriteContractCharacterLimit('chapter_work_order')).toBe(2_600);
    expect(targetedRewriteContractCharacterLimit('stage_settlement_context')).toBe(1_200);
    expect(targetedRewriteContractCharacterLimit('previous_chapter_end')).toBe(700);
    expect(targetedRewriteContractCharacterLimit('previous_chapter_tail')).toBe(700);
    expect(targetedRewriteContractCharacterLimit('active_commitments')).toBe(700);
    expect(targetedRewriteContractCharacterLimit('opening_profile')).toBe(450);
    expect(targetedRewriteContractCharacterLimit('style_baseline')).toBe(350);
    expect(targetedRewriteContractCharacterLimit('previous_chapter_anchors')).toBe(350);
    expect(targetedRewriteContractCharacterLimit('system_rule')).toBe(300);
    expect(targetedRewriteContractCharacterLimit('owner_rewrite_instruction')).toBe(600);
    expect(isTargetedRewriteContractSource('previous_chapter_end')).toBe(true);
    expect(isTargetedRewriteContractSource('previous_chapter_tail')).toBe(true);
    expect(isTargetedRewriteContractSource('stage_settlement_context')).toBe(true);
    expect(isTargetedRewriteContractSource('retrieval:manuscript')).toBe(false);
  });
});
