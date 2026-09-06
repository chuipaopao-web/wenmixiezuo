import { createHash } from 'node:crypto';
import type {
  V7ChiefReview,
  V7DeputyBrief,
  V7SettingCatalogItem,
  V7SettingCatalogRecommendation,
  V7SettingContextPack,
  V7WriterProposal
} from './setting-agent-contracts.js';

export function buildSettingContextPack(
  input: Omit<V7SettingContextPack, 'hash' | 'contextPolicyVersion' | 'characterCount' | 'budgetChars'>
): V7SettingContextPack {
  const budgetChars = 12_000 as const;
  const characterCount = Array.from(JSON.stringify({
    openingSummary: input.openingSummary,
    confirmedSettings: input.confirmedSettings,
    authorNote: input.authorNote,
    itemContract: input.itemContract
  })).length;
  if (characterCount > budgetChars) {
    throw new Error(`当前设定资料超过单次处理上限（${characterCount}/${budgetChars}字），请先完成分组整理。`);
  }
  const payload = {
    ...input,
    contextPolicyVersion: 'layered-setting-v2' as const,
    characterCount,
    budgetChars
  };
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { ...payload, hash };
}

export function compileDeputyPrompt(pack: V7SettingContextPack): string {
  return `${base(pack)}\n你是副编，只做资料核对与创作转译，不替编剧写设定。严格JSON：{"verifiedFacts":[""],"uncertainPoints":[""],"usableBoundaries":[""],"translationForWriter":""}。不能确认的内容必须放入uncertainPoints，禁止伪造来源。`;
}

export function compileWriterPrompt(pack: V7SettingContextPack, deputyBrief: V7DeputyBrief | null, adjustment = '', currentContent = ''): string {
  const current = currentContent.trim().length === 0 ? '' : `\n【当前版本】${projectSettingFinalContent(currentContent)}\n如有当前版本，必须在它的基础上按作者意见修改，不得无故另起一套。`;
  return `${base(pack)}\n【副编整理】${JSON.stringify(deputyBrief)}\n【作者本轮意见】${adjustment || '无'}${current}\n你是设计成员。只设计当前条目，不擅自补完别的条目。content只写作者真正要使用的设定结论，用日常大白话，紧凑、明确、方便后续检索。contextSummary写一句下游先检索的摘要；factEntries逐条抄出content中的身份、时间、规则、边界、数量和关系事实，不能新增推断。不得写账号、书籍编号、版本号、哈希、资料包、系统字段、提示词或专业创作方法名；不得把设计理由、后续影响、依赖和风险混入content。严格JSON：{"content":"80至800字的最终设定","designRationale":"为什么这样设计，80至300字","contextSummary":"不超过120字的检索摘要","factEntries":["每条不超过220字的硬事实"],"storyConsequences":["对后续设定或剧情的影响"],"dependencies":["依赖的已确认事实"],"risks":["尚需作者决定或最终审查的问题"]}。`;
}

export function compileSettingGroupPrompt(
  pack: V7SettingContextPack,
  items: ReadonlyArray<{ itemKey: string; label: string; prompt: string; authorNote: string }>
): string {
  return [
    'v7_setting_group_design_v1',
    `【已经确认的开书信息】${pack.openingSummary}`,
    `【已经确认的设定事实】${JSON.stringify(pack.confirmedSettings)}`,
    `【本组要完成的设定】${JSON.stringify(items)}`,
    '你是本组设计成员。一次完成本组全部条目，但每项必须独立成稿，不能把几项合成一段，也不能互相重复。',
    '每项content只放作者最终会采用的设定结论；contextSummary是一句下游检索摘要；factEntries逐条摘录content里的身份、时间、规则、边界、数量和关系事实，不能新增推断。',
    'selfReview要检查与正式开书资料、已确认设定和本组其他条目是否冲突。小问题直接修正；确需作者选择才标needs_author。不要输出思维过程、内部字段、提示词或方法名。',
    '严格JSON：{"items":[{"itemKey":"必须与输入一致","content":"80至800字","designRationale":"80至300字","contextSummary":"不超过120字","factEntries":[""],"storyConsequences":[""],"dependencies":[""],"risks":[""],"selfReview":{"verdict":"pass或needs_author","summary":"一句话","issues":[{"problem":"","impact":"","suggestion":""}],"suggestions":[""]}}]}。'
  ].join('\n');
}

