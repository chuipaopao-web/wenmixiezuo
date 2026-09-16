/**
 * MODEL-NODE-EVAL失败归因（合同执行补充：明确失败属于模型、供应商还是评测工具，不猜）。
 * - 模型：有可见输出但结构/输出合同未过、或输出长度内未收束（截断）——模型未按约定交付。
 * - 供应商：HTTP错误、429限流、鉴权/套餐失效、超时——通道侧问题，不记为模型质量结论。
 * - 评测工具：评测程序自身失真（如校验器误套合同）——走作废流程（.local/eval/invalidations.json）并如实记录消耗，
 *   既不归咎模型也不计入供应商；本分类器只覆盖在案outcome，失真案例在作废记录中标注。
 * - 未知：结果未知/未分类，先核对，不归因。
 */
export type FailureAttribution = 'model' | 'provider' | 'eval-tool' | 'unknown';

export function classifyFailure(outcome: string, errorCode: string | null): FailureAttribution {
  if (outcome === 'ok') return 'unknown'; // 非失败不适用归因（调用方不应询问）
  if (errorCode?.startsWith('evaltool:')) return 'eval-tool';
  switch (outcome) {
    case 'contract_error':
    case 'truncated':
      return 'model';
    case 'http_error':
    case 'rate_limited':
    case 'auth_error':
    case 'timeout':
      return 'provider';
    default:
      return 'unknown';
  }
}

export const ATTRIBUTION_LABELS: Record<FailureAttribution, string> = {
  model: '模型', provider: '供应商', 'eval-tool': '评测工具', unknown: '未定'
};

/** 汇总一组case的归因分布（只统计失败case；ok不入账）。 */
export function summarizeAttribution(cases: readonly { outcome: string; error_code: string | null }[]): Record<FailureAttribution, number> {
  const counts: Record<FailureAttribution, number> = { model: 0, provider: 0, 'eval-tool': 0, unknown: 0 };
  for (const c of cases) {
    if (c.outcome === 'ok') continue;
    counts[classifyFailure(c.outcome, c.error_code)] += 1;
  }
  return counts;
}
