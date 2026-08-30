import {
  V7_CHAIN_OPTION_SCHEMA,
  V7_CHAPTER_REVIEW_SCHEMA,
  V7_CHAPTER_SEQUENCE_SCHEMA,
  V7_CHAPTER_SETTLEMENT_SCHEMA,
  V7_CREATION_CONTEXT_SCHEMA,
  V7_VOLUME_OPTION_SCHEMA,
  creationPromptContext,
  type V7ChainOption,
  type V7ChapterOutline,
  type V7ChapterReview,
  type V7ChapterSequence,
  type V7ChapterSettlement,
  type V7StageSettlement,
  type V7CreationContextSelection,
  type V7CreationMemberDefinition,
  type V7CreationSourceCandidate,
  type V7PlanningOptionReview,
  type V7VolumeOption
} from './creation-runtime-contracts.js';
import { parsePlanningTreeOutput, type PlanningTreeDocument } from '../planning-trees/index.js';

export const V7_CREATION_MEMBERS: readonly V7CreationMemberDefinition[] = [
  member('deputy-glm-5-3', '西施', 'context_editor', 1, true, coding('glm-5.3')),
  member('deputy-deepseek-v4-pro', '妙玉', 'context_editor', 2, false, coding('deepseek-v4-pro')),
  member('deputy-kimi-k3', '谢临川', 'context_editor', 3, false, agent('kimi-k3')),
  member('chief-deepseek-v4-pro', '貂蝉', 'chief_editor', 1, true, coding('deepseek-v4-pro')),
  member('chief-glm-5-3', '顾承砚', 'chief_editor', 2, false, coding('glm-5.3')),
  member('chief-kimi-k3', '沈知微', 'chief_editor', 3, false, agent('kimi-k3')),
  member('planner-deepseek-v4-pro', '红玉', 'planning_writer', 1, true, coding('deepseek-v4-pro')),
  member('planner-glm-5-3', '幼薇', 'planning_writer', 2, false, coding('glm-5.3')),
  member('planner-kimi-k3', '苏映棠', 'planning_writer', 3, false, agent('kimi-k3')),
  member('writer-deepseek-v4-pro', '司马相如', 'lead_writer', 1, true, coding('deepseek-v4-pro')),
  member('writer-kimi-k3', '清照', 'lead_writer', 2, false, agent('kimi-k3')),
  member('writer-glm-5-3', '曹雪芹', 'lead_writer', 3, false, coding('glm-5.3')),
  member('writer-deepseek-v4-flash', '谢道韫', 'lead_writer', 4, false, coding('deepseek-v4-flash')),
  member('writer-kimi-2-7', '柳永', 'lead_writer', 5, false, coding('kimi-k2.7-code')),
  member('writer-doubao', '蒲松龄', 'lead_writer', 6, false, coding('doubao-seed-2.1-turbo')),
  member('review-kimi-k3', '周行简', 'independent_reviewer', 1, true, agent('kimi-k3')),
  member('review-glm-5-3', '顾清辞', 'independent_reviewer', 2, false, coding('glm-5.3')),
  member('review-deepseek-v4-pro', '陆观澜', 'independent_reviewer', 3, false, coding('deepseek-v4-pro')),
  member('continuity-deepseek-v4-pro', '裴文心', 'settlement_editor', 1, true, coding('deepseek-v4-pro')),
  member('continuity-glm-5-3', '宋知遥', 'settlement_editor', 2, false, coding('glm-5.3')),
  member('continuity-kimi-k3', '沈墨', 'settlement_editor', 3, false, agent('kimi-k3'))
] as const;

