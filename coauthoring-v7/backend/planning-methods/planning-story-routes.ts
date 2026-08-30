import type { LayeredPlanningRecipe } from './layered-planning-engine.js';
import type { V7PlanningMethodCandidate } from './planning-method-retrieval.js';
import {
  compactPlanningMethodCards,
  parseProgressivePlanningBrief,
  type V7ProgressivePlanningBrief
} from './progressive-planning-briefs.js';

export interface V7PlanningRouteVolume {
  order: number;
  title: string;
  direction: string;
  protagonistChange: string;
  mainPressure: string;
  readerPayoff: string;
  targetWords: number;
  handoff: string;
}

export interface V7PlanningStoryRoute {
  schema: 'v7-planning-story-route-v1';
  routeTitle: string;
  oneLinePromise: string;
  publicSummary: string;
  readingExperience: string;
  protagonistJourney: string;
  targetWords: number;
  targetVolumes: number;
  commercialAudience: string;
  retentionPositioning: string;
  volumeRoadmap: V7PlanningRouteVolume[];
  firstVolumeFocus: string[];
  sellingPoints: string[];
  risks: string[];
  openQuestions: string[];
}

export interface V7PlanningRouteReview {
  schema: 'v7-planning-route-review-v1';
  publicSummary: string;
  recommendedRouteId: string;
  routeReviews: Array<{
    routeId: string;
    publicName: string;
    biggestStrength: string;
    mainRisk: string;
    suitableFor: string;
    keyDifference: string;
    volumeJudgement: string;
    audienceJudgement: string;
    retentionJudgement: string;
  }>;
  commonRisks: string[];
  authorDecisions: string[];
}

export interface V7PlanningRouteFusion {
  schema: 'v7-planning-route-fusion-v2';
  publicSummary: string;
  route: V7PlanningStoryRoute;
  brief: V7ProgressivePlanningBrief;
  adoptedParts: Array<{ routeId: string; adopted: string }>;
  discardedRisks: string[];
}

export function parsePlanningStoryRoute(output: string): V7PlanningStoryRoute {
  const value = parseJsonObject(output) as Partial<V7PlanningStoryRoute>;
  if (value.schema !== 'v7-planning-story-route-v1') throw new Error('故事路线格式不完整');
  const targetWords = integer(value.targetWords, '目标字数', 50_000, 20_000_000);
  const targetVolumes = integer(value.targetVolumes, '目标卷数', 1, 30);
  if (!Array.isArray(value.volumeRoadmap) || value.volumeRoadmap.length !== targetVolumes) {
    throw new Error('故事路线的卷数与分卷路线不一致');
  }
  const volumeRoadmap = value.volumeRoadmap.map((item, index) => routeVolume(item, index + 1));
  const roadmapWords = volumeRoadmap.reduce((sum, item) => sum + item.targetWords, 0);
  const tolerance = Math.max(20_000, Math.round(targetWords * 0.03));
  if (Math.abs(roadmapWords - targetWords) > tolerance) throw new Error('各卷目标字数与全书目标字数不一致');
  return {
    schema: 'v7-planning-story-route-v1',
    routeTitle: requiredText(value.routeTitle, '路线名称'),
    oneLinePromise: requiredText(value.oneLinePromise, '一句话看点'),
    publicSummary: requiredText(value.publicSummary, '路线说明'),
    readingExperience: requiredText(value.readingExperience, '阅读体验'),
    protagonistJourney: requiredText(value.protagonistJourney, '主角长期变化'),
    targetWords,
    targetVolumes,
    commercialAudience: requiredText(value.commercialAudience, '商业受众'),
    retentionPositioning: requiredText(value.retentionPositioning, '追读定位'),
    volumeRoadmap,
    firstVolumeFocus: textList(value.firstVolumeFocus, '首卷重点', 2, 8),
    sellingPoints: textList(value.sellingPoints, '路线卖点', 2, 8),
    risks: textList(value.risks, '路线风险', 1, 8),
    openQuestions: textList(value.openQuestions, '开放问题', 0, 8)
  };
}

