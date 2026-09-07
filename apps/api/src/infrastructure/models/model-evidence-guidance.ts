import type { ModelPurpose } from './model-runtime-config.js';

/** Output discipline, not a ban on fictional invention or an extra review pass. */
export function evidenceGuidance(purpose: ModelPurpose): string {
  if (purpose === 'novel_reviewer') return '事实核对只纠正具体矛盾和影响成立的错误，不把信息缺失、普通观察、合理推断或新增情节当成问题，也不要求它们逐一有来源。作者确认的虚构规则按本书规则审查；未来计划不当成现状。不扩大作者限制；现实功效的无根据保证应指出保证本身的问题，不能据此臆断人物拥有超能力。保留合理创意，不为审查而追加限制。本段仅约束事实核对，不替代任务要求的文学审查。';
  return '';
}