export function creationFallbackChain(
  roleKey: V7CreationMemberDefinition['roleKey'],
  preferredMemberKey?: string | null,
  members: readonly V7CreationMemberDefinition[] = V7_CREATION_MEMBERS
): V7CreationMemberDefinition[] {
  // outline_writer 只是旧快照/旧调用的兼容别名；新任务统一使用固定岗位 planning_writer。
  const fixedRoleKey = roleKey === 'outline_writer' ? 'planning_writer' : roleKey;
  const candidates = members.filter((item) => item.roleKey === fixedRoleKey && item.enabledByDefault)
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
  // 独立审查会排除设计/写作所用的同一模型；若被排除者恰好是岗位默认成员，
  // 就按剩余交接顺序选第一位，不能误报整个岗位无人可用。
  const fallback = candidates.find((item) => item.defaultForRole) ?? candidates[0];
  if (fallback === undefined) throw new Error(`${fixedRoleKey}没有可用成员`);
  const compatiblePreferredKey = preferredMemberKey === undefined || preferredMemberKey === null
    ? undefined
    : legacyOutlineMemberKey(preferredMemberKey);
  const preferred = compatiblePreferredKey === undefined
    ? undefined
    : candidates.find((item) => item.memberKey === compatiblePreferredKey);
  if (preferredMemberKey !== undefined && preferredMemberKey !== null && preferred === undefined) {
    throw new Error('您选择的成员不属于当前岗位或正在请假');
  }
  const seen = new Set<string>();
  return [preferred, fallback, ...candidates].filter((item): item is V7CreationMemberDefinition => item !== undefined).filter((item) => {
    const key = `${item.model.provider}:${item.model.modelId}:${item.model.plan}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateCreationRoster(): string[] {
  const errors: string[] = [];
  for (const roleKey of ['context_editor', 'chief_editor', 'planning_writer', 'lead_writer', 'independent_reviewer', 'settlement_editor'] as const) {
    const members = V7_CREATION_MEMBERS.filter((item) => item.roleKey === roleKey && item.enabledByDefault);
    if (members.length < 3) errors.push(`${roleKey}至少需要三名可交接成员`);
    if (members.filter((item) => item.defaultForRole).length !== 1) errors.push(`${roleKey}必须且只能有一名默认成员`);
  }
  return errors;
}

export function contextSelectionPrompt(input: {
  taskBrief: string;
  candidates: readonly V7CreationSourceCandidate[];
  maximumSources: number;
  maximumCharacters?: number;
}): string {
  const compactCandidates = input.candidates.map(({ selectionContent, content, ...source }) => {
    const exactSource = { ...source, content };
    return {
      ...source,
      content: selectionContent ?? content,
      exactContentCharacters: Array.from(JSON.stringify(content)).length,
      exactPackedCharacters: Array.from(JSON.stringify(exactSource)).length
    };
  });
  return [
    '你是文秘写作资料编辑。只返回JSON对象，不要Markdown，不要思维过程。',
    '任务是从候选资料中选择完成当前任务所需的最小充分资料。required=true的正式源必须保留；不得选择其他书、过期候选或无来源推断。',
    '如果资料不足，请在openQuestions说明，不得自行补事实。',
    `最多选择${input.maximumSources}项；硬事实和当前任务优先，方法参考宁少勿杂。`,
    input.maximumCharacters === undefined
      ? ''
      : `入选精确资料连同任务说明不得超过${input.maximumCharacters}字符；请至少为任务说明、来源说明和结构保留3000字符。设定事实账本已经覆盖全书硬事实，只有需要核对完整措辞时才选择某项设定原文。`,
    '输出字段：schema="v7-creation-context-v1",publicSummary,selectedSourceKeys,selectionReasons,excludedSourceKeys,openQuestions。selectionReasons必须是数组，每项为{sourceKey,reason}。',
    `当前任务：${input.taskBrief}`,
    '候选阶段只阅读来源的语义索引；最终资料包仍会回查入选来源的精确正式内容，索引不能冒充正史。',
    `候选资料：${JSON.stringify(compactCandidates)}`
  ].filter(Boolean).join('\n\n');
}

export function parseContextSelection(output: string, candidates: readonly V7CreationSourceCandidate[], maximumSources: number): V7CreationContextSelection {
  const value = jsonObject(output);
  if (value.schema !== V7_CREATION_CONTEXT_SCHEMA) throw new Error('资料编辑返回格式无效');
  const allowed = new Set(candidates.map((item) => item.sourceKey));
  const selectedSourceKeys = textList(value.selectedSourceKeys, '入选资料', false);
  if (selectedSourceKeys.length > maximumSources || selectedSourceKeys.some((key) => !allowed.has(key))) throw new Error('资料编辑选择了无效来源');
  for (const required of candidates.filter((item) => item.required)) {
    if (!selectedSourceKeys.includes(required.sourceKey)) throw new Error('资料编辑遗漏了必要正式来源');
  }
  const rawReasons = Array.isArray(value.selectionReasons)
    ? objectList(value.selectionReasons, '选择理由')
    : value.selectionReasons !== null && typeof value.selectionReasons === 'object'
      ? Object.entries(value.selectionReasons as Record<string, unknown>).map(([sourceKey, reason]) => ({ sourceKey, reason }))
      : objectList(value.selectionReasons, '选择理由');
  const reasons = rawReasons.map((item) => ({
    sourceKey: requiredText(item.sourceKey, '资料标识'), reason: requiredText(item.reason, '选择理由')
  }));
  if (reasons.some((item) => !selectedSourceKeys.includes(item.sourceKey))) throw new Error('选择理由引用了未入选资料');
  const excludedSourceKeys = textList(value.excludedSourceKeys, '排除资料', true);
  if (excludedSourceKeys.some((key) => !allowed.has(key))) throw new Error('排除资料引用无效');
  return {
    schema: V7_CREATION_CONTEXT_SCHEMA,
    publicSummary: requiredText(value.publicSummary, '资料说明'),
    selectedSourceKeys: unique(selectedSourceKeys),
    selectionReasons: reasons,
    excludedSourceKeys: unique(excludedSourceKeys),
    openQuestions: textList(value.openQuestions, '开放问题', true)
  };
}

export function planningOptionPrompt(input: {
  kind: 'volume' | 'chain'; scopeId: string; contextPack: unknown;
  referencePack?: unknown;
  variation: 'option_1' | 'option_2' | 'option_3'; firstVolume: boolean;
}): string {
  const treeKind = input.kind;
  const schema = input.kind === 'volume' ? V7_VOLUME_OPTION_SCHEMA : V7_CHAIN_OPTION_SCHEMA;
  const childKind = input.kind === 'volume' ? 'chain' : 'event';
  const variation = input.variation === 'option_1'
    ? '本方案先从人物当前困境和最自然的因果突破口出发，形成稳健但不平庸的路线。'
    : input.variation === 'option_2'
      ? '本方案必须主动避开已有方案最显眼的事件路径，寻找另一种冲突组织和阶段兑现办法。'
      : '本方案必须提供只适合本书人物、时代和限制条件的原创推进，不得给已有方案换词或换顺序。';
  const first = input.firstVolume
    ? '这是第一卷：必须尽快建立主角处境、核心卖点和首个明确回报，并为开篇500字与黄金前三章提供具体责任；不要把固定字数或固定爽点间隔当成全书公式。'
    : '这不是第一卷：必须承接上一实际结果并制造与上一卷不同的阅读体验，不得机械重复第一卷公式。';
  return [
    '你是文秘写作规划编剧。独立设计一套真实故事方案，只返回JSON，不要Markdown，不要思维过程。',
    variation, first,
    '每套方案都必须兼顾因果与容量、商业追读、人物主动选择、创意辨识度和上下层接口。不能把不同方案理解成只分别负责结构、商业或人物。',
    '参考卡只是本席的小工具箱：最多采用其中三项，也可以不用；必须另外提出至少一种只适合本书的原创推进。不要在结果中背诵方法名称。',
    input.kind === 'volume'
      ? '卷方案只负责把已确认全书方向展开成若干短单元链：交代本卷目标、起点到卷末的可见变化、核心矛盾、每条链的推进与回报、人物变化、卷末接口和容量。详细情绪曲线、伏笔、事件因果和逐章安排留到链层，不在卷层重复设计。每链连续4—8章、通常约1万—2.8万字；整卷链数由实际字数反推并覆盖完整字数责任。'
      : '链方案负责具体设计：触发、目标、阻力、升级、关键选择、代价、兑现、结果、情绪变化、信息揭示、人物与关系变化、伏笔埋设或回收、合理章节容量和下一链接口；只到章纲责任，不写正文。',
    '树是未来规划，不能冒充已经发生；正式资料不可改写。方法只作软参考，必须保留人物合理选择和创意空间。',
    `输出字段：schema="${schema}",optionKind="${input.kind}",publicName,publicSummary,designRationale,readerExperience,coreConflict,protagonistChoice,priceAndChange,payoff,strengths,risks,tree。strengths和risks必须是字符串数组，不能写成一段字符串。`,
    `tree顶层必须完整包含schema="v7-planning-tree-v1",treeKind="${treeKind}",scopeId="${input.scopeId}",title,root；根节点kind="${treeKind}"，直接子节点只能是${childKind}。`,
    '每个树节点都必须包含对象字段：story={summary,majorEvents,protagonistChange,outcome,nextStep}；emotion={publicSummary,openingEmotion,pressureMovement,releaseEmotion,intensity}；experience={publicSummary,pressureRhythm,payoffCadence,informationRhythm,contrastWithPrevious,designReason}；causality={trigger,causes,coreConflict,turningPoint,consequences}；threads={foreshadowing,openQuestions}；budget={wordTarget,chapterRange}；以及linkedTree和children。majorEvents、causes、consequences、foreshadowing、openQuestions都只能是简短字符串数组，不要输出stableKey/state等对象。不得把其余对象缩写成字符串或数组。每个说明只写一两句，不要在多个字段重复同一段话。',
    input.kind === 'volume'
      ? '单卷树根节点linkedTree=null；每个直接子链节点linkedTree={treeKind:"chain",scopeId:"本方案内唯一且可复用的英文标识"}，children=[]。子链chapterRange使用连续的实际章节区间，从第1章起不能重叠或跳号；各子链wordTarget之和应覆盖根节点的本卷字数。'
      : '单元链树根节点linkedTree=null；每个直接事件节点linkedTree=null，children=[]。',
    `本席精简参考卡：${JSON.stringify(input.referencePack ?? { policy: '优先原创，不强制使用公共方法' })}`,
    `任务资料包：${JSON.stringify(creationPromptContext(input.contextPack))}`
  ].join('\n\n');
}

export function planningOptionRepairPrompt(input: {
  kind: 'volume' | 'chain';
  scopeId: string;
  invalidOutput: string;
  validationMessage: string;
}): string {
  const schema = input.kind === 'volume' ? V7_VOLUME_OPTION_SCHEMA : V7_CHAIN_OPTION_SCHEMA;
  const childKind = input.kind === 'volume' ? 'chain' : 'event';
  return [
    '你刚才的规划内容已经保留，但JSON结构没有通过合同校验。只修复合同问题，不要改变既有主线、人物选择、因果、回报和风险。',
    '只返回一个完整JSON对象，不要Markdown，不要解释，不要思维过程。',
    `外层schema固定为"${schema}"，optionKind固定为"${input.kind}"。tree必须补齐schema="v7-planning-tree-v1",treeKind="${input.kind}",scopeId="${input.scopeId}",title,root。`,
    `根节点kind="${input.kind}"且linkedTree=null；直接子节点kind="${childKind}"。${input.kind === 'volume' ? '每个子链linkedTree必须指向唯一chain范围。' : '每个事件linkedTree必须为null。'}`,
    '把每个节点原有story、emotion、experience、causality和threads内容无损整理为合同对象：story={summary,majorEvents,protagonistChange,outcome,nextStep}；emotion={publicSummary,openingEmotion,pressureMovement,releaseEmotion,intensity}；experience={publicSummary,pressureRhythm,payoffCadence,informationRhythm,contrastWithPrevious,designReason}；causality={trigger,causes,coreConflict,turningPoint,consequences}；threads={foreshadowing,openQuestions}。majorEvents、causes、consequences、foreshadowing、openQuestions必须是字符串数组，不要输出对象。',
    'emotion.intensity必须保留原有非空强弱说明；budget.chapterRange只能是null或[start,end]数字数组；strengths和risks必须是字符串数组。不能删除原有实质内容来规避字段。',
    input.kind === 'volume'
      ? '如果问题是单元链过长或覆盖不完整，请沿既有事件因果把长阶段拆成多条连续短链：每链4—8章、通常约1万—2.8万字，从第1章连续编号，各链wordTarget之和覆盖本卷根节点字数。拆分只能细化既有推进与回报，不能另造主线事实。'
      : '保留当前单元链的有限章节责任，不要扩写成新的卷级方向。',
    `校验问题：${input.validationMessage}`,
    `待修复原文：${input.invalidOutput}`
  ].join('\n\n');
}

export function parseVolumeOption(output: string, scopeId: string): V7VolumeOption {
  return parsePlanningOption(output, 'volume', scopeId) as V7VolumeOption;
}

export function parseChainOption(output: string, scopeId: string): V7ChainOption {
  return parsePlanningOption(output, 'chain', scopeId) as V7ChainOption;
}

export function optionReviewPrompt(input: { options: ReadonlyArray<{ optionId: string; option: V7VolumeOption | V7ChainOption }>; contextPack: unknown }): string {
  return [
    '你是文秘写作主编。比较已经独立保存的方案，只返回JSON，不要Markdown，不要思维过程。',
    `本轮共有${input.options.length}套完整方案。只做横向比较和选择建议，不得因为某套存在风险就要求全部重做。`,
    '必须比较它们真正不同的剧情方向。不得把同一剧情的换词、换顺序或只改侧重点说成不同方向；若相似，要如实告诉作者差异有限，但仍保留原方案供作者选择。',
    '不得重写原方案或新增未在正式资料中的重大事实。比较人物选择、因果、代价、阅读体验、阶段回报、上层责任、长期容量、追读效果、创意辨识度和风险。',
    '输出字段：schema="v7-planning-option-review-v1",publicSummary,recommendedOptionId,differences,risks,authorDecisions。',
    'publicSummary和differences会直接给作者看，只能用方案一、方案二、方案三等自然称呼，不得出现optionId、issues、schema、UUID或其他内部字段。',
    'differences必须逐案写一句完整大白话，同时说清独有优势和最值得注意的风险，不能只写“以什么为轴”。',
    `任务资料：${JSON.stringify(creationPromptContext(input.contextPack))}`,
    `候选方案：${JSON.stringify(input.options)}`
  ].join('\n\n');
}

export function parseOptionReview(output: string, optionIds: readonly string[]): V7PlanningOptionReview {
  const value = jsonObject(output);
  if (value.schema !== 'v7-planning-option-review-v1') throw new Error('主编点评格式无效');
  const recommendedOptionId = requiredText(value.recommendedOptionId, '推荐方案');
  if (!optionIds.includes(recommendedOptionId)) throw new Error('主编推荐了不存在的方案');
  const differences = objectList(value.differences, '方案差异').map((item) => ({
    optionId: requiredText(item.optionId, '方案标识'), difference: authorFacingReviewText(item.difference, '方案差异')
  }));
  if (differences.some((item) => !optionIds.includes(item.optionId))) throw new Error('主编差异引用无效');
  if (new Set(differences.map((item) => item.optionId)).size !== optionIds.length) throw new Error('主编差异没有覆盖全部方案');
  if (differences.some((item) => !/[，。；！？]/u.test(item.difference))) throw new Error('主编差异必须用完整大白话说明优点和风险');
  return {
    schema: 'v7-planning-option-review-v1',
    publicSummary: authorFacingReviewText(value.publicSummary, '主编点评'),
    recommendedOptionId,
    differences,
    risks: textList(value.risks, '共同风险', true).map((item) => authorFacingReviewText(item, '共同风险')),
    authorDecisions: textList(value.authorDecisions, '作者待决项', true).map((item) => authorFacingReviewText(item, '作者待决项'))
  };
}

export function optionReviewRepairPrompt(input: {
  invalidOutput: string;
  validationMessage: string;
  optionIds: readonly string[];
  optionLabels?: ReadonlyArray<{ optionId: string; label: string; name: string }>;
}): string {
  return [
    '你刚才的主编比较内容已经保留，但JSON使用了另一套审查格式。只转换合同结构，不要重新比较、改写结论、替换推荐方案或新增剧情。',
    '只返回一个完整JSON对象，不要Markdown，不要解释，不要思维过程。',
    '字段固定为schema="v7-planning-option-review-v1",publicSummary,recommendedOptionId,differences,risks,authorDecisions。',
    'publicSummary是给作者看的大白话：只能写方案一、方案二、方案三等自然称呼，不得出现optionId、issues、schema、字段名、UUID或其他内部技术词。推荐哪套要写成人话，但recommendedOptionId字段仍填写对应编号。',
    'differences必须覆盖现有方案，每项为{optionId,difference}；difference必须是一句完整中文，既写清这套独有的优势，也写清最值得注意的风险，不能只复述“以什么为轴”。',
    'risks和authorDecisions必须是字符串数组。原文中的每一项证据风险放入risks，对应处理办法放入authorDecisions，保留具体事实、时限和因果，不得缩成标签。',
    input.optionLabels === undefined ? '' : `作者看到的方案对应关系：${JSON.stringify(input.optionLabels)}`,
    `只能引用这些方案编号：${JSON.stringify(input.optionIds.map((optionId) => ({ optionId })))}`,
    `校验问题：${input.validationMessage}`,
    `待转换原文：${input.invalidOutput}`
  ].filter((item) => item.length > 0).join('\n\n');
}

export function parseOptionRevisionRequest(output: string): {
  publicSummary: string;
  risks: string[];
  authorDecisions: string[];
} {
  const value = jsonObject(output);
  if (value.verdict !== 'rewrite') throw new Error('主编没有要求重做方案');
  const issues = objectList(value.issues, '主编修改意见');
  if (issues.length === 0) throw new Error('主编要求重做但没有给出具体原因');
  return {
    publicSummary: authorFacingReviewText(value.summary, '主编重做说明'),
    risks: issues.map((issue) => authorFacingReviewText(issue.evidence, '主编发现的问题')),
    authorDecisions: issues.map((issue) => authorFacingReviewText(issue.requiredAction, '主编要求的调整'))
  };
}

function authorFacingReviewText(value: unknown, label: string): string {
  const text = requiredText(value, label);
  if (/(?:option\s*id|recommendedoptionid|issues|schema|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/iu.test(text)) {
    throw new Error(`${label}包含内部字段或编号`);
  }
  return text;
}

export function chapterSequencePrompt(input: {
  chainScopeId: string;
  chapterStart: number;
  chapterCount: number;
  contextPack: unknown;
  priorSequence?: V7ChapterSequence;
  rewriteInstructions?: string[];
}): string {
  const revision = input.priorSequence === undefined ? '这是首次设计。' : [
    '这是返工任务。保留原方案没有问题的部分，逐项落实主编要求，不要换壳复述原方案。',
    `主编要求：${(input.rewriteInstructions ?? []).join('；')}`,
    `待修改章纲：${JSON.stringify(input.priorSequence)}`
  ].join('\n');
  return [
    '你是文秘写作章纲编剧。只返回JSON，不要Markdown，不要思维过程。',
    '把确认单元链拆成紧凑、可直接写正文的章纲。每章必须发生真实变化或兑现一部分期待，不能用重复解释和无效过场拖字数。',
    '章数由当前链的内容容量决定；本次给出的chapterCount是上限目标，不足以自然承载时应减少，但不得少于2章。',
    '未来章纲不能冒充正文实际。人物选择、阻力、代价和下一章接口必须具体。',
    revision,
    `输出字段：schema="${V7_CHAPTER_SEQUENCE_SCHEMA}",chainScopeId,publicSummary,chapterStart,chapterEnd,chapters,sourceRefs。`,
    '每章的openQuestions必须是字符串数组；没有开放问题时返回空数组，不要返回单个字符串。',
    '每章字段：chapterNumber,title,objective,openingHook,sceneSetup,protagonistChoice,opposition,turn,emotionalMovement,payoff,continuity,openQuestions,nextChapterInterface。',
    `chainScopeId固定为${input.chainScopeId}，chapterStart固定为${input.chapterStart}，最多${input.chapterCount}章。`,
    `任务资料：${JSON.stringify(creationPromptContext(input.contextPack))}`
  ].join('\n\n');
}

export function parseChapterSequence(output: string, chainScopeId: string, chapterStart: number, maxCount: number): V7ChapterSequence {
  const value = jsonObject(output);
  if (value.schema !== V7_CHAPTER_SEQUENCE_SCHEMA || value.chainScopeId !== chainScopeId) throw new Error('章纲序列格式无效');
  const chapters = objectList(value.chapters, '章纲').map(parseChapterOutline);
  if (chapters.length < 2 || chapters.length > maxCount) throw new Error('章纲数量超出当前单元链范围');
  chapters.forEach((chapter, index) => {
    if (chapter.chapterNumber !== chapterStart + index) throw new Error('章纲序号不连续');
  });
  const chapterEnd = chapterStart + chapters.length - 1;
  if (Number(value.chapterStart) !== chapterStart || Number(value.chapterEnd) !== chapterEnd) throw new Error('章纲起止章节无效');
  return {
    schema: V7_CHAPTER_SEQUENCE_SCHEMA,
    chainScopeId,
    publicSummary: requiredText(value.publicSummary, '章纲说明'),
    chapterStart,
    chapterEnd,
    chapters,
    sourceRefs: Array.isArray(value.sourceRefs) ? structuredClone(value.sourceRefs) as V7ChapterSequence['sourceRefs'] : []
  };
}

export function outlineReviewPrompt(input: { sequence: V7ChapterSequence; contextPack: unknown }): string {
  return [
    '你是文秘写作章纲审查主编。只返回JSON，不要Markdown，不要思维过程。',
    '独立检查整条链的章纲是否忠于已确认方向，是否有清楚因果、人物主动选择、逐章变化、阶段回报和下一章接口。',
    '重点检查章节是否重复解释、用无效过场凑章、回报拖得过久，或让人物凭空知道不该知道的信息。',
    '只有硬冲突、核心链责任遗漏、明显重复拖沓或无法直接写正文时才判定不通过；一般优化放入qualitySuggestions。',
    `输出字段：schema="${V7_CHAPTER_REVIEW_SCHEMA}",passed,publicSummary,hardConflicts,continuityRisks,qualitySuggestions,rewriteInstructions。`,
    '三个问题数组每项字段为evidence,impact,action；未通过时必须给出可执行的重新设计要求。',
    'rewriteInstructions必须是字符串数组：每项直接写一条最小修改动作，不要输出target/instruction对象。通过时必须为空数组。',
    `本链章纲：${JSON.stringify(input.sequence)}`,
    `任务资料：${JSON.stringify(creationPromptContext(input.contextPack))}`
  ].join('\n\n');
}

export function chapterReviewRepairPrompt(input: {
  invalidOutput: string;
  validationMessage: string;
  reviewTarget: '章纲' | '正文';
}): string {
  return [
    `你刚才对${input.reviewTarget}的审查结论已经保留，但JSON使用了另一套格式。只修复审查合同，不要重新审查、改写证据、增加问题或删除问题。`,
    '只返回一个完整JSON对象，不要Markdown，不要解释，不要思维过程。',
    `字段固定为schema="${V7_CHAPTER_REVIEW_SCHEMA}",passed,publicSummary,hardConflicts,continuityRisks,qualitySuggestions,rewriteInstructions。`,
    'hardConflicts、continuityRisks、qualitySuggestions必须是对象数组，每项固定为{evidence,impact,action}。原文中明确导致事实冲突、因果断裂、越过人物知情边界或核心责任未完成的问题放入hardConflicts；连续性风险放入continuityRisks；普通优化放入qualitySuggestions。',
    'passed必须与原结论和问题严重度一致：原文明确要求在继续前必须修正、存在硬冲突或major问题时返回false，并把对应requiredAction逐条放入rewriteInstructions；只有普通建议时才返回true。',
    'publicSummary使用原文给作者看的结论；rewriteInstructions必须是字符串数组，通过时可以为空，未通过时不得为空。',
    `校验问题：${input.validationMessage}`,
    `待转换原文：${input.invalidOutput}`
  ].join('\n\n');
}

export function manuscriptPrompt(input: { outline: V7ChapterOutline; contextPack: unknown; priorText?: string; rewriteInstructions?: string[] }): string {
  const rewrite = input.rewriteInstructions?.length
    ? `这是返工任务，逐项落实：${input.rewriteInstructions.join('；')}。保留没有问题的内容，不要只返回修改片段。`
    : '这是首次写作。';
  return [
    '你是文秘写作主笔。输出完整中文小说正文，不要Markdown代码围栏，不要解释、字段标题或创作过程。',
    '正文必须让人物通过行动和选择推动场景；用具体行动、对白和后果呈现信息，不写资料包、章纲、审查、生成等工程词。',
    '人物推断必须有可验证的现场证据和合理推理链，不能用脚印深浅、表情或单一巧合直接断定身份、伤病或幕后真相；不确定时让人物保留怀疑并通过后续行动验证。',
    '遵守正式事实和人物知情边界，但保留对白、动作、意象和场面调度的创作空间。',
    rewrite,
    `确认章纲：${JSON.stringify(input.outline)}`,
    `任务资料：${JSON.stringify(creationPromptContext(input.contextPack))}`,
    input.priorText === undefined ? '' : `需要返工的完整正文：${input.priorText}`
  ].filter(Boolean).join('\n\n');
}

export function reviewPrompt(input: { outline: V7ChapterOutline; contextPack: unknown; manuscript: string }): string {
  const manuscriptCharacters = Array.from(input.manuscript).length;
  return [
    '你是文秘写作独立审校。只返回JSON，不要Markdown，不要思维过程。',
    '这是一次有停止条件的裁决，不是寻找所有可能问题，也不是重新策划或重写本章。完成下列核对后立即给结论，不推演资料没有提供的可能性。',
    '硬门禁只核对五项：本章核心责任；时间与空间连续；人物身份和知情边界；明确数值与正式规则；行动因果是否成立。只有正文中的明确证据与正式资料直接冲突，或核心责任未完成，才放入hardConflicts并判定passed=false。',
    '人物主动性、节奏、重复套路、工程口吻、伪聪明和假推理只做一次快速阅读检查，最多给3条qualitySuggestions；它们不得单独阻止定稿。没有可引用的正文证据就不要提出问题。',
    '能局部修改的问题不得夸大为整章推翻；不要重复同一根因，不要为了显得全面而凑问题。continuityRisks最多2条，hardConflicts最多3条。',
    `本次正文的确定长度是${manuscriptCharacters}个字符。不得自行估算字数；如非必要，publicSummary不要提长度。`,
    `输出字段：schema="${V7_CHAPTER_REVIEW_SCHEMA}",passed,publicSummary,hardConflicts,continuityRisks,qualitySuggestions,rewriteInstructions。`,
    '三个问题数组每项字段为evidence,impact,action；evidence必须引用正文中的短句或具体情节，不得输出模型内部评分。通过时rewriteInstructions必须为空；未通过时只列修复硬冲突所需的最小动作。',
    `确认章纲：${JSON.stringify(input.outline)}`,
    `任务资料：${JSON.stringify(creationPromptContext(input.contextPack))}`,
    `正文：${input.manuscript}`
  ].join('\n\n');
}

export function parseChapterReview(output: string): V7ChapterReview {
  const value = normalizeChapterReview(jsonObject(output));
  if (value.schema !== V7_CHAPTER_REVIEW_SCHEMA || typeof value.passed !== 'boolean') throw new Error('审校结果格式无效');
  const issues = (name: 'hardConflicts' | 'continuityRisks' | 'qualitySuggestions') => objectList(value[name], name).map((item) => ({
    evidence: requiredText(item.evidence, '问题证据'), impact: requiredText(item.impact, '问题影响'), action: requiredText(item.action, '修改动作')
  }));
  const hardConflicts = issues('hardConflicts');
  const declaredInstructions = textList(value.rewriteInstructions, '返工要求', true);
  // A provider may return verdict=pass while also labelling an issue major or
  // placing it in hardConflicts.  Accepting that contradictory payload used to
  // formalize known broken causality.  The structured evidence is authoritative:
  // any hard conflict requires a new immutable revision before settlement.
  const passed = value.passed && hardConflicts.length === 0;
  const result: V7ChapterReview = {
    schema: V7_CHAPTER_REVIEW_SCHEMA,
    passed,
    publicSummary: requiredText(value.publicSummary, '审校结论'),
    hardConflicts,
    continuityRisks: issues('continuityRisks'),
    qualitySuggestions: issues('qualitySuggestions'),
    rewriteInstructions: passed
      ? []
      : declaredInstructions.length > 0
        ? declaredInstructions
        : hardConflicts.map((item) => item.action)
  };
  if (!result.passed && result.rewriteInstructions.length === 0) throw new Error('未通过审校却没有可执行修改要求');
  return result;
}

function normalizeChapterReview(value: Record<string, unknown>): Record<string, unknown> {
  if (value.schema === V7_CHAPTER_REVIEW_SCHEMA && typeof value.passed === 'boolean') {
    return { ...value, rewriteInstructions: normalizeRewriteInstructionList(value.rewriteInstructions) };
  }
  const rawVerdict = typeof value.verdict === 'string' ? value.verdict.trim().toLowerCase() : '';
  const passed = typeof value.passed === 'boolean'
    ? value.passed
    : ['pass', 'passed', 'approved', '通过', '合格'].includes(rawVerdict)
      ? true
      : ['fail', 'failed', 'rejected', 'rewrite', 'revise', 'revision_required', '需修改', '需要修改', '不通过', '退回'].includes(rawVerdict)
        ? false
        : null;
  if (passed === null || !Array.isArray(value.issues)) return value;
  const hardConflicts: Array<Record<string, unknown>> = [];
  const continuityRisks: Array<Record<string, unknown>> = [];
  const qualitySuggestions: Array<Record<string, unknown>> = [];
  for (const rawIssue of objectList(value.issues, '审校问题')) {
    const severity = typeof rawIssue.severity === 'string' ? rawIssue.severity.trim().toLowerCase() : 'observation';
    const issueType = typeof rawIssue.issueType === 'string' ? rawIssue.issueType.trim().toLowerCase() : 'quality';
    const issue = {
      evidence: requiredText(rawIssue.evidence ?? rawIssue.location, '问题证据'),
      impact: typeof rawIssue.impact === 'string' && rawIssue.impact.trim().length > 0
        ? rawIssue.impact.trim()
        : `${issueType} · ${severity}`,
      action: requiredText(rawIssue.requiredAction ?? rawIssue.action, '修改动作')
    };
    if (['critical', 'blocker', 'major', 'hard'].includes(severity)) hardConflicts.push(issue);
    else if (['continuity', 'fact', 'causality', 'knowledge'].includes(issueType)) continuityRisks.push(issue);
    else qualitySuggestions.push(issue);
  }
  return {
    schema: V7_CHAPTER_REVIEW_SCHEMA,
    passed,
    publicSummary: value.publicSummary ?? value.summary,
    hardConflicts,
    continuityRisks,
    qualitySuggestions,
    rewriteInstructions: passed ? [] : hardConflicts.map((item) => String(item.action))
  };
}

function normalizeRewriteInstructionList(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry;
    const item = entry as Record<string, unknown>;
    const instruction = [item.instruction, item.action, item.requiredAction]
      .find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
    if (typeof instruction !== 'string') return entry;
    const target = typeof item.target === 'string' ? item.target.trim() : '';
    return target.length > 0 ? `${target}：${instruction.trim()}` : instruction.trim();
  });
}

export function settlementPrompt(input: { manuscriptVersionId: string; manuscript: string; outline: V7ChapterOutline; contextPack: unknown; evidenceRef: string }): string {
  return [
    '你是文秘写作结算编辑。只返回JSON，不要Markdown，不要思维过程。',
    '只提取这份作者已经定稿正文中明确发生的事实；计划、章纲、旧摘要和推断不能当成实际。没有证据的数组留空。',
    '每条不可逆结果、人物状态、关系、知情、资源、规则、故事线、伏笔、开放问题和树进度都必须引用给定正文证据；不得凭题材常识补写。',
    `输出字段：schema="${V7_CHAPTER_SETTLEMENT_SCHEMA}",publicSummary,irreversibleResults,entityStates,relationshipChanges,knowledgeChanges,resourceChanges,ruleChanges,storyLines,foreshadowing,openQuestions,treeActuals。`,
    'irreversibleResults、entityStates、relationshipChanges、knowledgeChanges、resourceChanges、ruleChanges每项至少包含summary和evidenceRefs；人物或关系项如资料中已有entityId也要保留。storyLines字段：stableKey,title,state,summary,evidenceRefs。foreshadowing字段：stableKey,title,state,summary,evidenceRefs。openQuestions字段：stableKey,question,state,answer,evidenceRefs。treeActuals字段：treeKind,scopeId,nodeKey,state,summary,emotionResult,experienceResult,outcome,evidenceRefs。',
    '状态值必须原样使用英文枚举：storyLines 只能是 introduced/advancing/paused/intersected/completed/abandoned；foreshadowing 只能是 planted/deepened/partially_revealed/resolved/retired；openQuestions 只能是 open/answered/retired；treeActuals 只能是 partial/completed/deviated。',
    '为后续章节保留少而准的事实：不可逆结果最多3项，人物状态最多4项，关系最多2项，知情最多3项，资源最多3项，规则最多2项，故事线最多3项，伏笔最多4项，开放问题最多4项，树进度只写本章实际推进的节点；每项summary只写一句，不重复同一事实。',
    `唯一正文证据引用：${input.evidenceRef}`,
    `正文版本：${input.manuscriptVersionId}`,
    `确认章纲（仅用于对照，不能当实际）：${JSON.stringify(input.outline)}`,
    `任务资料（仅用于核对）：${JSON.stringify(creationPromptContext(input.contextPack))}`,
    `定稿正文：${input.manuscript}`
  ].join('\n\n');
}

export function parseChapterSettlement(output: string, allowedEvidenceRefs: readonly string[]): V7ChapterSettlement {
  const value = jsonObject(output);
  if (value.schema !== V7_CHAPTER_SETTLEMENT_SCHEMA) throw new Error('结算结果格式无效');
  const evidence = (raw: unknown): string[] => {
    const refs = textList(raw, '正文证据', false);
    if (refs.some((ref) => !allowedEvidenceRefs.includes(ref))) throw new Error('结算引用了非正式证据');
    return unique(refs);
  };
  const evidencedChanges = (raw: unknown, label: string): unknown[] => arrayValue(raw).map((entry) => {
    if (typeof entry === 'string') {
      return { summary: requiredText(entry, label), evidenceRefs: [...allowedEvidenceRefs] };
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`${label}格式无效`);
    const item = entry as Record<string, unknown>;
    const summary = item.summary ?? item.result ?? item.state ?? item.change ?? item.content ?? item.detail ?? item.title;
    const evidenceRefs = item.evidenceRefs === undefined ? [...allowedEvidenceRefs] : evidence(item.evidenceRefs);
    return { ...item, summary: requiredText(summary, label), evidenceRefs };
  });
  return {
    schema: V7_CHAPTER_SETTLEMENT_SCHEMA,
    publicSummary: requiredText(value.publicSummary, '结算说明'),
    irreversibleResults: evidencedChanges(value.irreversibleResults, '不可逆结果'),
    entityStates: evidencedChanges(value.entityStates, '人物状态变化'),
    relationshipChanges: evidencedChanges(value.relationshipChanges, '关系变化'),
    knowledgeChanges: evidencedChanges(value.knowledgeChanges, '知情变化'),
    resourceChanges: evidencedChanges(value.resourceChanges, '资源变化'),
    ruleChanges: evidencedChanges(value.ruleChanges, '规则变化'),
    storyLines: objectList(value.storyLines, '故事线').map((item) => ({
      stableKey: stableKey(item.stableKey), title: requiredText(item.title, '故事线标题'), state: localizedEnumValue(item.state, ['introduced', 'advancing', 'paused', 'intersected', 'completed', 'abandoned'] as const, {
        '引入': 'introduced', '刚出现': 'introduced', '新出现': 'introduced', '待解': 'introduced',
        '进行中': 'advancing', '推进中': 'advancing', '推进': 'advancing', '暂停中': 'paused', '已暂停': 'paused',
        '交汇中': 'intersected', '已交汇': 'intersected', '已完成': 'completed', '完成': 'completed', '已放弃': 'abandoned'
      }, '故事线状态'),
      summary: requiredText(item.summary, '故事线变化'), evidenceRefs: evidence(item.evidenceRefs)
    })),
    foreshadowing: objectList(value.foreshadowing, '伏笔').map((item) => ({
      stableKey: stableKey(item.stableKey), title: requiredText(item.title, '伏笔标题'), state: localizedEnumValue(item.state, ['planted', 'deepened', 'partially_revealed', 'resolved', 'retired'] as const, {
        '已埋设': 'planted', '埋下': 'planted', '新埋': 'planted', '加深': 'deepened', '已加深': 'deepened',
        '部分揭示': 'partially_revealed', '部分揭开': 'partially_revealed', '已回收': 'resolved', '已揭示': 'resolved',
        '已解决': 'resolved', '已退役': 'retired', '已废弃': 'retired'
      }, '伏笔状态'),
      summary: requiredText(item.summary, '伏笔变化'), evidenceRefs: evidence(item.evidenceRefs)
    })),
    openQuestions: objectList(value.openQuestions, '开放问题').map((item) => ({
      stableKey: stableKey(item.stableKey), question: requiredText(item.question, '开放问题'), state: localizedEnumValue(item.state, ['open', 'answered', 'retired'] as const, {
        '待解': 'open', '未解': 'open', '进行中': 'open', '已回答': 'answered', '已解决': 'answered', '已退役': 'retired', '已废弃': 'retired'
      }, '开放问题状态'),
      answer: item.answer === null || item.answer === undefined || item.answer === '' ? null : requiredText(item.answer, '答案'), evidenceRefs: evidence(item.evidenceRefs)
    })),
    treeActuals: objectList(value.treeActuals, '树进度').map((item) => ({
      treeKind: enumValue(item.treeKind, ['book', 'volume', 'chain'] as const, '树类型'), scopeId: stableKey(item.scopeId), nodeKey: stableKey(item.nodeKey),
      state: localizedEnumValue(item.state, ['partial', 'completed', 'deviated'] as const, {
        '部分完成': 'partial', '进行中': 'partial', '已完成': 'completed', '完成': 'completed', '已偏离': 'deviated', '偏离': 'deviated'
      }, '树进度'), summary: requiredText(item.summary, '实际进展'),
      emotionResult: requiredText(item.emotionResult, '实际情绪'), experienceResult: requiredText(item.experienceResult, '实际体验'), outcome: requiredText(item.outcome, '实际结果'), evidenceRefs: evidence(item.evidenceRefs)
    }))
  };
}

export function stageSettlementPrompt(input: {
  settlementKind: 'chain' | 'volume';
  scopeId: string;
  scopeTitle: string;
  sourceSettlements: ReadonlyArray<{ evidenceRef: string; content: unknown }>;
}): string {
  const kindName = input.settlementKind === 'chain' ? '单元链' : '本卷';
  return [
    `你是文秘写作结算编辑。请根据已经完成的下层正式结算，整理${kindName}实际结果。只返回JSON，不要Markdown，不要思维过程。`,
    '这是写后结算，不是未来规划。只能归纳给定正式结算中有证据的实际，不得把原计划、题材常识或猜测写成发生过的内容。',
    '必须覆盖每一份给定证据；内容用简洁大白话，只保留后续创作真正需要知道的变化。',
    `输出字段：schema="v7-stage-settlement-v1",settlementKind="${input.settlementKind}",scopeId="${input.scopeId}",publicSummary,irreversibleResults,entityStates,closedThreads,openThreads,relationshipChanges,knowledgeChanges,resourceChanges,ruleChanges,protagonistChange,outcome,nextStep,evidenceRefs。`,
    `范围名称：${input.scopeTitle}`,
    `正式结算证据：${JSON.stringify(input.sourceSettlements)}`
  ].join('\n\n');
}

export function parseStageSettlement(
  output: string,
  expected: { settlementKind: 'chain' | 'volume'; scopeId: string; allowedEvidenceRefs: readonly string[] }
): V7StageSettlement {
  const value = jsonObject(output);
  if (value.schema !== 'v7-stage-settlement-v1'
    || value.settlementKind !== expected.settlementKind
    || value.scopeId !== expected.scopeId) throw new Error('阶段结算结果格式无效');
  const evidenceRefs = textList(value.evidenceRefs, '阶段结算证据', false);
  if (evidenceRefs.some((ref) => !expected.allowedEvidenceRefs.includes(ref))) throw new Error('阶段结算引用了非正式证据');
  if (expected.allowedEvidenceRefs.some((ref) => !evidenceRefs.includes(ref))) throw new Error('阶段结算遗漏了下层正式结算');
  return {
    schema: 'v7-stage-settlement-v1',
    settlementKind: expected.settlementKind,
    scopeId: expected.scopeId,
    publicSummary: requiredText(value.publicSummary, '阶段结算说明'),
    irreversibleResults: arrayValue(value.irreversibleResults),
    entityStates: arrayValue(value.entityStates),
    closedThreads: arrayValue(value.closedThreads),
    openThreads: arrayValue(value.openThreads),
    relationshipChanges: arrayValue(value.relationshipChanges),
    knowledgeChanges: arrayValue(value.knowledgeChanges),
    resourceChanges: arrayValue(value.resourceChanges),
    ruleChanges: arrayValue(value.ruleChanges),
    protagonistChange: requiredText(value.protagonistChange, '主角变化'),
    outcome: requiredText(value.outcome, '阶段结果'),
    nextStep: requiredText(value.nextStep, '下一步接口'),
    evidenceRefs: unique(evidenceRefs)
  };
}

function parsePlanningOption(output: string, kind: 'volume' | 'chain', scopeId: string): V7VolumeOption | V7ChainOption {
  const value = jsonObject(output);
  const schema = kind === 'volume' ? V7_VOLUME_OPTION_SCHEMA : V7_CHAIN_OPTION_SCHEMA;
  if (value.schema !== schema || value.optionKind !== kind) throw new Error('规划方案格式无效');
  const tree = parsePlanningTreeOutput(JSON.stringify(value.tree), kind, scopeId);
  if (kind === 'volume') assertVolumeChainCadence(tree);
  return {
    schema, optionKind: kind, publicName: requiredText(value.publicName, '方案名称'), publicSummary: requiredText(value.publicSummary, '方案说明'),
    designRationale: typeof value.designRationale === 'string' && value.designRationale.trim().length > 0
      ? requiredText(value.designRationale, '设计理由')
      : requiredText(value.publicSummary, '设计理由'),
    readerExperience: requiredText(value.readerExperience, '阅读体验'), coreConflict: requiredText(value.coreConflict, '核心冲突'),
    protagonistChoice: requiredText(value.protagonistChoice, '主角选择'), priceAndChange: requiredText(value.priceAndChange, '代价与变化'),
    payoff: requiredText(value.payoff, '阶段回报'), strengths: textListOrSingleText(value.strengths, '方案优势', false), risks: textListOrSingleText(value.risks, '方案风险', true), tree
  } as V7VolumeOption | V7ChainOption;
}

/**
 * 卷方案的语义由规划成员负责；服务端只校验作者已经确认的节奏硬边界。
 * 这避免“18万字只有四条长链”通过结构校验后，把拖沓一路传给章纲。
 */
function assertVolumeChainCadence(tree: PlanningTreeDocument): void {
  const chains = tree.root.children;
  if (chains.length === 0) throw new Error('卷方案没有单元链');
  let expectedStart = 1;
  let chainWords = 0;
  for (const chain of chains) {
    const range = chain.budget.chapterRange;
    if (range === null) throw new Error('每条单元链必须给出连续章节区间');
    const [start, end] = range;
    const chapterCount = end - start + 1;
    if (start !== expectedStart) throw new Error('单元链章节区间必须从第1章起连续且不能重叠');
    if (chapterCount < 4 || chapterCount > 8) throw new Error('每条单元链必须在4至8章内完成一次明确回报');
    const wordTarget = chain.budget.wordTarget;
    if (wordTarget === null || wordTarget < 10_000 || wordTarget > 28_000) {
      throw new Error('每条单元链字数应与4至8章的紧凑容量一致');
    }
    expectedStart = end + 1;
    chainWords += wordTarget;
  }
  const volumeWords = tree.root.budget.wordTarget;
  if (volumeWords !== null) {
    const gap = Math.abs(chainWords - volumeWords);
    if (gap > Math.max(3_000, volumeWords * 0.05)) throw new Error('各单元链字数之和没有覆盖本卷字数责任');
  }
}

function parseChapterOutline(value: Record<string, unknown>): V7ChapterOutline {
  return {
    chapterNumber: integer(value.chapterNumber, '章节序号'), title: requiredText(value.title, '章节标题'), objective: requiredText(value.objective, '本章目标'),
    openingHook: requiredText(value.openingHook, '开篇抓点'), sceneSetup: requiredText(value.sceneSetup, '场景'), protagonistChoice: requiredText(value.protagonistChoice, '主角选择'),
    opposition: requiredText(value.opposition, '阻力'), turn: requiredText(value.turn, '变化'), emotionalMovement: requiredText(value.emotionalMovement, '情绪变化'),
    payoff: requiredText(value.payoff, '本章回报'), continuity: requiredText(value.continuity, '连续性责任'), openQuestions: textListOrSingleText(value.openQuestions, '开放问题', true),
    nextChapterInterface: requiredText(value.nextChapterInterface, '下一章接口')
  };
}

function member(memberKey: string, displayName: string, roleKey: V7CreationMemberDefinition['roleKey'], fallbackPriority: number, defaultForRole: boolean, model: V7CreationMemberDefinition['model']): V7CreationMemberDefinition {
  return { memberKey, displayName, roleKey, fallbackPriority, defaultForRole, enabledByDefault: true, model, promptInstruction: '' };
}

function legacyOutlineMemberKey(memberKey: string): string {
  return ({
    'creation-outline-glm-5-3': 'planner-glm-5-3',
    'creation-outline-deepseek-v4-pro': 'planner-deepseek-v4-pro',
    'creation-outline-kimi-k3': 'planner-kimi-k3'
  } as Record<string, string>)[memberKey] ?? memberKey;
}

function coding(modelId: string): V7CreationMemberDefinition['model'] { return { provider: 'volcengine-ark-coding-plan', modelId, plan: 'coding' }; }
function agent(modelId: string): V7CreationMemberDefinition['model'] { return { provider: 'volcengine-ark-agent-plan', modelId, plan: 'agent' }; }

function jsonObject(output: string): Record<string, unknown> {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('模型没有返回JSON对象');
  const value = JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('模型返回内容不是JSON对象');
  return value as Record<string, unknown>;
}

function objectList(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`);
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`${label}内容无效`);
    return item as Record<string, unknown>;
  });
}