export function parsePlanningRouteReview(output: string, routeIds: readonly string[]): V7PlanningRouteReview {
  const value = parseJsonObject(output) as Partial<V7PlanningRouteReview>;
  if (value.schema !== 'v7-planning-route-review-v1') throw new Error('主编路线点评格式不完整');
  const recommendedRouteId = requiredText(value.recommendedRouteId, '主编推荐路线');
  if (!routeIds.includes(recommendedRouteId)) throw new Error('主编推荐了不存在的路线');
  if (!Array.isArray(value.routeReviews) || value.routeReviews.length !== routeIds.length) throw new Error('主编没有逐一点评全部路线');
  const seen = new Set<string>();
  const routeReviews = value.routeReviews.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('路线点评格式无效');
    const entry = item as Record<string, unknown>;
    const routeId = requiredText(entry.routeId, '点评路线');
    if (!routeIds.includes(routeId) || seen.has(routeId)) throw new Error('路线点评引用错误或重复');
    seen.add(routeId);
    return {
      routeId,
      publicName: requiredText(entry.publicName, '路线公开名称'),
      biggestStrength: requiredText(entry.biggestStrength, '最大优势'),
      mainRisk: requiredText(entry.mainRisk, '主要风险'),
      suitableFor: requiredText(entry.suitableFor, '适合方向'),
      keyDifference: requiredText(entry.keyDifference, '核心差异'),
      volumeJudgement: requiredText(entry.volumeJudgement, '卷数规划点评'),
      audienceJudgement: requiredText(entry.audienceJudgement, '受众定位点评'),
      retentionJudgement: requiredText(entry.retentionJudgement, '追读设计点评')
    };
  });
  return {
    schema: 'v7-planning-route-review-v1',
    publicSummary: requiredText(value.publicSummary, '主编总结'),
    recommendedRouteId,
    routeReviews,
    commonRisks: textList(value.commonRisks, '共同风险', 0, 8),
    authorDecisions: textList(value.authorDecisions, '作者待决定项', 0, 8)
  };
}

export function parsePlanningRouteFusion(
  output: string,
  routeIds: readonly string[],
  candidateMethodKeys: readonly string[],
  seatKey: V7ProgressivePlanningBrief['seatKey']
): V7PlanningRouteFusion {
  const value = parseJsonObject(output) as Partial<V7PlanningRouteFusion>;
  if (value.schema !== 'v7-planning-route-fusion-v2') throw new Error('路线整理结果格式不完整');
  if (value.route === undefined || value.brief === undefined) throw new Error('路线整理结果缺少路线或设计依据');
  const routeValue = typeof value.route === 'object' && value.route !== null && !Array.isArray(value.route)
    ? value.route as unknown as Record<string, unknown>
    : null;
  if (routeValue === null) throw new Error('故事路线格式不完整');
  const route = parsePlanningStoryRoute(JSON.stringify({
    ...routeValue,
    schema: 'v7-planning-story-route-v1',
    firstVolumeFocus: normalizeDelimitedList(routeValue.firstVolumeFocus, 2, 8, /[；。]\s*/u),
    sellingPoints: normalizeDelimitedList(routeValue.sellingPoints, 2, 8, /[；。]\s*/u),
    risks: normalizeDelimitedList(routeValue.risks, 1, 8, /[；。]\s*/u),
    openQuestions: normalizeDelimitedList(routeValue.openQuestions, 0, 8, /[；。]\s*/u)
  }));
  const briefValue = typeof value.brief === 'object' && value.brief !== null && !Array.isArray(value.brief)
    ? value.brief as unknown as Record<string, unknown>
    : null;
  if (briefValue === null) throw new Error('全案主编返回的方向依据格式不完整');
  const brief = parseProgressivePlanningBrief(JSON.stringify({
    ...briefValue,
    schema: 'v7-progressive-planning-brief-v2',
    seatKey,
    creativeOpenings: normalizeDelimitedList(briefValue.creativeOpenings, 2, 6, /[；、]\s*/u),
    strengths: normalizeDelimitedList(briefValue.strengths, 1, 6, /[；。]\s*/u),
    risks: normalizeDelimitedList(briefValue.risks, 1, 6, /[；。]\s*/u),
    authorDecisions: normalizeDelimitedList(briefValue.authorDecisions, 0, 6, /[；。]\s*/u)
  }), seatKey, candidateMethodKeys);
  if (!Array.isArray(value.adoptedParts)) throw new Error('路线整理结果缺少采用说明');
  const adoptedParts = value.adoptedParts.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('采用说明格式无效');
    const entry = item as Record<string, unknown>;
    const routeId = requiredText(entry.routeId, '来源路线');
    if (!routeIds.includes(routeId)) throw new Error('采用说明引用了不存在的路线');
    return { routeId, adopted: requiredText(entry.adopted, '采用内容') };
  });
  return {
    schema: 'v7-planning-route-fusion-v2',
    publicSummary: requiredText(value.publicSummary ?? brief.publicSummary, '整理说明'),
    route,
    brief,
    adoptedParts,
    discardedRisks: textList(value.discardedRisks, '舍弃风险', 0, 8)
  };
}

