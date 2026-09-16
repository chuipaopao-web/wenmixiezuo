import { cardContractFor, planningMaterial } from '../books/time-machine-card-template.js';
import { TIME_MACHINE_CARD_TEMPLATE_REVISION } from '../books/time-machine-card-template.js';
import { prepareCardMerge, cardMergeGuidance } from '../books/time-machine-card-merge.js';
import { timeMachineReviewChecks } from '../books/time-machine-review.js';
import { parseCard, type ContextCard } from '@wenmi/time-machine-core';
import { createHash } from 'node:crypto';
import { EvalContractError } from './node-evaluation-executor.js';
import type { BuiltSample } from './eval-sample-factory.js';

/**
 * MODEL-NODE-EVAL首批节点提示构建器与合同校验器。
 * 提示正文镜像time-machine-design-service.ts当前修订的真实调用点（来源逐条标注），
 * 动态注入按生产规则复现（目标体量/作者故事线/紧凑规则/短卡注入）。
 * 已知偏差（诚实标注，不影响合同一致性结论）：
 *  - review-source评测直接给出已回查片段，评估verdict决策回合；read_source补查动作循环属
 *    生产流程编排（同方法检索类），列入第二批methods-select节点评测，不在本批谎称覆盖。
 *  - methods/creative参考选择注入在生产仅creativeReleaseId存在时发生，本批样本均不涉及。
 * 漂移防护：tests中的drift-guard测试断言关键合同语句仍存在于设计服务源码。
 */

export interface CaseAnalysis {
  /** 合同是否满足（false等同抛错→contract_error）。 */
  readonly contractOk: boolean;
  readonly note?: string;
  /** 关键约束漏失（准入零漏失项）：如骨架丢失作者确认故事线、卷字数合计不等。 */
  readonly criticalMissed?: boolean;
  /** 审查反例：植入错误全部检出=true。 */
  readonly seededCaught?: boolean;
  /** 审查正例：干净候选被误报阻塞=true。 */
  readonly cleanFalseAlarm?: boolean;
}