export function parseSettingGroupProposals(
  output: string,
  expectedItemKeys: readonly string[]
): Array<{ itemKey: string; proposal: V7WriterProposal; review: V7ChiefReview }> {
  const value = objectFromOutput(output);
  if (!Array.isArray(value.items)) throw new Error('分组设定没有返回条目列表');
  const expected = new Set(expectedItemKeys);
  const seen = new Set<string>();
  const result = value.items.map((entry) => {
    const row = asObject(entry);
    const itemKey = boundedText(row.itemKey, '设定条目编号', 1, 160);
    if (!expected.has(itemKey)) throw new Error(`分组设定返回了未派发条目：${itemKey}`);
    if (seen.has(itemKey)) throw new Error(`分组设定重复返回条目：${itemKey}`);
    seen.add(itemKey);
    const proposal = parseWriterProposal(JSON.stringify(row));
    const selfReview = asObject(row.selfReview);
    const review = parseChiefReview(JSON.stringify({
      ...selfReview,
      finalContent: proposal.content,
      contextSummary: proposal.contextSummary,
      factEntries: proposal.factEntries
    }), proposal.content);
    return { itemKey, proposal, review };
  });
  const missing = expectedItemKeys.filter((itemKey) => !seen.has(itemKey));
  if (missing.length > 0) throw new Error(`分组设定漏掉条目：${missing.join('、')}`);
  return result;
}

export function compileChiefPrompt(pack: V7SettingContextPack, proposal: V7WriterProposal): string {
  return `${base(pack)}\n【编剧方案】${JSON.stringify(proposal)}\n你是主编。检查与开书资料、已确认设定是否冲突，是否越界，是否能直接供后续故事规划使用。不要输出思维过程。可修正措辞和明确的逻辑小错；真正需要作者取舍时标needs_author。finalContent只保留作者需要阅读和采用的设定结论，必须用大白话；不得出现账号、书籍编号、版本号、哈希、资料包、系统字段、提示词或专业创作方法名，也不得混入设计理由。issues只允许列出finalContent中仍然存在、且必须由作者取舍的问题；已经在finalContent修正的问题不得继续列入issues，能够直接修正且不需作者取舍时应返回pass。contextSummary是供后续成员先检索的一句话摘要；factEntries必须逐条抄出finalContent中以后不能写错的身份、时间、规则、边界、数量和关系事实，不能新增、推断或省略关键限制。严格JSON：{"verdict":"pass或needs_author","finalContent":"审核后的最终设定","summary":"一句话审核结论","contextSummary":"不超过120字的检索摘要","factEntries":["每条不超过220字的硬事实"],"issues":[{"problem":"","impact":"","suggestion":""}],"suggestions":[""]}。`;
}

export function compileFusionPrompt(pack: V7SettingContextPack, proposals: V7WriterProposal[], authorNote: string): string {
  return `${base(pack)}\n作者要求：${authorNote || '融合优点并保持一致'}\n候选：${JSON.stringify(proposals)}\n你是主编，融合候选但不得把互相冲突的设定硬拼。输出与主编审核完全相同的JSON。`;
}

export function compileSettingCatalogRecommendationPrompt(input: {
  openingProfile: unknown;
  catalog: readonly V7SettingCatalogItem[];
  memberInstruction?: string;
}): string {
  const catalog = input.catalog.map((item) => ({
    key: item.key,
    name: item.label,
    group: item.groupTitle,
    purpose: item.prompt
  }));
  return [
    '你是这本书的主编。作者已经确认开书资料，现在只判断后续设定阶段应该准备哪些条目，不写设定内容，不修改开书资料。',
    '请完整理解人物、时代、题材、故事方向、明确禁止项和作者已经确定的边界。不能只靠关键词；否定表达不能反向触发题材。',
    '把目录中的每一个key恰好放进一组：requiredKeys=现在不做就无法稳定规划本书；suggestedKeys=可能有帮助但可稍后；excludedKeys=本书当前没有依据，暂时不用。',
    'requiredKeys必须精简到14项以内，suggestedKeys必须精简到8项以内。相近条目如果会反复描述同一批事实，只保留最能承担该事实的一项；不要为了“更全面”把同一主题的总纲、规则、应用和校验项全部列为必做。',
    '四项核心设定 world-stage、social-order、rules-costs、boundaries-blanks 必须放进requiredKeys。历史文不能无依据加入游戏、修仙或超凡条目；明确写了相关题材时才可加入。',
    'summary用一至三句大白话说明为什么这样安排，不要出现模型、提示词、资料包、哈希、字段名或专业方法名。',
    input.memberInstruction?.trim() ? `【主编补充要求】${input.memberInstruction.trim()}` : '',
    `【作者确认的开书资料】${JSON.stringify(input.openingProfile)}`,
    `【完整设定目录】${JSON.stringify(catalog)}`,
    '只输出严格JSON：{"requiredKeys":[""],"suggestedKeys":[""],"excludedKeys":[""],"summary":""}。'
  ].filter(Boolean).join('\n');
}