export function validateRecipeMethods(recipe: LayeredPlanningRecipe, allowedMethodKeys: readonly string[]): void {
  const allowed = new Set(allowedMethodKeys);
  const visit = (node: LayeredPlanningRecipe['root']): void => {
    if (node.methodGuidance.length > 6) throw new Error(`${node.title}使用的方法过多，可能分散创作注意力`);
    for (const guidance of node.methodGuidance) {
      if (guidance.source === 'library' && (guidance.methodKey === undefined || !allowed.has(guidance.methodKey))) {
        throw new Error(`${node.title}引用了本次没有检索到的方法`);
      }
    }
    node.children.forEach(visit);
  };
  visit(recipe.root);
}

export function planningStoryRoutePrompt(input: {
  sourceSnapshot: unknown;
  planningBrief: V7ProgressivePlanningBrief;
  selectedMethods: readonly V7PlanningMethodCandidate[];
  routeLabel: string;
}): string {
  return [
    '你是长篇小说规划编剧。只返回一个JSON对象，不要Markdown，不要思维过程。',
    `你独立负责${input.routeLabel}，不能看到另外两名编剧的路线。`,
    '请把上游精简设计依据翻译成读者能感受到的真实故事路线。方法是软参考，不得把专业术语写入路线正文，也不得为了套模板牺牲人物选择。',
    '上游已经包含本书原创策略。你可以继续创造更合适的具体推进，但不能把公共方法直接替换人名后当成剧情。',
    '路线现在只规划全书方向和各卷责任，不展开卷内单元链、具体事件或章纲。首卷必须尽早兑现核心卖点，但不能用固定字数公式代替内容判断。',
    '正式开书资料中的预计总字数是本轮硬边界：targetWords必须完全一致，每卷字数合计也必须与总字数一致。',
    '你必须根据这套路线的真实内容独立规划合理卷数，并写出这套方向最适合的商业受众与追读定位。它们是本席方案结果，不是开书资料里已有的答案。',
    '默认按番茄连载场景考虑阅读门槛、卖点展示、阶段回报和首卷抓人能力；不能只写抽象人群或“爱看小说的读者”。',
    '未来内容只是候选规划，不能冒充正文实际；正式资料中的主角、时代、禁用项和作者硬要求不得改写。',
    '输出字段：schema="v7-planning-story-route-v1",routeTitle,oneLinePromise,publicSummary,readingExperience,protagonistJourney,targetWords,targetVolumes,commercialAudience,retentionPositioning,volumeRoadmap,firstVolumeFocus,sellingPoints,risks,openQuestions。',
    'volumeRoadmap每项包含order,title,direction,protagonistChange,mainPressure,readerPayoff,targetWords,handoff；目标字数合计应与全书接近。',
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`,
    `本路线精简设计依据：${JSON.stringify(input.planningBrief)}`,
    `本路线引用到的方法卡：${JSON.stringify(compactPlanningMethodCards(input.selectedMethods))}`
  ].join('\n\n');
}

/**
 * One full-case chief selects a few method cards and designs one complete
 * route in the same call. The nested envelope reuses the proven fusion parser
 * so old stored proposal/route tables remain compatible without an AI-to-AI
 * relay or a second "method proposal" call.
 */
export function planningDirectStoryRoutePrompt(input: {
  sourceSnapshot: unknown;
  seatKey: V7ProgressivePlanningBrief['seatKey'];
  routeLabel: string;
  explorationOpening: string;
  candidates: readonly V7PlanningMethodCandidate[];
}): string {
  return [
    '你是文秘写作V7的一名全案规划主编。只返回一个JSON对象，不要Markdown，不要思维过程。',
    `你独立负责${input.routeLabel}。${input.explorationOpening}`,
    '你必须在一次工作中同时完成：从少量候选方法中选4—6项适合本书的工具、加入至少1项本书原创策略、设计完整的全书粗路线和各卷责任，并写清自己的设计理由。',
    '你必须兼顾作者原意、人物主动选择、因果可信、长篇容量、跨卷递进、商业追读、阶段回报、首卷抓人能力、创意辨识度和中后期续航，不能只负责其中一项。',
    '候选方法只是工具箱，不是答案；可以少用，但library方法只能引用候选methodKey。agent_original不得填写methodKey，也不得写回公共方法库。不要把方法名写进故事路线。',
    '这一步只规划全书方向和每卷责任，不展开卷内单元链、具体事件或章纲。未来规划不能冒充已经发生；作者确认资料、人物、时代、禁用项和预计总字数不得改写。',
    'route.targetWords必须与正式资料中的预计总字数完全一致；各卷targetWords合计也必须一致。卷数、商业受众和追读定位由你根据本方案内容独立规划。',
    '默认按番茄长篇连载场景考虑阅读门槛、卖点展示、阶段回报与持续追读，但不得套常见题材路线后只替换人名。',
    '如正式资料存在无法同时成立、会直接改变全书路线的冲突，返回同一JSON对象并加入missingCriticalInputs说明；没有则返回missingCriticalInputs:[]。普通创作留白不是缺口。',
    '输出schema="v7-planning-route-fusion-v2"；publicSummary写本方案设计理由；adoptedParts必须为[]；discardedRisks写你主动避开的套路或风险。',
    '完整JSON控制在6000个汉字以内。每个说明字段只写一段必要内容；分卷每个字段用一到两句交代清楚，不重复同一卖点，不用长篇论证挤占完整JSON。',
    `brief必须完整遵守v7-progressive-planning-brief-v2，seatKey固定为${input.seatKey}，selectedStrategies总数4—6且至少1项为agent_original。`,
    'brief必须包含publicSummary,centralPromise,causalSpine,protagonistArc,longFormCapacity,pressureRhythm,payoffCadence,informationRhythm,distinctiveness,selectedStrategies,creativeOpenings,strengths,risks,authorDecisions。',
    'selectedStrategies每项只允许source("library"或"agent_original"),title,layer("book_backbone"或"volume_distribution"),applicationNote,caution；只有library项填写本轮候选methodKey，agent_original不得填写methodKey。',
    'route必须完整遵守v7-planning-story-route-v1，并在route内部填写schema="v7-planning-story-route-v1"；包含routeTitle,oneLinePromise,publicSummary,readingExperience,protagonistJourney,targetWords,targetVolumes,commercialAudience,retentionPositioning,volumeRoadmap,firstVolumeFocus,sellingPoints,risks,openQuestions。',
    'route.firstVolumeFocus必须是2—8条字符串组成的JSON数组，不能写成一整段字符串。sellingPoints、risks、openQuestions也必须是字符串数组。',
    'volumeRoadmap每项包含order,title,direction,protagonistChange,mainPressure,readerPayoff,targetWords,handoff。',
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`,
    `本轮精简候选方法卡：${JSON.stringify(compactPlanningMethodCards(input.candidates))}`
  ].join('\n\n');
}