const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new EvalContractError('输出不是JSON对象');
  return v as Record<string, unknown>;
};
const json = (text: string): unknown => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/u, '').replace(/```\s*$/u, '');
  try { return JSON.parse(trimmed); } catch { throw new EvalContractError('JSON不能被解析'); }
};

function evalManifest(sample: BuiltSample) {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  return {
    sources: [
      { kind: 'opening', id: 'main', revision: '1', hash: hash(sample.fixture.documents.find(d => d.key === 'opening:main:1')!.text) },
      { kind: 'setting', id: 'world', revision: '1', hash: hash(sample.fixture.documents.find(d => d.key === 'setting:world:1')!.text) },
      { kind: 'intent', id: 'author', revision: '1', hash: hash(sample.fixture.intent) }
    ],
    templateRevision: TIME_MACHINE_CARD_TEMPLATE_REVISION,
    redactionRevision: 'eval-redaction-1'
  };
}

function evalCard(sample: BuiltSample): ContextCard {
  return parseCard({ ownerId: '_eval', bookId: '_eval', manifest: evalManifest(sample), fields: sample.fixture.cardFields });
}

const targetWordsNote = '\n开书目标体量：约400000字，属于作者软目标（统计口径chars-v1，以字为单位）。分卷字数由成员按故事容量分配，各卷target合计必须等于全书target；超出软预算触发重新估量，不擅自截稿。卷数不固定，后续每卷还会展开多条链，不在此写完所有小故事。';

const listRule = '每条问题或建议不超过80字并定位到具体卷或故事线（如卷B、主线1）；阻塞问题放在issues前部；单次issues最多10条、suggestions最多10条；若阻塞问题超过10条，将hasMoreIssues设为true，系统会追加询问，不要省略、合并或概括掉阻塞问题。';

/** 构建某节点某样本的真实提示（镜像生产模板）。 */
export function buildEvalPrompt(nodeKey: string, sample: BuiltSample): string {
  const f = sample.fixture;
  const card = evalCard(sample);
  switch (nodeKey) {
    case 'card-extract': {
      // 源：design-service.ts:317 — cardContract + 分页资料（生产传分页数组本身，非包裹对象）
      const contract = cardContractFor(TIME_MACHINE_CARD_TEMPLATE_REVISION);
      const page = f.documents.filter(d => !d.key.startsWith('intent:'));
      return `${contract}\n这可能是一部分资料，未知保持空，来源key不可创造。\n${JSON.stringify(page)}`;
    }
    case 'card-merge': {
      // 源：design-service.ts:318-321 — prepareCardMerge传输合同
      const partA = { ...card, fields: { ...card.fields, world: card.fields.world.slice(0, 1) } };
      const partB = { ...card, fields: { ...card.fields, openingEnding: card.fields.openingEnding.slice(0, 1) } };
      const transport = prepareCardMerge([partA, partB]);
      return JSON.stringify({ operation: 'summarize_book_material', sourceCards: transport.fields, instructions: cardMergeGuidance, outputContract: { fields: { premise: [], protagonists: [], world: [], openingEnding: [], preferences: [], prohibitions: [] } } });
    }
    case 'card-finalize': {
      // 源：design-service.ts:327-330 — 最终短卡纠正
      const contract = cardContractFor(TIME_MACHINE_CARD_TEMPLATE_REVISION);
      const flawed = { ...card.fields, preferences: [...card.fields.preferences, { text: `故事核心方向：${f.cardFields.premise[0]!.text}`, sourceKeys: ['intent:author:1'] }] };
      return `${contract}\n这是最终短卡，premise必须归纳已有资料中的故事核心方向，protagonists必须保留主角。不得把storyDirection误放为风格偏好。只根据现有短卡与开书原文纠正分类。\n短卡：${JSON.stringify(flawed)}\n开书：${JSON.stringify(f.documents.filter(d => d.key.startsWith('opening:')))}`;
    }
    case 'skeleton': {
      // 源：design-service.ts:429 skeletonPrompt（per-volume-v1紧凑规则+作者故事线承接注入）+ call()的目标体量/骨架附注
      const authorLines = f.authorStorylines;
      let prompt = `设计全书骨架。只设计大方向，不写章情节。开篇第一章建立冲突和读者期待，末卷回答全书问题；故事线按需要分卷推进或提前收束，不要末卷强行关联所有线。尊重作者选择。先定宏观节奏：从方法库或你掌握的经典结构中选择一个宏观节奏框架（如三幕、四幕起承转合、五幕、六幕、七幕、八幕等），在方法笔记外明确记入structure字段；再把各幕按体量分为1—2卷，得出卷数（如四幕式常为4—8卷、五幕式可达10卷、六幕至八幕式常为6—8卷），网文常规单卷约30—60万字，低于20万字的卷要有明确结构理由。返回JSON {"structure":"选定的宏观节奏框架及每幕职责一句话","baseline":"全书基线和整体味道","ending":"最终回答","openingHooks":["开头让读者留下的第一个钩子（每条≤80字）","第一章结束时读者想知道的问题","前三章建立的最大期待"],"words":{"target":全书字数,"min":null,"max":null,"hard":false,"policy":"chars-v1"},"lines":[{"id":"英文ID","role":"main或through或stage","title":"标题","goal":"开场目标（≤60字）","answer":"收束标准（≤60字）","process":"过程方向一句话","parentIds":[],"covers":["承接的作者故事线标题原文；原创补充线为空数组"],"milestones":[{"id":"英文ID","summary":"关键落点一句话（≤40字）","suggestedVolumes":["概要卷ID，连续多卷表示区间"],"importance":"required或flexible"}]}],"expectations":[{"id":"英文ID","opening":"开篇的期待","change":"读者想看到的变化","answer":"结尾的回应","lineIds":["关联线ID"]}],"relations":[{"from":"线ID","to":"线ID","kind":"push或conflict或reveal或meet","effect":"交织效果（≤50字）"}],"volumeBriefs":[{"id":"v1","title":"卷名","beat":"所属幕与位置，如：第一幕·起","goal":"本卷目标（≤40字）","words":{"target":本卷字数,"min":null,"max":null,"hard":false,"policy":"chars-v1"}}]}。开书给了目标体量就用作全书words.target（软目标），未提供时由你按故事容量提出；各卷volumeBriefs的words.target合计必须等于全书words.target，由你分配。只有作者明确要求的关键落点标required，其余flexible。suggestedVolumes与lineIds等引用字段只能填对应对象的id本身（如v1），不要写“第一卷”或卷名。输出保持紧凑（硬预算，超限会被要求重写）：structure≤150字；baseline、ending各≤80字；openingHooks每条≤80字，不写长段；每线milestones≤4个；expectations≤3条；relations≤5条。作者已确认的故事线共${authorLines.length}条，必须全部承接，不得丢弃、合并或改名：${authorLines.map(a => a.title).join('、')}。每条作者故事线恰好由一条线承接，在该线covers字段写入这条作者故事线的标题原文；你可以增加原创补充线（covers为空数组），线数按作者选择与故事需要确定，不设固定条数上限；输出长度靠各字段紧凑控制，不靠删减作者方向。所有概述文字面向作者用中文书写；提到卷时用“第一卷”或卷名，不要写v1、v2等内部代号。\n结构化任务资料：${planningMaterial(card.fields, f.intent)}`;
      prompt += targetWordsNote;
      prompt += '\n全书期待只放开篇提出、全书最终回答的问题；保住工坊、完成订单等阶段目标放在卷内。关系from到to表示前者影响后者，effect必须同向。不要把机甲升级有代价扩大成每次胜利都必须牺牲；代价服从原始限制与故事需要。';
      return prompt;
    }
    case 'volume-card': {
      // 源：design-service.ts:503（单卷合同）+ generate()注入正式资料短卡与作者要求 + call()目标体量附注
      const brief = (f.skeleton.volumeBriefs as Record<string, unknown>[])[0]!;
      const briefId = String(brief.id);
      const compactSkeleton = { ...f.skeleton, lines: (f.skeleton.lines as Record<string, unknown>[]).map(l => ({ ...l, milestones: (l.milestones as unknown[]).slice(0, 2) })) };
      let prompt = `按既定骨架补全本卷卷卡，只写这一卷，不重写其他卷或更改全书结局。返回JSON对象 {"volumes":[本卷卷卡]}（数组只含这一卷）。每卷 {"id":"${briefId}","title":"卷名","beat":"所属幕与位置（与概要一致）","start":"起点","goal":"目标","conflict":"主要阻碍","turningPoint":"关键转折","gain":"获得或人物变化，不适用为null","loss":"失去，不适用为null，不编造","arc":"人物弧光说明，不适用为null","payoff":"本卷兑现的长期期待或高潮，不适用为null","hook":"本卷爽点：读者最解气/最期待的1个具体时刻，不适用为null","mood":"本卷主导情绪与走向，不适用为null","ending":"本卷结束条件","handoff":"引出后卷的问题；全书最后卷必须空字符串","words":{"target":本卷字数,"min":null,"max":null,"hard":false,"policy":"chars-v1"},"anchors":[本卷锚点],"duties":[{"lineId":"骨架线ID","action":"start或advance或pause或close","result":"具体推进或收束","anchorIds":["关联锚点ID"],"strength":"required或flexible","reason":"本卷约束强度的理由"}]}。anchors必须恰好两个且ownerEntityId为本卷ID（${briefId}）：一个kind=entry（本卷开场）和一个kind=exit（本卷收束），格式 {"id":"英文ID","ownerEntityId":"${briefId}","kind":"entry或exit","summary":"一句话","span":"本卷开篇或本卷收束","conditions":[{"summary":"可按正文核对的原子条件","subjectIds":["相关线ID，无则空数组"]}],"logic":"all","importance":"required或flexible","fallback":"未完成如何承接","keywords":["检索词"],"aliases":[]}。锚点ID用英文（如 entry、exit），系统会按卷自动加前缀。锚点条件要能核对（如“任命已生效”而不是“变强”）；不适用字段返回null。required的close职责必须可按正文核对：该线必须出现在其关联锚点至少一个条件的subjectIds中（通常含exit锚点）；entry锚点条件必须与本卷start描述的开场状态一致，fallback必须是正文内可执行的承接方式。硬预算（超限会被要求重写）：每个自然语言字段≤60字，锚点summary≤50字、条件summary≤40字，keywords≤12个且每个≤40字，整个JSON控制在3000字以内；不输出解释或章情节。start/goal/conflict/turningPoint/hook/mood等正文字段面向作者用中文书写，提到卷时用“第1卷”或卷名。\n骨架（紧凑视图：仅含本卷涉及线与全卷概要）：${JSON.stringify(compactSkeleton)}\n本卷概要：${JSON.stringify(brief)}\n前卷交接：${JSON.stringify([])}`;
      prompt += `\n正式资料短卡（原始约束，不得被候选覆盖）：${JSON.stringify(card.fields)}`;
      prompt += `\n作者选择与要求（与来源事实区分，不得被候选覆盖）：${JSON.stringify(f.intent)}`;
      prompt += targetWordsNote;
      return prompt;
    }
    case 'volumes-batch': {
      // 源：design-service.ts:507（每批两卷旧路径，仍在旧快照恢复使用）
      const briefs = f.skeleton.volumeBriefs as Record<string, unknown>[];
      let prompt = `按既定骨架补全本批卷卡，不重写其他卷或更改全书结局。返回JSON对象 {"volumes":[卷卡]}，每卷 {"id":"与概要相同","title":"卷名","beat":"所属幕与位置（与概要一致）","start":"起点","goal":"目标","conflict":"主要阻碍","turningPoint":"关键转折","gain":"获得或人物变化，不适用为null","loss":"失去，不适用为null，不编造","arc":"人物弧光说明，不适用为null","payoff":"本卷兑现的长期期待或高潮，不适用为null","hook":"本卷爽点：读者最解气/最期待的1个具体时刻，不适用为null","mood":"本卷主导情绪与走向，如压抑后扬、轻快扩张，不适用为null","ending":"本卷结束条件","handoff":"引出后卷的问题；全书最后卷必须空字符串","words":{"target":本卷字数,"min":null,"max":null,"hard":false,"policy":"chars-v1"},"anchors":[本卷锚点],"duties":[{"lineId":"骨架线ID","action":"start或advance或pause或close","result":"具体推进或收束","anchorIds":["关联锚点ID"],"strength":"required或flexible","reason":"本卷约束强度的理由"}]}。anchors必须恰好两个且ownerEntityId为本卷ID：一个kind=entry（本卷开场）和一个kind=exit（本卷收束），格式 {"id":"英文ID","ownerEntityId":"本卷ID","kind":"entry或exit","summary":"一句话","span":"本卷开篇或本卷收束","conditions":[{"summary":"可按正文核对的原子条件","subjectIds":["相关线ID，无则空数组"]}],"logic":"all","importance":"required或flexible","fallback":"未完成如何承接","keywords":["检索词"],"aliases":[]}。锚点ID用英文（如 v1-entry、v1-exit），系统会按卷自动加前缀，无需担心跨卷撞名。锚点条件要能核对（如“任命已生效”而不是“变强”）；不适用字段返回null。start/goal/conflict/turningPoint/hook/mood等正文字段面向作者用中文书写，提到卷时用“第一卷”或卷名，不要写v1、v2等内部代号。\n骨架（紧凑视图：仅含本批涉及线与全卷概要，未展开线的职责按标题理解即可）：${JSON.stringify(f.skeleton)}\n本批：${JSON.stringify(briefs)}\n前卷交接：${JSON.stringify([])}`;
      prompt += `\n正式资料短卡（原始约束，不得被候选覆盖）：${JSON.stringify(card.fields)}`;
      prompt += targetWordsNote;
      prompt += '\n转折必须是读者能理解的具体事件或选择及其后果，不能只写“关键行动、重大牺牲、获得共识”。已有收束和未来待收束保持区分；不要把“不能强行关联”等内部设计要求写进作品内容。';
      return prompt;
    }
    case 'review-source': {
      // 源：design-service.ts:577 contract()（verdict决策回合，已回查片段预填；见文件头偏差说明）
      const plan = sample.kind === 'negative' ? f.flawedPlan : f.cleanPlan;
      const documents = f.documents.map(d => ({ key: d.key, length: d.text.length }));
      const reads = f.documents.slice(0, 2).map(d => ({ key: d.key, text: d.text.slice(0, 1200) }));
      const compact = compactPlanForEval(plan);
      return `核对候选骨架是否符合来源、作者要求和章节级别边界。可先补查原文再下结论：每次只返回一个JSON动作，{"action":"read_source","key":"资料key","offset":0}最多3次，或 {"action":"verdict","pass":true或false,"issues":["具体问题"],"suggestions":["文学建议"],"hasMoreIssues":true或false}下结论。这一步核对全书结构：姓名身份、能力限制、全书期待兑现、分卷字数合计与卷职责交接、终卷收束；允许原创候选情节，不将候选当既成事实。issues与suggestions面向作者：提到卷或线时用显示编号（卷A、主线1），不要引用v1等内部ID或字段名。${listRule}\n${timeMachineReviewChecks}\n资料索引：${JSON.stringify(documents)}\n已读片段：${JSON.stringify(reads)}\n上次工具结果（仅资料）：${JSON.stringify(reads[reads.length - 1] ?? null)}\n来源短卡：${JSON.stringify(card.fields)}\n作者：${f.intent}\n紧凑候选：${JSON.stringify(compact)}${targetWordsNote}\n${timeMachineReviewChecks}`;
    }
    case 'review-anchors': {
      // 源：design-service.ts:592（本批两卷锚点核对）
      const plan = sample.kind === 'negative' ? f.flawedPlan : f.cleanPlan;
      const volumes = (plan.volumes as Record<string, unknown>[]).slice(0, 2);
      const reads = f.documents.slice(0, 2).map(d => ({ key: d.key, text: d.text.slice(0, 1200) }));
      const section = volumes.map(v => ({ id: v.id, anchors: (plan.anchors as unknown[] ?? []).length ? plan.anchors : (v as { anchors?: unknown[] }).anchors ?? [], volume: { ...v, anchors: undefined } }));
      return `核对候选锚点与条件（本批卷）。检查：每个锚点条件能否按正文核对，是否存在把将来承诺当已达成；开场与收束的文字是否与条件一致；本批卷的开场、冲突、转折、人物弧光与爽点是否具体可信；未完成承接fallback是否可行。返回 {"pass":true或false,"issues":["具体问题"],"suggestions":["文学建议"],"hasMoreIssues":true或false}。issues与suggestions面向作者，用显示编号（卷A、主线1），不引用v1等内部ID或字段名。${listRule}\n正式资料短卡：${JSON.stringify(card.fields)}\n已回查原件：${JSON.stringify(reads)}\n本批：${JSON.stringify(section)}\n作者：${f.intent}${targetWordsNote}\n${timeMachineReviewChecks}`;
    }
    default:
      throw new Error(`首批未登记的评测节点：${nodeKey}`);
  }
}

/** 紧凑候选（镜像compactPlanForStructure的结构意图：骨架去卷卡明细+卷锚点清单）。 */
function compactPlanForEval(plan: Record<string, unknown>): Record<string, unknown> {
  const { volumes: _v, anchors, ...rest } = plan;
  return { ...rest, anchors: anchors ?? [], volumeCount: (plan.volumes as unknown[])?.length ?? 0 };
}

const verdictParse = (v: unknown): { pass: boolean; issues: string[]; suggestions: string[]; hasMoreIssues: boolean } => {
  const r = record(v);
  if (typeof r.pass !== 'boolean' || !Array.isArray(r.issues) || r.issues.some(x => typeof x !== 'string' || (x as string).length > 2000)) throw new EvalContractError('审查格式错误');
  const suggestions = r.suggestions ?? [];
  if (!Array.isArray(suggestions) || suggestions.some(x => typeof x !== 'string' || (x as string).length > 2000)) throw new EvalContractError('建议格式错误');
  if (r.hasMoreIssues !== undefined && typeof r.hasMoreIssues !== 'boolean') throw new EvalContractError('审查格式错误');
  return { issues: r.issues as string[], suggestions: suggestions as string[], hasMoreIssues: r.hasMoreIssues === true, pass: r.pass === true && r.issues.length === 0 };
};

/** 校验输出并给出语义分析（关键约束/植入召回/误报）。 */
export function validateEvalOutput(nodeKey: string, sample: BuiltSample, output: string): CaseAnalysis {
  const f = sample.fixture;
  switch (nodeKey) {
    case 'card-extract':
    case 'card-finalize': {
      const v = record(json(output));
      try {
        parseCard({ ownerId: '_eval', bookId: '_eval', manifest: evalManifest(sample), fields: record(v.fields) }, true);
      } catch (error) {
        throw new EvalContractError(error instanceof Error ? error.message : '短卡合同未过');
      }
      return { contractOk: true };
    }
    case 'card-merge': {
      const v = record(json(output));
      const fields = record(v.fields);
      for (const key of ['premise', 'protagonists', 'world', 'openingEnding', 'preferences', 'prohibitions']) {
        if (!Array.isArray(fields[key])) throw new EvalContractError(`合并短卡栏目缺失：${key}`);
        for (const item of fields[key] as unknown[]) {
          const a = record(item);
          if (typeof a.text !== 'string' || !Array.isArray(a.sourceKeys) || !a.sourceKeys.length) throw new EvalContractError('合并短卡断言格式错误');
          if ((a.sourceKeys as unknown[]).some(k => !/^s\d+$/u.test(String(k)))) throw new EvalContractError('合并输出sourceKeys必须使用短编号');
        }
      }
      return { contractOk: true };
    }
    case 'skeleton': {
      // 镜像design-service.ts:429即时校验 + 关键约束（卷字数合计、作者故事线承接）
      const p = record(json(output));
      if (typeof p.structure !== 'string' || !p.structure.trim() || p.structure.length > 600) throw new EvalContractError('缺少宏观节奏结构说明');
      if (!Array.isArray(p.volumeBriefs) || !p.volumeBriefs.length || p.volumeBriefs.length > 40) throw new EvalContractError('分卷概要错误');
      const words = record(p.words);
      const total = Number(words.target);
      if (!Number.isFinite(total) || total <= 0) throw new EvalContractError('全书字数目标缺失');
      const sum = (p.volumeBriefs as unknown[]).reduce((acc, v) => acc + Number(record(record(v).words).target || 0), 0);
      if (sum !== total) throw new EvalContractError(`分卷字数合计${sum}≠全书target${total}`, true);
      const lines = Array.isArray(p.lines) ? p.lines as Record<string, unknown>[] : [];
      if (!lines.length) throw new EvalContractError('故事线缺失');
      for (const authorLine of f.authorStorylines) {
        const covered = lines.some(l => Array.isArray(l.covers) && (l.covers as unknown[]).map(String).includes(authorLine.title));
        if (!covered) throw new EvalContractError(`作者已确认故事线未承接：${authorLine.title}`, true);
      }
      return { contractOk: true };
    }
    case 'volume-card': {
      const items = record(json(output)).volumes;
      if (!Array.isArray(items) || items.length !== 1) throw new EvalContractError('本卷卷卡必须恰好返回一个');
      const brief = (f.skeleton.volumeBriefs as Record<string, unknown>[])[0]!;
      const item = record(items[0]);
      if (String(item.id) !== String(brief.id)) throw new EvalContractError(`卷id与概要${String(brief.id)}不符`);
      checkVolumeCard(item, String(brief.id));
      return { contractOk: true };
    }
    case 'volumes-batch': {
      // 镜像生产批路径（design-service.ts批分支）：只校验批次完整/编号顺序/锚点数组形态——
      // 逐字段≤60字与6000字符上限属逐卷（volume-card）路径合同，生产批路径不强制；
      // 初筛曾误套checkVolumeCard导致5模型集体"超60字"失败，属评测工具失真非模型问题。
      const items = record(json(output)).volumes;
      const briefs = f.skeleton.volumeBriefs as Record<string, unknown>[];
      if (!Array.isArray(items) || items.length !== briefs.length) throw new EvalContractError('分卷批次不完整');
      for (let n = 0; n < items.length; n++) {
        const item = record(items[n]);
        if (item.id !== briefs[n]!.id) throw new EvalContractError('分卷编号或顺序与概要不符');
        if (!Array.isArray(item.anchors)) throw new EvalContractError('卷锚点格式错误', true);
      }
      return { contractOk: true };
    }
    case 'review-source': {
      const r = record(json(output));
      if (String(r.action) === 'read_source') throw new EvalContractError('未完成核对：已提供回查片段仍要求补查（补查动作循环列入第二批评测）');
      if (String(r.action) !== 'verdict') throw new EvalContractError('核对动作无效');
      const verdict = verdictParse(r);
      return reviewAnalysis(sample, verdict);
    }
    case 'review-anchors': {
      const verdict = verdictParse(json(output));
      return reviewAnalysis(sample, verdict);
    }
    default:
      throw new Error(`首批未登记的评测节点：${nodeKey}`);
  }
}

function checkVolumeCard(item: Record<string, unknown>, briefId: string): void {
  const anchors = item.anchors;
  if (!Array.isArray(anchors) || anchors.length !== 2) throw new EvalContractError('锚点必须恰好两个', true);
  const kinds = anchors.map(a => String(record(a).kind)).toSorted();
  if (kinds.join(',') !== 'entry,exit') throw new EvalContractError('锚点必须一个entry一个exit', true);
  for (const a of anchors) {
    const anchor = record(a);
    if (String(anchor.ownerEntityId) !== briefId) throw new EvalContractError('锚点ownerEntityId必须为本卷ID', true);
    const conditions = anchor.conditions;
    if (!Array.isArray(conditions) || !conditions.length) throw new EvalContractError('锚点条件缺失', true);
    for (const c of conditions) {
      const cond = record(c);
      if (typeof cond.summary !== 'string' || String(cond.summary).length > 40) throw new EvalContractError('锚点条件summary超40字');
    }
  }
  for (const field of ['start', 'goal', 'conflict', 'turningPoint', 'ending', 'handoff', 'title', 'beat']) {
    const value = item[field];
    if (typeof value !== 'string') throw new EvalContractError(`卷卡字段缺失：${field}`);
    if ((value as string).length > 60 && !['handoff'].includes(field)) throw new EvalContractError(`卷卡字段超60字：${field}`);
  }
  if (JSON.stringify(item).length > 6000) throw new EvalContractError('卷卡JSON超6000字符序列化上限');
}

function reviewAnalysis(sample: BuiltSample, verdict: { pass: boolean; issues: string[]; suggestions: string[] }): CaseAnalysis {
  if (sample.kind === 'positive') {
    // 干净候选：报阻塞即误报（suggestions不算阻塞）
    return { contractOk: true, cleanFalseAlarm: !verdict.pass, note: verdict.pass ? '干净候选正确通过' : `干净候选误报${verdict.issues.length}条` };
  }
  // 植入候选：必须检出全部三类已知错误（按语义关键词归类，作为召回判定的保守近似；
  // 最终文学性判定在验证阶段由盲评复核，此处仅统计可机检的信号）
  const text = verdict.issues.join('\n');
  const checks = [
    /字数|合计|400000|350000|target/u.test(text),
    /对抗线|贯穿|去向|职责/u.test(text),
    /将来|承诺|已经获得|无法核对|未发生/u.test(text)
  ];
  const caught = checks.filter(Boolean).length;
  return {
    contractOk: true,
    seededCaught: caught === checks.length,
    note: `植入错误召回${caught}/${checks.length}${verdict.pass ? '（但未标阻塞）' : ''}`
  };
}