export function parseSettingCatalogRecommendation(
  output: string,
  catalog: readonly V7SettingCatalogItem[]
): V7SettingCatalogRecommendation {
  const value = objectFromOutput(output);
  const requiredKeys = catalogKeys(value.requiredKeys, '现在需要的条目');
  const suggestedKeys = catalogKeys(value.suggestedKeys, '可选补充的条目');
  const excludedKeys = catalogKeys(value.excludedKeys, '暂不需要的条目');
  const allowed = new Set(catalog.map((item) => item.key));
  const classified = [...requiredKeys, ...suggestedKeys, ...excludedKeys];
  if (classified.some((key) => !allowed.has(key))) throw new Error('主编返回了目录中不存在的条目');
  if (new Set(classified).size !== classified.length) throw new Error('主编把同一条目放进了多个分组');
  if (classified.length !== allowed.size || classified.some((key) => !allowed.has(key))) {
    throw new Error('主编没有完整整理全部设定条目');
  }
  for (const key of ['world-stage', 'social-order', 'rules-costs', 'boundaries-blanks']) {
    if (!requiredKeys.includes(key)) throw new Error('主编漏掉了开书后必须准备的核心设定');
  }
  if (requiredKeys.length > 14) throw new Error('主编把过多条目列为现在必做，请合并相近职责并精简到14项以内');
  if (suggestedKeys.length > 8) throw new Error('主编把过多条目列为可选补充，请只保留最有价值的8项');
  return {
    requiredKeys,
    suggestedKeys,
    excludedKeys,
    summary: boundedText(value.summary, '主编说明', 2, 500)
  };
}

export function parseDeputyBrief(output: string): V7DeputyBrief {
  const value = objectFromOutput(output);
  return {
    verifiedFacts: stringArray(value.verifiedFacts), uncertainPoints: stringArray(value.uncertainPoints),
    usableBoundaries: stringArray(value.usableBoundaries), translationForWriter: requiredText(value.translationForWriter, '资料转译')
  };
}

export function parseWriterProposal(output: string): V7WriterProposal {
  const value = objectFromOutput(output);
  const content = boundedText(value.content, '设定正文', 20, 2_000);
  return {
    content,
    designRationale: boundedText(value.designRationale, '设计思路', 10, 1_000),
    contextSummary: typeof value.contextSummary === 'string' && value.contextSummary.trim().length > 0
      ? boundedText(value.contextSummary, '检索摘要', 2, 300)
      : content,
    factEntries: Array.isArray(value.factEntries) && value.factEntries.length > 0
      ? value.factEntries.slice(0, 24).map((entry) => boundedText(entry, '设定事实', 1, 300))
      : [content],
    storyConsequences: stringArray(value.storyConsequences), dependencies: stringArray(value.dependencies), risks: stringArray(value.risks)
  };
}

export function parseChiefReview(output: string, approvedWriterContent?: string): V7ChiefReview {
  const value = objectFromOutput(output);
  if (value.verdict !== 'pass' && value.verdict !== 'needs_author') throw new Error('主编结论必须为pass或needs_author');
  const issues = Array.isArray(value.issues) ? value.issues.map((entry) => {
    const row = asObject(entry);
    return { problem: requiredText(row.problem, '问题'), impact: requiredText(row.impact, '影响'), suggestion: requiredText(row.suggestion, '建议') };
  }).slice(0, 12) : [];
  const finalContent = typeof value.finalContent === 'string' && value.finalContent.trim().length > 0
    ? value.finalContent
    // 主编已经给出合法结论但偶发漏抄最终正文时，只能沿用其刚审核的
    // 编剧原文，不能让系统自行补写或把空结果交给作者。
    : approvedWriterContent;
  return {
    verdict: value.verdict, finalContent: boundedText(finalContent, '最终设定', 20, 2_000),
    summary: boundedText(value.summary, '审核结论', 2, 500),
    contextSummary: typeof value.contextSummary === 'string' && value.contextSummary.trim().length > 0
      ? boundedText(value.contextSummary, '检索摘要', 2, 300)
      : boundedText(value.summary, '检索摘要', 2, 300),
    // Historical/fake adapters may not yet return the projection fields.  In
    // that case preserve the exact reviewed content as one fact instead of
    // inventing a lossy programmatic summary.  The downstream budget compiler
    // can then require a one-time semantic rebuild when that legacy fact is too
    // large.
    factEntries: Array.isArray(value.factEntries) && value.factEntries.length > 0
      ? value.factEntries.slice(0, 24).map((entry) => boundedText(entry, '设定事实', 1, 300))
      : [boundedText(finalContent, '最终设定', 20, 2_000)],
    issues, suggestions: stringArray(value.suggestions)
  };
}