export function planningDirectStoryRouteRepairPrompt(input: {
  sourceSnapshot: unknown;
  seatKey: V7ProgressivePlanningBrief['seatKey'];
  candidates: readonly V7PlanningMethodCandidate[];
  invalidOutput: string;
  validationMessage: string;
}): string {
  return [
    '你刚才设计的全书方向内容可以保留，但JSON合同没有通过校验。只返回修正后的完整JSON对象，不要Markdown，不要解释过程，不要改写方案方向。',
    `校验问题：${input.validationMessage}`,
    '最外层schema必须是v7-planning-route-fusion-v2，并完整包含publicSummary、brief、route、adoptedParts、discardedRisks、missingCriticalInputs。',
    `brief.schema必须是v7-progressive-planning-brief-v2，brief.seatKey必须是${input.seatKey}；selectedStrategies保持4—6项且至少1项为agent_original。`,
    'brief必须补齐publicSummary,centralPromise,causalSpine,protagonistArc,longFormCapacity,pressureRhythm,payoffCadence,informationRhythm,distinctiveness,selectedStrategies,creativeOpenings,strengths,risks,authorDecisions。',
    'selectedStrategies每项只允许source、title、layer、applicationNote、caution，以及library项的methodKey；source只能是library或agent_original，layer只能是book_backbone或volume_distribution。',
    'route.schema必须是v7-planning-story-route-v1；route.firstVolumeFocus必须是2—8条字符串数组；sellingPoints、risks、openQuestions也必须是字符串数组。',
    'route.targetWords和各卷targetWords合计必须继续等于正式资料的预计总字数。adoptedParts保持[]。',
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`,
    `本轮允许引用的方法卡：${JSON.stringify(compactPlanningMethodCards(input.candidates))}`,
    `需要修正格式的原方案：${input.invalidOutput}`
  ].join('\n\n');
}

export function planningRouteReviewPrompt(input: {
  sourceSnapshot: unknown;
  routes: ReadonlyArray<{ routeId: string; memberName: string; route: V7PlanningStoryRoute }>;
}): string {
  return [
    `你是长篇小说规划主编。本轮${input.routes.length}套故事路线已经由不同成员独立完成。只返回一个JSON对象，不要Markdown，不要思维过程。`,
    '请公平比较，不得隐藏路线，不得替作者确认。重点检查作者原意、长期容量、卷间递进、首卷吸引力、因果续航、重复拖沓风险和创意空间。',
    '同时检查全部路线是否遵守作者确认的预计总字数与其他硬要求；逐套判断它自己规划的卷数是否撑得起篇幅、受众是否清楚、追读承诺是否能被各卷持续兑现。',
    '前端只展示大白话，因此不要出现方法专业名、模型、提示词、内部字段或技术状态。',
    '输出字段：schema="v7-planning-route-review-v1",publicSummary,recommendedRouteId,routeReviews,commonRisks,authorDecisions。',
    'routeReviews必须逐一包含routeId,publicName,biggestStrength,mainRisk,suitableFor,keyDifference,volumeJudgement,audienceJudgement,retentionJudgement。',
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`,
    `独立路线：${JSON.stringify(input.routes)}`
  ].join('\n\n');
}

