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
    const discussion = deterministicDiscussion(request.prompt);
    const output = synthesis ?? discussion ?? `【确定性假模型 ${digest.slice(0, 12)}】已根据任务 ${request.taskId} 生成可复现结果。`;
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

function deterministicDiscussion(prompt: string): string | null {
  if (!prompt.includes('小说创作问题') && !prompt.includes('当前书籍的活动主编')) return null;
  if (prompt.includes('章节跨度估算')) {
    return [
      '建议用三章完成当前滚动推进：第一章建立选择，第二章放大代价，第三章兑现转折。',
      '章节跨度估算 {"minimum":3,"recommended":3,"maximum":3,"units":[{"unit":"建立选择","suggestedChapters":1},{"unit":"放大代价","suggestedChapters":1},{"unit":"兑现转折","suggestedChapters":1}],"assumptions":["上游设定与卷纲已经确认"],"uncertainty":["具体场景仍由主笔创作"]}'
    ].join('\n');
  }
  const base = {
    version: 1,
    format: 'json_object',
    fields: {
      answer: '已按当前阶段整理可验证的创作方案，先确认结构边界，再进入下一级规划。',
      keyPoints: ['保持人物选择、冲突升级与结果兑现之间的因果关系', '不把未确认的候选内容写入正史'],
      alternatives: [],
      risks: ['真实模型接入后仍需由老板审核创造性与题材适配'],
      questions: [],
      nextStep: '确认当前阶段方案后进入下一阶段',
      details: ''
    }
  };
  if (prompt.includes('剧情总纲落库')) {
    base.fields.details = '剧情总纲落库 {"premise":"主角在既有秩序失效后被迫承担重建责任","coreConflict":"个人生存选择与重建公共秩序的责任持续冲突","protagonistArc":"从只保护自己成长为愿意承担选择后果的领导者","majorStages":[{"title":"取得立足点","goal":"证明主角能够建立可持续的生存规则","turningPoint":"第一次成功同时暴露更大制度问题"},{"title":"争夺规则权","goal":"联合受旧秩序伤害的人改变资源分配方式","turningPoint":"主角发现真正对手掌握规则来源"},{"title":"完成新秩序","goal":"在终局代价前决定新规则由谁维护","turningPoint":"主角放弃独占胜利并公开规则"}],"endingDirection":"主角以承担真实代价的选择兑现重建承诺","storyPromises":["每次胜利产生后续代价","人物关系随选择真实变化"],"openQuestions":["最终治理形式仍由老板确认"]}';
  } else if (prompt.includes('卷纲落库')) {
    base.fields.details = '卷纲落库 {"title":"建立第一个立足点","goal":"主角取得一项可公开核验且能持续运转的生存资格","startingState":"主角资源有限、身份未获承认且旧规则仍占优势","arcs":[{"title":"证明能力","objective":"用一次高风险选择证明新方案可以运转","turningPoints":["第一次成功引来旧势力干预","盟友因代价产生分歧"],"payoff":"主角保住成果并获得有限追随者"}],"climax":"主角放弃短期独占收益，公开关键规则以换取共同抵抗","endingState":"主角获得立足点和盟友，同时被更高层对手正式注意","openQuestions":["盟友分歧将在下一卷如何升级"]}';
  } else if (prompt.includes('规划落库')) {
    base.fields.details = '规划落库 {"arcTitle":"当前卷滚动推进","arcGoal":"用三次递进选择推进本卷唯一目标","endingState":"主角完成阶段选择并面对新的可追踪问题","estimatedChapterRange":{"minimum":3,"recommended":3,"maximum":3},"chapters":[{"title":"必须作出的选择","goal":"让主角在两种有代价的方案中作出明确选择","beats":["暴露现实限制","提出互斥方案"],"hook":"选择触发意料之外的责任"},{"title":"代价开始兑现","goal":"让上一章的选择具体损害一段重要关系","beats":["短期收益出现","盟友发现被隐瞒的代价"],"hook":"对手掌握主角选择的证据"},{"title":"阶段结果落地","goal":"让主角承担代价并取得推进本卷目标的有限成果","beats":["对手公开施压","主角用行动回应"],"hook":"成果中出现指向更大冲突的异常"}]}';
  }
  return JSON.stringify(base);
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
