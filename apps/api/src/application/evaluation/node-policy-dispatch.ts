import type { V7EffectiveMember } from '@wenmi/v7-backend';
import type { EvalNodePolicyRow } from '../../infrastructure/db/repositories/node-evaluation-repository.js';

/**
 * MODEL-NODE-EVAL节点策略感知派工（合同"上岗与恢复"节）：
 * - 只影响新任务快照：快照构建时按node_policy与applied排名解析各节点家族的承担成员；
 *   无任何策略/排名记录时返回原顺序（默认关闭，行为与现状逐字节一致）。
 * - suspended模型在该节点家族被排除；全部候选被暂停→明确受阻（诚实报无合格成员，不回夹具）。
 * - applied排名的合格前三按名次优先承担，其余在岗成员作候补；生成/审查异模型约束由调用方保持。
 * - pending_retest不算暂停（复测排队中，不扩大惩罚）。
 */

/** 运行期step node前缀→评测节点家族（与node-registry一致）。 */
export function nodeFamilyFor(stepNode: string): string {
  if (/:revision-\d+$/u.test(stepNode)) return 'revise';
  const base = stepNode.replace(/:repair$/u, '').replace(/:author-\d+$/u, '');
  if (base.startsWith('volume-card:')) return 'volume-card';
  if (base.startsWith('volumes:')) return 'volumes-batch';
  if (base.startsWith('review-source')) return 'review-source';
  if (base.startsWith('review-anchors')) return 'review-anchors';
  if (base.startsWith('merge:')) return 'card-merge';
  if (base.startsWith('card:')) return 'card-extract';
  if (base === 'card-finalize') return 'card-finalize';
  if (base.startsWith('self-check-anchors')) return 'self-check-anchors';
  if (base.startsWith('self-check')) return 'self-check';
  if (base.startsWith('skeleton')) return 'skeleton';
  if (base.startsWith('recommend-with-intent')) return 'recommend-with-intent';
  if (base.startsWith('methods:creative:')) return 'methods-creative';
  if (base.startsWith('methods:')) return 'methods-select';
  return base;
}

export interface NodeDispatchInput {
  /** 岗位当前候选成员（已按现有规则排序）。 */
  readonly candidates: readonly V7EffectiveMember[];
  /** 该节点家族的全部策略行。 */
  readonly policies: readonly EvalNodePolicyRow[];
  /** applied排名的合格模型顺序（rank升序）；无排名=null。 */
  readonly rankedModelIds: readonly string[] | null;
}

export interface NodeDispatchResult {
  readonly member: V7EffectiveMember | null; // null=无合格成员（全部暂停/候选为空）
  readonly reason: string;
  readonly policyApplied: boolean; // 是否有策略/排名影响了选择（审计用）
}

export function resolveNodeMember(input: NodeDispatchInput): NodeDispatchResult {
  const suspended = new Set(input.policies.filter(p => p.state === 'suspended').map(p => p.model_profile_key));
  const eligible = input.candidates.filter(m => !suspended.has(m.model.modelId));
  if (!eligible.length) {
    return { member: null, reason: suspended.size ? '全部候选成员在该节点已被暂停派工，待复测' : '岗位无候选成员', policyApplied: suspended.size > 0 };
  }
  if (input.rankedModelIds?.length) {
    const ranked = input.rankedModelIds
      .map(modelId => eligible.find(m => m.model.modelId === modelId))
      .filter((m): m is V7EffectiveMember => m !== undefined);
    if (ranked.length) return { member: ranked[0]!, reason: `按已应用节点排名第1名承担`, policyApplied: true };
  }
  const changed = eligible[0]!.memberKey !== input.candidates[0]?.memberKey;
  return { member: eligible[0]!, reason: changed ? '原首选成员已暂停，由候补接替' : '岗位默认顺序', policyApplied: changed };
}

/** 解析某节点家族的候补顺序（排除暂停；有排名按名次，其余按原顺序）。用于失败接替。 */
export function nodeFallbackOrder(input: NodeDispatchInput): V7EffectiveMember[] {
  const suspended = new Set(input.policies.filter(p => p.state === 'suspended').map(p => p.model_profile_key));
  const eligible = input.candidates.filter(m => !suspended.has(m.model.modelId));
  if (!input.rankedModelIds?.length) return [...eligible];
  const ranked = input.rankedModelIds
    .map(modelId => eligible.find(m => m.model.modelId === modelId))
    .filter((m): m is V7EffectiveMember => m !== undefined);
  const rest = eligible.filter(m => !input.rankedModelIds!.includes(m.model.modelId));
  return [...ranked, ...rest];
}
