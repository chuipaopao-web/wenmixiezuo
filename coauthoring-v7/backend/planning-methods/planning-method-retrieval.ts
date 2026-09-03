/**
 * 第86批：资料策划合同——只做本书事实/设定筛选与任务身份签发。
 * 旧的"方法检索意图"（planningLayers/dimensions/searchQueries/desiredCount）
 * 及其语义子串打分（retrievePlanningMethodCandidates）已退役：
 * 资产由系统按层确定性生成菜单（layer-asset-menu.ts），成员在单次调用内自选，
 * 资料策划不再替设计成员猜方法。解析器对老字段容忍一个版本周期（读取即弃）。
 */
export interface V7PlanningMethodSearchRequest {
  schema: 'v7-planning-method-search-v1';
  publicGoal: string;
  scaleHint: string;
  avoidNotes: string[];
  relevantSettingSourceIds: string[];
  missingCriticalInputs: string[];
  taskPersona?: V7PlanningTaskPersona;
  taskResponsibilities?: string[];
  creativeSpace?: string[];
}

export interface V7PlanningTaskPersona {
  publicLabel: string;
  workingIdentity: string;
  priorities: string[];
  authenticityChecks: string[];
  avoidPatterns: string[];
}

export function parsePlanningMethodSearchRequest(
  output: string,
  options: { minimumSettingSources?: 0 | 1; requireTaskProfile?: boolean } = {}
): V7PlanningMethodSearchRequest {
  const value = parseJsonObject(output);
  if (value.schema !== 'v7-planning-method-search-v1') throw new Error('资料策划请求格式不完整');
  const taskPersona = value.taskPersona === undefined ? undefined : parseTaskPersona(value.taskPersona);
  const taskResponsibilities = value.taskResponsibilities === undefined
    ? undefined
    : uniqueTextList(value.taskResponsibilities, '任务责任', 2, 6);
  const creativeSpace = value.creativeSpace === undefined
    ? undefined
    : uniqueTextList(value.creativeSpace, '创意空间', 1, 5);
  if (options.requireTaskProfile === true
    && (taskPersona === undefined || taskResponsibilities === undefined || creativeSpace === undefined)) {
    throw new Error('资料策划缺少任务期题材身份、任务责任或创意空间');
  }
  return {
    schema: 'v7-planning-method-search-v1',
    publicGoal: requiredText(value.publicGoal, '任务目标'),
    scaleHint: requiredText(value.scaleHint, '篇幅提示'),
    // Avoid notes are soft guidance. Normalize an omitted value, one string,
    // or an over-complete list deterministically instead of paying for a
    // second model call; source selection and missing hard inputs stay strict.
    avoidNotes: softTextList(value.avoidNotes, '避坑说明', 8),
    relevantSettingSourceIds: uniqueTextList(
      value.relevantSettingSourceIds,
      '相关设定资料',
      options.minimumSettingSources ?? 1,
      24
    ),
    missingCriticalInputs: criticalInputList(value.missingCriticalInputs, 0, 8),
    ...(taskPersona === undefined ? {} : { taskPersona }),
    ...(taskResponsibilities === undefined ? {} : { taskResponsibilities }),
    ...(creativeSpace === undefined ? {} : { creativeSpace })
  };
}

export function extractPlanningCriticalInputs(output: string): string[] {
  try {
    const value = parseJsonObject(output);
    return criticalInputList(value.missingCriticalInputs ?? [], 0, 8);
  } catch {
    // A truncated or otherwise malformed envelope must continue to the output
    // contract repair path. It is not evidence that the source package has a
    // semantic gap, and must not silently trigger a different member redo.
    return [];
  }
}

