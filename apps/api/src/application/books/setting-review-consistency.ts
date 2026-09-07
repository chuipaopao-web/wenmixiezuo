export const SETTING_REVIEW_AUTHORITY_RULES = [
  '每项authority=confirmed表示作者已确认，candidate表示待定草案。冲突时以作者明确要求和已确认内容为依据修正草案，不让草案反向覆盖正式事实。',
  '已确认内容之间确有冲突、或现实功效无法可靠确认时，保留具体问题给作者，不伪造依据；合理新增情节和作者允许的虚构规则不算错误。',
  'verdict=pass表示报告列出的冲突已经落实到修订且没有待决定问题；仍未修正或patches.issues非空必须needs_author，不能只写通过。'
] as const;

export function settingReviewAuthority(item: { state: string }): 'confirmed' | 'candidate' {
  return item.state === 'confirmed' ? 'confirmed' : 'candidate';
}

/** Validate the report's own claims, not the semantic truth of the manuscript. */
export function assertSettingReviewConsistency(review: {
  verdict: 'pass' | 'needs_author';
  conflicts: ReadonlyArray<{ itemKeys: readonly string[] }>;
  patches: ReadonlyArray<{ itemKey: string; issues: readonly unknown[] }>;
}, requireConflictPatches: boolean): void {
  if (review.verdict !== 'pass') return;
  if (review.patches.some(patch => patch.issues.length > 0)) {
    throw new Error('结论不能为pass：修订仍有待决定问题。保留问题并返回needs_author，不得删去问题来凑通过。');
  }
  if (requireConflictPatches && review.conflicts.some(conflict => !review.patches.some(patch => conflict.itemKeys.includes(patch.itemKey)))) {
    throw new Error('结论不能为pass：列出的冲突尚无对应修订。未落实修正时返回needs_author，不能只声明已解决。');
  }
}
