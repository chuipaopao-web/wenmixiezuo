import { createHash } from 'node:crypto';
import { applySettingRuleChanges, parseSettingRules, renderSettingRule, renderSettingRules, SETTING_RULE_OUTPUT_INSTRUCTION, type SettingRule } from './setting-rules.js';
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
    ...(input.candidateSettings?.length ? { candidateSettings: input.candidateSettings } : {}),
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
  return `${base(pack)}\n${SETTING_RULE_OUTPUT_INSTRUCTION}\n【副编整理】${JSON.stringify(deputyBrief)}\n【作者本轮意见】${adjustment || '无'}${current}\n你是设计成员。只设计当前条目，不擅自补完别的条目。规则只写作者真正要使用的设定结论。不得写账号、书籍编号、版本号、哈希、资料包、系统字段、提示词或专业创作方法名；不得把设计理由、后续影响、依赖和风险混入content。严格JSON：${JSON.stringify({rules: [{level: "topic", statement: "规则结论", scope: "", conditions: [], costs: [], exceptions: [], objects: []}], contextSummary: "一句话检索摘要", designRationale: "", storyConsequences: [], dependencies: [], risks: []})}。`;
}

export function compileSettingGroupPrompt(
  pack: V7SettingContextPack,
  items: ReadonlyArray<{ itemKey: string; label: string; prompt: string; authorNote: string }>,
  concise = false
): string {
  return [
    'v7_setting_group_design_v1',
    `【已经确认的开书信息】${pack.openingSummary}`,
    `【已经确认的设定事实】${JSON.stringify(pack.confirmedSettings)}`,
    ...(pack.candidateSettings?.length ? [`【当前待确认草案】${JSON.stringify(pack.candidateSettings)}`, '延续已经提出的共同规则，避免重复；这些草案尚未获作者确认。若与正式资料冲突，以正式资料为准并标明需要调整。'] : []),
    `【本组要完成的设定】${JSON.stringify(items)}`,
    '你是本组设计成员。一次完成本组全部条目，但每项必须独立成稿，不能把几项合成一段，也不能互相重复。',
    SETTING_RULE_OUTPUT_INSTRUCTION,
    'selfReview要检查与正式开书资料、已确认设定和本组其他条目是否冲突。小问题直接修正；确需作者选择才标needs_author。issues每项必须是{problem,impact,suggestion}三个非空字符串字段的对象，不能是字符串；无问题时为空数组。不要输出思维过程、内部字段、提示词或方法名。',
    '严格JSON：{"items":[{"itemKey":"必须与输入一致","rules":[{"level":"topic","statement":"必要规则，简洁大白话","scope":"","conditions":[],"costs":[],"exceptions":[],"objects":[]}],"designRationale":"","contextSummary":"一句话检索摘要","storyConsequences":[],"dependencies":[],"risks":[],"selfReview":{"verdict":"pass或needs_author","summary":"一句话","issues":[],"suggestions":[]}}]}。'
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
      rules: proposal.rules,
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
  if (proposal.rules?.length) return `${base(pack)}\n${SETTING_RULE_OUTPUT_INSTRUCTION}\n【待审规则，index从0开始】${JSON.stringify(proposal.rules.map((rule, index) => ({ index, ...rule })))}
你是独立审查编辑。核对作者资料与每条规则的含义、范围、条件、例外和层级。只提交有依据的局部修改，不重写整套规则。没有问题的规则由系统原样保留。
旧规则若把条件、代价、适用范围或例外分在辅助字段，使用replace把独有信息融入statement，去掉语义重复，并清空兼容字段。完整短句是目标，不是截短摘要；不得靠删掉限制来变短。没有分散或重复表达的规则不为精简而改写。
把“主要”误写成“只能”、凭空增添禁令或处罚、把局部机制列为global，都应直接修正；恢复已知事实不需要作者再次确认。replace必须返回该条完整规则，保留没有问题的条件和例外；重复或无依据的整条规则用remove。index始终指原方案，不随删除变化。reason简述修改依据，不输出思维过程。
issues仅列修改后仍无法依据现有资料解决、必须由作者决定的冲突，每项包含problem、impact、suggestion三个非空字符串。已解决的问题不要再列。没有未解决冲突返回pass和空issues。
严格JSON：{"verdict":"pass","ruleChanges":[{"index":0,"action":"replace","reason":"修改依据","rule":{"level":"topic","statement":"修正结论","scope":"","conditions":[],"costs":[],"exceptions":[],"objects":[]}}],"summary":"审核结论","contextSummary":"检索摘要","issues":[],"suggestions":[]}。无修改时ruleChanges为空数组；禁止输出rules、finalContent或另一套事实。`;
  return `${base(pack)}\n${SETTING_RULE_OUTPUT_INSTRUCTION}\n【编剧方案】${JSON.stringify(proposal)}\n你是主编。检查与开书资料、已确认设定是否冲突，是否越界，是否能直接供后续故事规划使用。不要输出思维过程。可修正措辞和明确的逻辑小错；恢复作者已给定的事实无需再请作者确认。删除本任务未要求、也无依据的新增禁令，不把设计成员自己添加的限制推给作者反复选择。真正存在无法自行取舍的冲突才标needs_author。finalContent只保留作者需要阅读和采用的设定结论，必须用大白话；不得出现账号、书籍编号、版本号、哈希、资料包、系统字段、提示词或专业创作方法名，也不得混入设计理由。issues只允许列出finalContent中仍然存在、且必须由作者取舍的问题；已经在finalContent修正的问题不得继续列入issues，能够直接修正且不需作者取舍时应返回pass。issues每项必须是包含problem、impact、suggestion三个非空字符串字段的对象，不能是字符串；没有未解决问题时issues为空数组并返回pass。contextSummary仅供检索。严格JSON：${JSON.stringify({verdict: "pass或needs_author", rules: [{level: "topic", statement: "审核后的完整规则", scope: "", conditions: [], costs: [], exceptions: [], objects: []}], summary: "审核结论", contextSummary: "一句话检索摘要", issues: [], suggestions: []})}。`;
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
    '你是这本书的设定策划成员。作者已经确认开书资料，现在只判断后续设定阶段应该准备哪些条目，不写设定内容，不修改开书资料。',
    '请完整理解人物、时代、题材、故事方向、明确禁止项和作者已经确定的边界。不能只靠关键词；否定表达不能反向触发题材。',
    '把目录中的每一个key恰好放进一组：requiredKeys=本书需要设计；coveredKeys=输入资料已明确覆盖且足够，不必重复；excludedKeys=不适用。suggestedKeys只为旧接口保留，必须为空。',
    '逐一判断24个主题，不规定必做数量。不适用不等于暂时没设计；不得为减少数量把必要规则排除。输入已有明确事实可归coveredKeys，不能把你猜测的内容当已有资料。',
    '旧条目归入某主题只代表分类，不代表主题已覆盖。逐条对照已有内容和本书需要，覆盖不足仍放requiredKeys；已覆盖的事实不能重新编造。',
    '不强制力量等级、军队或特殊机制等题材内容；根据整本书目标判断，现实/言情不因通用目录而增加超凡设定。',
    'summary用一至三句大白话说明为什么这样安排，不要出现模型、提示词、资料包、哈希、字段名或专业方法名。',
    input.memberInstruction?.trim() ? `【主编补充要求】${input.memberInstruction.trim()}` : '',
    `【作者确认的开书资料】${JSON.stringify(input.openingProfile)}`,
    `【完整设定目录】${JSON.stringify(catalog)}`,
    '只输出严格JSON：{"requiredKeys":[""],"coveredKeys":[""],"suggestedKeys":[],"excludedKeys":[""],"summary":""}。'
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
  const coveredKeys = value.coveredKeys === undefined ? [] : catalogKeys(value.coveredKeys, '已有资料足够的主题');
  const allowed = new Set(catalog.map((item) => item.key));
  const classified = [...requiredKeys, ...coveredKeys, ...suggestedKeys, ...excludedKeys];
  if (classified.some((key) => !allowed.has(key))) throw new Error('主编返回了目录中不存在的条目');
  if (new Set(classified).size !== classified.length) throw new Error('主编把同一条目放进了多个分组');
  if (classified.length !== allowed.size || classified.some((key) => !allowed.has(key))) {
    throw new Error('主编没有完整整理全部设定条目');
  }
  return {
    requiredKeys,
    coveredKeys,
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
  const rules = parseSettingRules(value.rules);
  const content = rules ? renderSettingRules(rules) : boundedText(value.content, '设定正文', 1, 12_000);
  return {
    ...(rules ? { rules } : {}),
    content,
    designRationale: typeof value.designRationale === 'string' ? value.designRationale.trim() : '',
    contextSummary: typeof value.contextSummary === 'string' && value.contextSummary.trim().length > 0
      ? boundedText(value.contextSummary, '检索摘要', 2, 300)
      : content,
    factEntries: rules ? rules.map(renderSettingRule) : completeFacts(value.factEntries, content),
    storyConsequences: stringArray(value.storyConsequences), dependencies: stringArray(value.dependencies), risks: stringArray(value.risks)
  };
}

export function parseChiefReview(output: string, approvedWriterContent?: string, approvedRules?: readonly SettingRule[]): V7ChiefReview {
  const value = objectFromOutput(output);
  if (approvedRules && value.ruleChanges === undefined) throw new Error('规则卡审查必须返回局部修改列表');
  if (value.ruleChanges !== undefined && (!approvedRules || value.rules !== undefined || value.finalContent !== undefined)) {
    throw new Error('局部审核必须引用原规则，不能同时返回另一份正文');
  }
  const rules = value.ruleChanges !== undefined
    ? applySettingRuleChanges(approvedRules!, value.ruleChanges)
    : parseSettingRules(value.rules);
  if (value.verdict !== 'pass' && value.verdict !== 'needs_author') throw new Error('主编结论必须为pass或needs_author');
  const issues = Array.isArray(value.issues) ? value.issues.map((entry) => {
    const row = asObject(entry);
    return { problem: requiredText(row.problem, '问题'), impact: requiredText(row.impact, '影响'), suggestion: requiredText(row.suggestion, '建议') };
  }).slice(0, 12) : [];
  const finalContent = rules ? renderSettingRules(rules) : typeof value.finalContent === 'string' && value.finalContent.trim().length > 0
    ? value.finalContent
    // 主编已经给出合法结论但偶发漏抄最终正文时，只能沿用其刚审核的
    // 编剧原文，不能让系统自行补写或把空结果交给作者。
    : approvedWriterContent;
  return {
    ...(rules ? { rules } : {}),
    verdict: value.verdict, finalContent: boundedText(finalContent, '最终设定', 1, 12_000),
    summary: boundedText(value.summary, '审核结论', 2, 500),
    contextSummary: typeof value.contextSummary === 'string' && value.contextSummary.trim().length > 0
      ? boundedText(value.contextSummary, '检索摘要', 2, 300)
      : boundedText(value.summary, '检索摘要', 2, 300),
    // Historical/fake adapters may not yet return the projection fields.  In
    // that case preserve the exact reviewed content as one fact instead of
    // inventing a lossy programmatic summary.  The downstream budget compiler
    // can then require a one-time semantic rebuild when that legacy fact is too
    // large.
    factEntries: rules ? rules.map(renderSettingRule) : completeFacts(value.factEntries, boundedText(finalContent, '最终设定', 1, 12_000)),
    issues, suggestions: stringArray(value.suggestions)
  };
}

function completeFacts(value: unknown, fallback: string): string[] {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return [fallback];
  if (!Array.isArray(value) || value.length > 80) throw new Error('设定事实超过传输容量或格式不正确，不能截断后交付');
  const facts = value.map((entry) => boundedText(entry, '设定事实', 1, 12_000));
  if (Array.from(facts.join('\n')).length > 24_000) throw new Error('设定事实超过传输容量，需拆分而不是截断');
  return facts;
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