function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? structuredClone(value) : []; }

function textList(value: unknown, label: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label}必须是${allowEmpty ? '' : '非空'}数组`);
  return value.map((item) => requiredText(item, label));
}

/**
 * 模型偶尔把本应为列表的一整段原义文字放进字符串。服务端只做无损容器归一，
 * 不按标点拆解、排序或改写语义；真正缺内容时仍保持严格失败。
 */
function textListOrSingleText(value: unknown, label: string, allowEmpty: boolean): string[] {
  if (typeof value === 'string') {
    const item = value.trim();
    if (item.length === 0) {
      if (allowEmpty) return [];
      throw new Error(`${label}必须是非空数组`);
    }
    return [item];
  }
  return textList(value, label, allowEmpty);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空`);
  return value.trim();
}

function stableKey(value: unknown): string {
  const key = requiredText(value, '稳定标识');
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(key)) throw new Error('稳定标识无效');
  return key;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${label}无效`);
  return Number(value);
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${label}无效`);
  return value as T[number];
}

/**
 * 只归一模型把合同枚举直译成中文的容器差异，不推断文学语义。
 * 未登记的值仍严格失败，防止程序替代结算编辑判断内容状态。
 */
function localizedEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  aliases: Readonly<Record<string, T[number]>>,
  label: string
): T[number] {
  if (typeof value !== 'string') throw new Error(`${label}无效`);
  const normalized = aliases[value.trim()] ?? value.trim();
  return enumValue(normalized, allowed, label);
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
