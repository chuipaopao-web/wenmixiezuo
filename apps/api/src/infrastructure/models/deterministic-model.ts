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
      '章节跨度估算 {"minimum":3,"recommended":3,"maximum":3,"units":[{"unit":"建立选择","suggestedChapters":1},{"unit":"放大代价","suggestedChapters":1},{"unit":"兑现转折","suggestedChapters":1}],"assumptions":["上游设定与剧情总纲已经确认"],"uncertainty":["具体场景仍由主笔创作"]}'
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
  if (prompt.includes('现在进行且仅进行一次交叉质疑')) {
    base.fields.answer = '对方方案的阶段因果能够成立，但需要检查阶段结果是否真正成为下一阶段起点，并为未回收伏笔留下明确承接位置。';
    base.fields.keyPoints = ['保留两套方案真正不同的阶段升级方式', '检查章节范围连续性和阶段结果'];
    base.fields.risks = ['阶段结论若不改变人物处境，后续会变成重复升级'];
    base.fields.nextStep = '由主编只基于两份完整方案和本轮质疑形成阶段总纲';
    return JSON.stringify(base);
  }
  if (prompt.includes('剧情总纲落库')) {
    base.fields.details = `剧情总纲落库 ${JSON.stringify(deterministicMasterOutline())}`;
  } else if (prompt.includes('规划落库')) {
    base.fields.details = '规划落库 {"arcTitle":"当前故事弧滚动推进","arcGoal":"用三次递进选择推进当前阶段目标","endingState":"主角完成阶段选择并面对新的可追踪问题","estimatedChapterRange":{"minimum":3,"recommended":3,"maximum":3},"chapters":[{"title":"必须作出的选择","goal":"让主角在两种有代价的方案中作出明确选择","beats":["暴露现实限制","提出互斥方案"],"hook":"选择触发意料之外的责任"},{"title":"代价开始兑现","goal":"让上一章的选择具体损害一段重要关系","beats":["短期收益出现","盟友发现被隐瞒的代价"],"hook":"对手掌握主角选择的证据"},{"title":"阶段结果落地","goal":"让主角承担代价并取得推进当前阶段目标的有限成果","beats":["对手公开施压","主角用行动回应"],"hook":"成果中出现指向更大冲突的异常"}]}';
  }
  return JSON.stringify(base);
}

function deterministicMasterOutline(): Record<string, unknown> {
  const stage = (
    stageNumber: number,
    title: string,
    start: number,
    end: number,
    encounter: string,
    resolution: string,
    result: string,
    setup: string,
    development: string,
    turn: string,
    conclusion: string,
    stageSummary: string,
    pendingThreads: string[],
    followUpDirection: string
  ): Record<string, unknown> => ({
    stageNumber,
    title,
    chapterRange: { start, end },
    mainline: { encounter, resolution, result },
    structure: { setup, development, turn, conclusion },
    stageSummary,
    pendingThreads,
    followUpDirection
  });
  return {
    outlineSchema: 'stage_master_v2',
    premise: '主角在既有秩序失效后被迫承担重建责任',
    coreConflict: '个人生存选择与重建公共秩序的责任持续冲突',
    protagonistArc: '从只保护自己成长为愿意承担选择后果的领导者',
    majorStages: [
      stage(
        1, '取得立足点', 1, 50,
        '主角接管濒临崩溃的据点并遭遇资源断供',
        '查清账目、重建分配规则并团结幸存者',
        '据点恢复运转，主角取得第一份规则解释权',
        '旧秩序失效，主角被迫接手烂摊子',
        '资源、关系和外部压力同步升级',
        '第一次胜利暴露规则被人为操纵',
        '主角守住据点并决定追查规则源头',
        '主角由自保转向承担集体生存责任，获得继续行动的基础',
        ['规则操纵者的身份', '旧账中缺失的一页'],
        '进入规则权争夺，追查资源断供背后的利益链'
      ),
      stage(
        2, '争夺规则权', 51, 100,
        '旧势力利用制度和舆论围堵新据点',
        '主角联合受损群体公开证据并建立替代规则',
        '旧势力失去垄断，但真正对手暴露',
        '新据点扩张触动既得利益',
        '联盟建立又因利益分配出现裂缝',
        '盟友背叛迫使主角公开关键证据',
        '主角赢得阶段性规则权并看见更大敌人',
        '主角从据点管理者成长为能够组织联盟的领导者',
        ['背叛者未交代的动机', '规则源头的维护者'],
        '把局部改革推向全域，准备承担公开挑战旧秩序的代价'
      ),
      stage(
        3, '完成新秩序', 101, 150,
        '真正对手发动终局清算并逼迫主角独占胜利',
        '主角公开规则来源、分散权力并承担个人损失',
        '新秩序建立且拥有可追责的维护机制',
        '全域冲突爆发，既有联盟面临瓦解',
        '主角在效率与公开之间反复受挫',
        '最亲近的人付出代价，迫使主角改变胜利定义',
        '主角放弃独占成果，以可追责制度兑现承诺',
        '主角完成从求生者到规则建设者的成长，并让胜利不依赖个人永续掌权',
        [],
        '收束主要因果，同时为世界继续运转保留余韵'
      )
    ],
    endingDirection: '主角以承担真实代价的选择兑现重建承诺',
    storyPromises: ['每次胜利产生后续代价', '人物关系随选择真实变化'],
    openQuestions: ['最终治理形式仍由老板确认']
  };
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