export function planningRouteFusionPrompt(input: {
  sourceSnapshot: unknown;
  selected: ReadonlyArray<{ routeId: string; route: V7PlanningStoryRoute; brief: V7ProgressivePlanningBrief }>;
  authorNote: string;
  candidateMethods: readonly V7PlanningMethodCandidate[];
}): string {
  return [
    '你是长篇小说规划主编。作者要求调整或融合已选路线。只返回一个JSON对象，不要Markdown，不要思维过程。',
    '只处理作者选中的路线与作者意见，不能把未选路线偷偷混入。正式资料和正文实际不得改写。',
    '整理后的路线仍必须遵守正式开书资料中的预计总字数与其他硬要求；并根据融合后的真实内容重新给出合理卷数、商业受众和追读定位，不能照抄未采用方案。',
    '最终路线与精简设计依据必须彼此一致。selectedStrategies保持4—6项，至少一项为agent_original；库方法只能引用本次候选，原创策略只属于当前书。',
    '输出字段：schema="v7-planning-route-fusion-v2",publicSummary,route,brief,adoptedParts,discardedRisks。',
    'brief字段必须完整遵守v7-progressive-planning-brief-v2，并沿用一份被选中方案的seatKey。',
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`,
    `作者意见：${input.authorNote}`,
    `作者选中的路线：${JSON.stringify(input.selected)}`,
    `本次允许引用的精简方法卡：${JSON.stringify(compactPlanningMethodCards(input.candidateMethods))}`
  ].join('\n\n');
}

function routeVolume(value: unknown, expectedOrder: number): V7PlanningRouteVolume {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('分卷路线格式无效');
  const entry = value as Record<string, unknown>;
  const order = integer(entry.order, '分卷顺序', 1, 30);
  if (order !== expectedOrder) throw new Error('分卷路线顺序不连续');
  return {
    order,
    title: requiredText(entry.title, '分卷名称'),
    direction: requiredText(entry.direction, '分卷方向'),
    protagonistChange: requiredText(entry.protagonistChange, '主角变化'),
    mainPressure: requiredText(entry.mainPressure, '主要压力'),
    readerPayoff: requiredText(entry.readerPayoff, '读者回报'),
    targetWords: integer(entry.targetWords, '分卷目标字数', 20_000, 2_000_000),
    handoff: requiredText(entry.handoff, '下一卷接口')
  };
}

function parseJsonObject(output: string): Record<string, unknown> {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('模型没有返回JSON对象');
  const value = JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('模型返回内容不是JSON对象');
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空`);
  return value.trim();
}

function textList(value: unknown, label: string, min: number, max: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label}数量无效`);
  return value.map((item) => requiredText(item, label));
}

function normalizeDelimitedList(
  value: unknown,
  min: number,
  max: number,
  delimiter: RegExp
): unknown {
  if (typeof value !== 'string') return value;
  const items = value.split(delimiter).map((item) => item.trim()).filter(Boolean);
  return items.length >= min && items.length <= max ? items : value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label}无效`);
  return Number(value);
}
