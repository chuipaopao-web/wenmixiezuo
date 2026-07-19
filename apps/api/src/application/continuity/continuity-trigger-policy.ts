export interface ContinuityTriggerInput {
  currentChapter: number;
  referencedEntityIds: string[];
  activeCommitmentEntityIds: string[];
  ruleKeys: string[];
  causalThreadIds: string[];
}

export interface ContinuityRetrievalLevel {
  level: 'recent_chapters' | 'active_arc' | 'stage_settlement' | 'canon_drilldown';
  reason: string;
  maxSources: number;
}

/**
 * Chapter distance only changes the navigation starting point. It never makes
 * canon false or permanently inaccessible; entities, rules, commitments and
 * causal threads always reopen the authoritative source trail.
 */
export function planContinuityRetrieval(input: ContinuityTriggerInput): ContinuityRetrievalLevel[] {
  if (!Number.isInteger(input.currentChapter) || input.currentChapter < 1) throw new Error('当前章节必须为正整数');
  const levels: ContinuityRetrievalLevel[] = [
    { level: 'recent_chapters', reason: '保持直接承接与人物即时状态', maxSources: 6 },
    { level: 'active_arc', reason: '保持当前故事弧目标与冲突', maxSources: 4 }
  ];
  if (input.currentChapter > 100) levels.push({ level: 'stage_settlement', reason: '旧阶段先以可回查结算导航，避免全书常驻上下文', maxSources: 3 });
  const triggers = input.referencedEntityIds.length + input.activeCommitmentEntityIds.length + input.ruleKeys.length + input.causalThreadIds.length;
  if (triggers > 0) levels.push({ level: 'canon_drilldown', reason: '实体、规则、开放承诺或因果线程触发正史原文回查', maxSources: Math.min(12, Math.max(2, triggers * 2)) });
  return levels;
}