function base(pack: V7SettingContextPack): string {
  return `【这次要设计】${pack.itemContract.label}：${pack.itemContract.prompt}\n【已经确认的开书信息】${pack.openingSummary}\n【已经确认的其他设定】${JSON.stringify(pack.confirmedSettings)}\n【作者意见】${pack.authorNote || '无'}`;
}

/**
 * 内部版本、所有权和审计哈希仍保存在资料包与数据库中，但作者界面永远不展示。
 * 这里也兼容清理修复前已经生成的历史内容，避免为了脱敏改写原始版本。
 */
export function sanitizeAuthorFacingSettingText(value: string): string {
  return value
    .replace(/账号\s*[：:]?\s*owner-[a-z0-9_-]+[。；;]?/giu, '')
    .replace(/书籍\s*[：:]?\s*(?:v7-)?book-[a-z0-9_-]+[。；;]?/giu, '')
    .replace(/开书版本\s*[：:]?\s*\d+[。；;]?/gu, '')
    .replace(/资料包哈希\s*[：:]?\s*[a-f0-9]{32,64}[。；;]?/giu, '')
    .replace(/\b(?:owner|v7-book|book|batch|task|output|candidate)-[a-z0-9_-]+\b/giu, '')
    .replace(/\b[a-f0-9]{64}\b/giu, '')
    .replace(/[（(]\s*[a-z][a-z0-9_-]*(?:\s*[，,]\s*revision\s*\d+)?\s*[）)]/giu, '')
    .replace(/\brevision\s*\d+\b/giu, '')
    .replace(/\b[a-z][a-z0-9_]*-[a-z0-9_-]+\b/giu, '')
    .replace(/本条目冻结当前设定边界，不得擅自修改或突破/gu, '这部分说明已经确定、需要保持一致的内容')
    .replace(/本条目/gu, '这项设定')
    .replace(/所有已确认设定（[^）]*）均视为硬约束，不可更改/gu, '已经确认的内容需要保持一致')
    .replace(/以下区域为留白，禁止在未经作者或主编明确指令时擅自补全/gu, '以下内容暂时不确定，后续写到时再决定')
    .replace(/冻结范围/gu, '已经确定的内容')
    .replace(/冻结项/gu, '已经确定的内容')
    .replace(/刚性约束/gu, '必须遵守的内容')
    .replace(/硬红线|红线/gu, '绝对不能违反的规则')
    .replace(/硬约束/gu, '必须遵守的内容')
    .replace(/主线走向/gu, '长期故事方向')
    .replace(/历史基线/gu, '历史背景')
    .replace(/时代锚点/gu, '具体年代')
    .replace(/包内/gu, '现有资料中')
    .replace(/资料包/gu, '写作资料')
    .replace(/留白/gu, '暂不确定的内容')
    .replace(/[ \t]+([，。；：])/gu, '$1')
    .replace(/([。；]){2,}/gu, '$1')
    .replace(/[（(]\s*[）)]/gu, '')
    .replace(/^[ \t]+|[ \t]+$/gmu, '')
    .trim();
}

export function projectSettingFinalContent(value: string): string {
  const [conclusion = ''] = sanitizeAuthorFacingSettingText(value).split(/\s*(?:设计理由|设计思路|故事后果|后续影响|依赖|风险)\s*[：:]/u, 1);
  return conclusion.trim() || '本项内容暂未整理完整，请重新设计。';
}

function objectFromOutput(output: string): Record<string, unknown> {
  const cleaned = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回JSON对象');
  return asObject(JSON.parse(cleaned.slice(start, end + 1)));
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('模型返回内容不是对象');
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空`);
  return value.trim();
}

function boundedText(value: unknown, label: string, min: number, max: number): string {
  const text = requiredText(value, label);
  const length = Array.from(text).length;
  if (length < min || length > max) throw new Error(`${label}长度必须在${min}至${max}字之间`);
  return text;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim()).slice(0, 20) : [];
}

function catalogKeys(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是列表`);
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) throw new Error(`${label}包含无效条目`);
    return entry.trim();
  });
}
