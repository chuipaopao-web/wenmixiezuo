/** Canonical setting facts. Display text and context excerpts are derived, never rewritten. */
export interface SettingRule {
  level: 'global' | 'topic' | 'object';
  statement: string;
  scope: string;
  conditions: string[];
  costs: string[];
  exceptions: string[];
  objects: string[];
}

export const SETTING_RULE_OUTPUT_INSTRUCTION = [
  '用rules交付规则，每条包含level和statement。statement就是作者阅读和后续任务使用的完整事实：把必要的适用范围、条件、代价、例外及对象名称自然融入正文。兼容字段scope填空字符串，conditions、costs、exceptions、objects填空数组；不能把事实留在这些字段里，再让正文只剩概括。',
  'level默认topic。global只用于每一次创作任务都必须知道的世界前提或作者全书禁项，例如无超自然能力；某地交通、官驿手续、货币或某种能力的限制都属于topic，不能因规则已确定就标global。object仅用于已经指明的具体人物、地点或物品，不为每个角色额外抄一份主题规则。',
  '保持资料原本的范围和强度：“主要靠”不能改成“只能”，“会延迟”不能改成“一定丢失”。未给出的禁令、权限、费用、处罚、精确数字不能假定已经成立；只有当前任务确实要求设计的空缺才提出必要的新规则。不要顺手增加驿卒禁止私信、所有民间传信手段被禁等无依据限制。',
  '先确定这条真正需要说明的差异，再用最少的自然短句讲完整。只保留影响人物能否行动、付出什么或发生什么结果的信息；常识不展开教学。删重复解释，不删条件、否定、例外、范围、数量和后果。不定统一字数、不凑条数；复杂机制可以拆成多条完整规则。',
  '例如已有“普通伤病可用常规丹药或灵气疗养；经脉、丹田受损需高阶丹药或特殊灵物修复，否则修为会倒退”，就不要再补“条件：伤在经脉或丹田；代价：高阶丹药；例外：皮肉伤用普通丹药”。也不能压成“受伤吃药”，丢掉核心损伤的区别。示例只示范表达，不是本书设定。',
  '交付前自行核对：正文单独读是否完整；旧字段中的独有事实是否已融入；重复表达是否只留一次；有没有将可能写成必然、主要写成只能。只提交整理后的结果，不提交思考过程。',
  '不输出推理过程。系统从rules生成展示正文和注入事实，content和factEntries不另写另一套。contextSummary仅供检索，不是事实依据。'
].join('\n');

export function parseSettingRules(value: unknown): SettingRule[] | undefined {
  // Old persisted tasks can finish with their original contract.
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) {
    throw new Error('规则列表必须完整且包含1至80条；复杂主题请拆分，不得截断规则。');
  }
  const rules = value.map((entry): SettingRule => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('规则结构不完整');
    const row = entry as Record<string, unknown>;
    if (row.level !== 'global' && row.level !== 'topic' && row.level !== 'object') throw new Error('规则层级不正确');
    return {
      level: row.level,
      statement: ruleText(row.statement, false),
      scope: ruleText(row.scope, true),
      conditions: ruleList(row.conditions), costs: ruleList(row.costs),
      exceptions: ruleList(row.exceptions), objects: ruleList(row.objects)
    };
  });
  if (Array.from(renderSettingRules(rules)).length > 12_000) throw new Error('完整规则超过单主题传输容量，请拆分独立机制，不得截断。');
  return rules;
}

export function renderSettingRule(rule: SettingRule): string {
  return [rule.statement, rule.scope ? `适用：${rule.scope}` : '',
    rule.conditions.length ? `条件：${rule.conditions.join('；')}` : '',
    rule.costs.length ? `代价：${rule.costs.join('；')}` : '',
    rule.exceptions.length ? `限制与例外：${rule.exceptions.join('；')}` : '',
    rule.objects.length ? `涉及：${rule.objects.join('、')}` : ''].filter(Boolean).join('\n');
}

export function renderSettingRules(rules: readonly SettingRule[]): string {
  return rules.map(renderSettingRule).join('\n\n');
}

/** Indices refer to the frozen proposal, never to a partially modified list. */
export function applySettingRuleChanges(source: readonly SettingRule[], value: unknown): SettingRule[] {
  if (!Array.isArray(value) || value.length > 80) throw new Error('审核修改必须是完整列表');
  const changes = new Map<number, SettingRule | null>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('审核修改结构不完整');
    const change = entry as Record<string, unknown>;
    const index = change.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= source.length || changes.has(index)) {
      throw new Error('审核修改引用了不存在或重复的规则');
    }
    ruleText(change.reason, false);
    if (change.action === 'remove') changes.set(index, null);
    else if (change.action === 'replace') changes.set(index, parseSettingRules([change.rule])![0]!);
    else throw new Error('审核修改只允许replace或remove');
  }
  const result = source.flatMap((rule, index) => {
    const change = changes.get(index);
    return change === null ? [] : [change ?? rule];
  });
  return parseSettingRules(result)!;
}

function ruleText(value: unknown, allowEmpty: boolean): string {
  if (value === undefined && allowEmpty) return '';
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || Array.from(value).length > 4_000) {
    throw new Error('规则文字缺失或超过字段容量，请保留完整条件并拆分独立规则。');
  }
  return value.trim();
}

function ruleList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 80) throw new Error('规则条件必须是完整列表');
  return value.map((entry) => ruleText(entry, false));
}