export function planningMethodSearchPrompt(input: {
  seatName: string;
  seatResponsibility: string;
  independentFocus: readonly string[];
  sourceSnapshot: unknown;
}): string {
  return [
    '你正在为一部长篇小说的设计任务做资料策划。只返回一个JSON对象，不要Markdown，不要思维过程。',
    `本次身份：${input.seatName}。责任：${input.seatResponsibility}`,
    `重点检查：${input.independentFocus.join('；')}`,
    '你只决定“本次设计需要哪些本书事实与设定”，并把本书题材融合档案转成只属于当前任务的临时执行身份。不要直接设计故事，也不要猜测或罗列任何方法资产：后台方法、配方和模式由系统按当前层确定性提供给设计成员，成员凭自身方法论知识自选、组合或完全原创，不需要你代为检索。',
    '正式开书资料、作者本次目标、上级确认内容和正文实际必须保留；设定总账只负责导航，不要把总账sourceId填入relevantSettingSourceIds。已确认设定必须从schema="v7-setting-fact-source-v1"的逐项事实源中挑选本席确实需要的资料；relevantSettingSourceIds只能填写这些逐项事实源的sourceId，不得编造。',
    '如果缺少会导致设计无法可靠进行的硬信息，写入missingCriticalInputs。预计总字数是开书阶段唯一必须提前确定的规划尺度，默认按番茄连载场景工作，不要重复报缺。建议卷数、商业受众和追读定位是每席全书路线自己必须产出的结果，不是上游缺口。普通创作留白不是缺口，能在方案中合理创作的内容不要上报；信息齐全时返回空数组。不得自行脑补作者已经明确但本次资料中缺失的硬事实。',
    '输出字段：schema="v7-planning-method-search-v1",publicGoal,scaleHint,avoidNotes,relevantSettingSourceIds,missingCriticalInputs,taskPersona,taskResponsibilities,creativeSpace。missingCriticalInputs每项优先写成一句可直接给作者看的大白话；如需说明影响和待确认内容，也可写成{issue,impact,needed}，系统会合并展示。',
    'taskPersona必须把本书题材融合档案转成只属于当前任务的临时执行身份，字段为publicLabel,workingIdentity,priorities,authenticityChecks,avoidPatterns；不得绑定成员姓名或岗位专业人设。taskResponsibilities写2—6条大白话责任，creativeSpace写1—5条可组合、放弃资产或自主设计的空间。',
    '所有复数字段必须是JSON数组，不能写成单个字符串、编号对象或逗号拼接文本：avoidNotes为0—8条，relevantSettingSourceIds为1—24项，missingCriticalInputs为0—8项，taskResponsibilities为2—6条，creativeSpace为1—5条；taskPersona中的priorities、authenticityChecks、avoidPatterns也都必须是1—8条字符串数组。',
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`
  ].join('\n\n');
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

function uniqueTextList(value: unknown, label: string, min: number, max: number): string[] {
  const values = textList(value, label, min, max);
  const unique = [...new Set(values)];
  if (unique.length < min || unique.length > max) throw new Error(`${label}数量无效`);
  return unique;
}

function softTextList(value: unknown, label: string, max: number): string[] {
  if (value === undefined || value === null) return [];
  const items = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(items)) throw new Error(`${label}格式无效`);
  return [...new Set(items.map((item) => requiredText(item, label)))].slice(0, max);
}

function criticalInputList(value: unknown, min: number, max: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('缺失关键信息数量无效');
  const normalized = value.map((item) => {
    if (typeof item === 'string') return requiredText(item, '缺失关键信息');
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('缺失关键信息格式无效');
    const entry = item as Record<string, unknown>;
    const issue = requiredText(entry.issue, '缺失关键信息');
    const impact = optionalText(entry.impact);
    const needed = optionalText(entry.needed);
    return [issue, impact === null ? null : `影响：${impact}`, needed === null ? null : `需要确认：${needed}`]
      .filter((part): part is string => part !== null)
      .join('；');
  });
  const unique = [...new Set(normalized)];
  if (unique.length < min || unique.length > max) throw new Error('缺失关键信息数量无效');
  return unique;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseTaskPersona(value: unknown): V7PlanningTaskPersona {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('任务期题材身份格式无效');
  const record = value as Record<string, unknown>;
  return {
    publicLabel: requiredText(record.publicLabel, '任务身份名称'),
    workingIdentity: requiredText(record.workingIdentity, '任务执行身份'),
    priorities: uniqueTextList(record.priorities, '任务身份优先级', 1, 6),
    authenticityChecks: uniqueTextList(record.authenticityChecks, '任务身份真实性检查', 1, 6),
    avoidPatterns: uniqueTextList(record.avoidPatterns, '任务身份避坑', 1, 6)
  };
}
