import { createHash } from 'node:crypto';
import type { ModelAdapter, ModelRequest, ModelResult } from './model-adapter.js';

export class DeterministicModelAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic';
  public constructor(public readonly modelId = 'wenmi-fixture-v1') {}

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    if (signal?.aborted === true) {
      throw signal.reason ?? new DOMException('调用已取消', 'AbortError');
    }
    const digest = createHash('sha256')
      .update(`${request.bookId}\n${request.agentId}\n${request.prompt}`)
      .digest('hex');
    const synthesis = reviewSynthesis(request.prompt);
    const output = synthesis ?? `【确定性假模型 ${digest.slice(0, 12)}】已根据任务 ${request.taskId} 生成可复现结果。`;
    return {
      provider: this.provider,
      modelId: this.modelId,
      output,
      inputTokens: Math.ceil(request.prompt.length / 2),
      outputTokens: Math.ceil(output.length / 2),
      cashCostCny: 0,
      state: 'succeeded'
    };
  }
}

function reviewSynthesis(prompt: string): string | null {
  let value: unknown;
  try { value = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(value) || value.operation !== 'review_synthesis' || !Array.isArray(value.reports)) return null;
  const reports = value.reports.filter(isRecord);
  const issues = reports.flatMap((report) => Array.isArray(report.issues) ? report.issues.filter(isRecord) : []);
  const priorityIssueIndexes = issues.map((_, index) => index)
    .sort((left, right) => severityRank(String(issues[right]?.severity)) - severityRank(String(issues[left]?.severity)));
  const verdicts = reports.map((report) => String(report.verdict));
  const recommendedVerdict = verdicts.includes('blocked') ? 'blocked' : verdicts.includes('rewrite') ? 'rewrite' : 'pass';
  const distinct = new Set(verdicts);
  return JSON.stringify({
    panelId: value.panelId,
    manuscriptVersionId: value.manuscriptVersionId,
    recommendedVerdict,
    priorityIssueIndexes,
    preservedDisagreements: distinct.size > 1 ? ['三席结论不同，保留各席原始理由，不以多数票覆盖。'] : [],
    rationale: issues.length === 0 ? '三席均未提交可定位问题，建议通过。' : '按阻断级、重大、次要顺序合并可定位问题，保留原始证据。'
  });
}

function severityRank(severity: string): number {
  return severity === 'blocker' ? 4 : severity === 'major' ? 3 : severity === 'minor' ? 2 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
