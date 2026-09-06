import type { V7OpeningMemberDefinition } from './agent-roster.js';

export const V7_MAX_AUTOMATIC_MEMBER_SWITCHES = 2;
export const V7_MAX_SAME_MEMBER_STRUCTURE_REPAIRS = 1;

export type V7AgentFailureClass =
  | 'credential_unavailable'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'timeout'
  | 'network_failure'
  | 'empty_response'
  | 'invalid_output'
  | 'outcome_unknown'
  | 'quality_rejected'
  | 'author_rejected'
  | 'hard_input_conflict'
  | 'budget_exhausted'
  | 'cancelled'
  | 'version_changed'
  | 'safety_blocked';

export type V7FailureAction = 'repair_same_member' | 'reconcile' | 'switch_member' | 'stop';

export interface V7FailureDecision {
  action: V7FailureAction;
  reason: string;
  consumesAutomaticSwitch: boolean;
}

export function decideV7AgentFailure(input: {
  failureClass: V7AgentFailureClass;
  sameMemberStructureRepairs: number;
  automaticMemberSwitches: number;
}): V7FailureDecision {
  if (input.failureClass === 'outcome_unknown') {
    return decision('reconcile', '供应商结果未知，必须先调和，禁止盲目重发或换人。', false);
  }
  if (input.failureClass === 'invalid_output' && input.sameMemberStructureRepairs < V7_MAX_SAME_MEMBER_STRUCTURE_REPAIRS) {
    return decision('repair_same_member', '保留相同输入与成员，只追加一次结构修复要求。', false);
  }
  if (isSwitchableTechnicalFailure(input.failureClass)) {
    if (input.automaticMemberSwitches >= V7_MAX_AUTOMATIC_MEMBER_SWITCHES) {
      return decision('stop', '自动换人次数已达上限，保留检查点并交给作者或管理员恢复。', false);
    }
    return decision('switch_member', '技术执行失败，使用相同冻结任务和上下文切换下一名成员。', true);
  }
  return decision('stop', stopReason(input.failureClass), false);
}

export function nextFallbackMember(
  fallbackChain: readonly V7OpeningMemberDefinition[],
  attemptedMemberKeys: ReadonlySet<string>
): V7OpeningMemberDefinition | null {
  return fallbackChain.find((member) => !attemptedMemberKeys.has(member.memberKey)) ?? null;
}

function isSwitchableTechnicalFailure(failureClass: V7AgentFailureClass): boolean {
  return new Set<V7AgentFailureClass>([
    'credential_unavailable', 'provider_unavailable', 'rate_limited', 'timeout',
    'network_failure', 'empty_response', 'invalid_output'
  ]).has(failureClass);
}

function stopReason(failureClass: V7AgentFailureClass): string {
  const reasons: Record<Exclude<V7AgentFailureClass,
    'credential_unavailable' | 'provider_unavailable' | 'rate_limited' | 'timeout'
    | 'network_failure' | 'empty_response' | 'invalid_output' | 'outcome_unknown'>, string> = {
    quality_rejected: '质量不满意不是技术故障，保留候选，由作者主动选择重做或换成员。',
    author_rejected: '作者已拒绝当前候选，等待新的作者指令。',
    hard_input_conflict: '作者硬要求存在冲突，必须由作者决定。',
    budget_exhausted: '本次预算不可用，禁止自动扩大消耗。',
    cancelled: '任务已取消，保留已经确认的数据和调用证据。',
    version_changed: '上游活动版本已变化，旧候选必须失效后重新编译。',
    safety_blocked: '请求触发安全边界，禁止自动改写要求后继续。'
  };
  return reasons[failureClass as keyof typeof reasons] ?? '任务需要人工恢复。';
}

function decision(action: V7FailureAction, reason: string, consumesAutomaticSwitch: boolean): V7FailureDecision {
  return { action, reason, consumesAutomaticSwitch };
}
