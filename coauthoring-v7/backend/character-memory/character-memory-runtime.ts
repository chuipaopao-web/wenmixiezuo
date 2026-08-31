import type {
  CharacterContextField,
  CharacterContextSelection,
  CharacterMaintenanceOutput,
  CharacterProfileDocument,
  CharacterReviewIssue,
  V7CharacterMemberDefinition
} from './character-memory-contracts.js';

const CONTEXT_FIELDS = new Set<CharacterContextField>([
  'profile', 'state', 'relationships', 'knowledge', 'history', 'open_questions'
]);
const REVIEW_KINDS = new Set(['hard_conflict', 'continuity_risk', 'creative_quality', 'open_question']);
const REVIEW_SEVERITIES = new Set(['blocking', 'important', 'advisory']);

export const V7_CHARACTER_MAINTENANCE_PROMPT_BUDGET_CHARS = 16_000;

export const V7_CHARACTER_MEMBERS: readonly V7CharacterMemberDefinition[] = [
  member('continuity-deepseek-v4-pro', '裴文心', true, true, 1, coding('deepseek-v4-pro')),
  member('continuity-glm-5-3', '宋知遥', true, false, 2, coding('glm-5.3')),
  member('continuity-kimi-k3', '沈墨', true, false, 3, agent('kimi-k3'))
] as const;

export function buildCharacterFallbackChain(
  selectedMemberKey?: string,
  members: readonly V7CharacterMemberDefinition[] = V7_CHARACTER_MEMBERS
): V7CharacterMemberDefinition[] {
  const enabled = members.filter((candidate) => candidate.enabledByDefault)
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
  const selected = selectedMemberKey === undefined
    ? undefined
    : enabled.find((candidate) => candidate.memberKey === selectedMemberKey);
  if (selectedMemberKey !== undefined && selected === undefined) throw new Error('选择的人物资料成员未上岗或不存在');
  const defaultMember = enabled.find((candidate) => candidate.defaultForRole);
  if (defaultMember === undefined) throw new Error('人物资料岗位没有可用的默认成员');
  const seenMembers = new Set<string>();
  const seenModels = new Set<string>();
  return [...(selected === undefined ? [] : [selected]), defaultMember, ...enabled].filter((candidate) => {
    const modelKey = `${candidate.model.provider}:${candidate.model.modelId}:${candidate.model.plan}`;
    if (seenMembers.has(candidate.memberKey) || seenModels.has(modelKey)) return false;
    seenMembers.add(candidate.memberKey);
    seenModels.add(modelKey);
    return true;
  });
}

export function validateCharacterRoster(members: readonly V7CharacterMemberDefinition[] = V7_CHARACTER_MEMBERS): string[] {
  const enabled = members.filter((candidate) => candidate.enabledByDefault);
  const errors: string[] = [];
  if (enabled.length < 3) errors.push('人物资料岗位至少需要三名可交接成员');
  if (enabled.filter((candidate) => candidate.defaultForRole).length !== 1) errors.push('人物资料岗位必须且只能有一名默认成员');
  if (new Set(members.map((candidate) => candidate.memberKey)).size !== members.length) errors.push('人物资料成员键不能重复');
  for (const candidate of members) {
    const kimi = candidate.model.modelId.toLowerCase() === 'kimi-k3';
    if (kimi && (candidate.model.plan !== 'agent' || candidate.model.provider !== 'volcengine-ark-agent-plan')) {
      errors.push(`${candidate.memberKey}：Kimi K3必须使用Agent Plan`);
    }
    if (!kimi && (candidate.model.plan !== 'coding' || candidate.model.provider !== 'volcengine-ark-coding-plan')) {
      errors.push(`${candidate.memberKey}：普通人物资料成员必须使用Coding Plan`);
    }
  }
  return errors;
}

export function parseCharacterProfile(value: unknown): CharacterProfileDocument {
  const root = record(value, '人物档案');
  if (root.schema !== 'v7-character-profile-v1') throw new Error('人物档案格式不完整');
  return {
    schema: 'v7-character-profile-v1',
    displayName: text(root.displayName, '人物姓名', 1, 120),
    aliases: texts(root.aliases, '人物别名', true, 20),
    dramaticFunction: text(root.dramaticFunction, '人物作用', 1, 500),
    coreDesire: text(root.coreDesire, '核心渴望', 1, 500),
    longTermGoal: text(root.longTermGoal, '长期目标', 1, 500),
    fearOrWeakness: text(root.fearOrWeakness, '弱点', 1, 500),
    personalityTraits: texts(root.personalityTraits, '性格特征', false, 8),
    voiceAndBehavior: text(root.voiceAndBehavior, '说话与行为特点', 1, 800),
    visualAnchor: text(root.visualAnchor, '外貌辨识点', 0, 800),
    hardBoundaries: texts(root.hardBoundaries, '人物硬边界', true, 20),
    openQuestions: texts(root.openQuestions, '人物待定项', true, 20),
    publicSummary: text(root.publicSummary, '人物摘要', 1, 500)
  };
}

export function parseCharacterContextSelection(
  output: string,
  allowedEntityIds: readonly string[]
): CharacterContextSelection {
  const root = jsonObject(output, '人物资料选择');
  if (root.schema !== 'v7-character-context-selection-v1') throw new Error('人物资料选择格式不完整');
  if (!Array.isArray(root.selected)) throw new Error('人物资料选择缺少成员清单');
  const allowed = new Set(allowedEntityIds);
  const seen = new Set<string>();
  const selected = root.selected.map((value) => {
    const item = record(value, '人物选择项');
    const entityId = text(item.entityId, '人物编号', 1, 160);
    if (!allowed.has(entityId)) throw new Error('人物资料成员选择了候选范围外的人物');
    if (seen.has(entityId)) throw new Error('人物资料成员重复选择了同一人物');
    seen.add(entityId);
    if (!Array.isArray(item.fields) || item.fields.length === 0) throw new Error('人物选择项必须说明需要哪些资料');
    const fields = item.fields.map((field) => {
      if (typeof field !== 'string' || !CONTEXT_FIELDS.has(field as CharacterContextField)) throw new Error('人物资料字段无效');
      return field as CharacterContextField;
    });
    return { entityId, fields: [...new Set(fields)], reason: text(item.reason, '选择理由', 1, 500) };
  });
  return {
    schema: 'v7-character-context-selection-v1', selected,
    excludedSummary: text(root.excludedSummary, '未选人物说明', 0, 1_000),
    openQuestions: texts(root.openQuestions, '资料疑问', true, 20)
  };
}

export function parseCharacterMaintenanceOutput(
  output: string,
  allowedEntityIds: readonly string[],
  allowedEvidenceRefs: readonly string[]
): CharacterMaintenanceOutput {
  const root = jsonObject(output, '人物维护结果');
  if (root.schema !== 'v7-character-maintenance-v1') throw new Error('人物维护结果格式不完整');
  const entities = new Set(allowedEntityIds);
  const evidence = new Set(allowedEvidenceRefs);
  const affectedEntityIds = uniqueTexts(root.affectedEntityIds, '受影响人物', false, 100);
  affectedEntityIds.forEach((entityId) => requireAllowed(entityId, entities, '人物维护结果引用了本书不存在的人物'));
  const changes: CharacterMaintenanceOutput['changes'] = array(root.changes, '人物变化').map((value) => {
    const item = record(value, '人物变化');
    const rawKind = item.kind ?? item.changeType;
    const kind = rawKind === 'profile_update' || rawKind === 'canon_gap' ? rawKind : null;
    if (kind === null) throw new Error('人物变化类型无效');
    const entityId = text(item.entityId, '人物编号', 1, 160);
    requireAllowed(entityId, entities, '人物变化引用了本书不存在的人物');
    const evidenceRefs = uniqueTexts(item.evidenceRefs, '人物变化证据', false, 30);
    evidenceRefs.forEach((ref) => requireAllowed(ref, evidence, '人物变化引用了未提供的证据'));
    const publicSummary = text(item.publicSummary ?? item.summary, '变化摘要', 1, 500);
    return {
      kind, entityId, fieldPath: text(item.fieldPath ?? item.field, '变化字段', 1, 200),
      proposedValue: item.proposedValue ?? item.value ?? publicSummary,
      publicSummary,
      reason: text(item.reason ?? publicSummary, '变化理由', 1, 1_000), evidenceRefs
    };
  });
  const issues = array(root.issues, '人物审查问题').map((value) => parseIssue(value, entities, evidence));
  return {
    schema: 'v7-character-maintenance-v1',
    publicSummary: text(root.publicSummary, '维护摘要', 1, 1_000), affectedEntityIds, changes, issues
  };
}

export function characterContextSelectionPrompt(input: {
  taskKind: string;
  taskBrief: string;
  candidates: unknown;
  maxTokens: number;
}): string {
  return [
    '你是文秘写作的人物资料员。只返回一个JSON对象，不要Markdown，不要思维过程。',
    '你的工作是从系统已经召回的候选人物中，选择当前任务真正需要的人物和资料种类。不得选择候选集之外的人物。',
    '宁可少而准确，不要把整本书人物库都塞入上下文。只保留会影响当前人物选择、因果、关系、知情边界或连续性的资料。',
    'profile是稳定人物档案；state是已发生的当前状态；relationships是已发生关系；knowledge是角色知道/不知道/误解的边界；history只在必须追溯变化时选择；open_questions是尚未落定事项。',
    '计划、候选和开放问题不得当成正文实际。',
    '输出字段：schema="v7-character-context-selection-v1",selected,excludedSummary,openQuestions。selected每项含entityId,fields,reason。',
    `任务类型：${input.taskKind}`,
    `当前任务：${input.taskBrief}`,
    `目标资料预算：不超过约${input.maxTokens} Token`,
    `候选人物：${JSON.stringify(input.candidates)}`
  ].join('\n\n');
}

export function characterMaintenancePrompt(input: {
  settlement: unknown;
  characters: unknown;
  evidenceRefs: readonly string[];
  maxInputCharacters?: number;
}): string {
  const maxInputCharacters = input.maxInputCharacters ?? V7_CHARACTER_MAINTENANCE_PROMPT_BUDGET_CHARS;
  if (!Number.isInteger(maxInputCharacters) || maxInputCharacters < 4_000) {
    throw new Error('人物维护输入预算必须是不少于4000字的整数');
  }
  const sources = maintenanceSourceCandidates(input.settlement, input.characters);
  const characterIndex = characterIdentityIndex(input.characters);
  const render = (includedSources: readonly MaintenanceSourceCandidate[]): string => {
    const omitted = sources.slice(includedSources.length);
    const omittedByScope = omitted.reduce<Record<string, number>>((counts, source) => {
      counts[source.scope] = (counts[source.scope] ?? 0) + 1;
      return counts;
    }, {});
    const omittedBySourceKind = omitted.reduce<Record<string, number>>((counts, source) => {
      counts[source.sourceKind] = (counts[source.sourceKind] ?? 0) + 1;
      return counts;
    }, {});
    const payload = {
      schema: 'v7-character-maintenance-input-v2',
      characterIndex,
      includedSources,
      omittedSummary: { total: omitted.length, byScope: omittedByScope, bySourceKind: omittedBySourceKind },
      evidenceRefs: input.evidenceRefs
    };
    return [
    '你是文秘写作的人物资料维护员。只返回一个JSON对象，不要Markdown，不要思维过程。',
    '正式结算已经完成，系统会自行保存版本与投影。你负责理解这次实际发生的内容对人物意味着什么，并指出档案建议、正史缺口和连续性问题。',
    '不得把未来规划、角色愿望、谎言、梦境、猜测或作者未确认内容写成客观实际；不得从一时动作或短暂情绪推断永久性格。',
    'profile_update只建议更新稳定人物档案，canon_gap只指出正式结算可能漏记的持久事实；两者都是候选，不能直接改正史。',
    '问题分四类：hard_conflict（与硬事实直接矛盾）、continuity_risk（可能断裂）、creative_quality（人物单薄或选择不够有力）、open_question（资料不足）。',
    'input中的includedSources是系统按正式来源类别和硬预算逐项装入的候选资料，不代表语义结论；你仍要自行判断哪些与本次变化有关。',
    'omittedSummary.total大于0表示还有资料因输入上限未装入。不得猜测被省略内容；证据不足时不提变化，或用open_question明确指出需要回查。',
    '每条变化和问题必须引用给定evidenceRefs；没有证据就不要输出。只引用characterIndex里的entityId。',
    '输出字段：schema="v7-character-maintenance-v1",publicSummary,affectedEntityIds,changes,issues。changes每项字段必须是kind（只用profile_update/canon_gap）、entityId、fieldPath、proposedValue、publicSummary、reason、evidenceRefs；issues每项字段必须是kind、severity、entityId、publicSummary、evidenceRefs、suggestedAction。不得改成changeType、field、summary或category。',
      `人物维护输入：${JSON.stringify(payload)}`
    ].join('\n\n');
  };
  const included: MaintenanceSourceCandidate[] = [];
  let prompt = render(included);
  if (prompt.length > maxInputCharacters) {
    throw new Error('人物维护的任务身份和证据目录已经超过输入预算，请缩小本次人物候选范围');
  }
  for (const source of sources) {
    const candidate = render([...included, source]);
    if (candidate.length > maxInputCharacters) break;
    included.push(source);
    prompt = candidate;
  }
  if (prompt.length > maxInputCharacters) throw new Error('人物维护输入超过硬上限');
  return prompt;
}

interface MaintenanceSourceCandidate {
  scope: 'settlement' | 'character';
  sourceKind: string;
  path: string;
  entityId?: string;
  value: unknown;
}

function maintenanceSourceCandidates(settlement: unknown, characters: unknown): MaintenanceSourceCandidate[] {
  const settlementRecord = isRecord(settlement) ? settlement : { value: settlement };
  const characterRecords = Array.isArray(characters) ? characters.filter(isRecord) : [];
  const sources: MaintenanceSourceCandidate[] = [];
  const addSettlement = (keys: readonly string[]): void => {
    for (const key of keys) addValueCandidates(sources, 'settlement', key, `/${key}`, settlementRecord[key]);
  };
  const addCharacter = (sourceKind: string): void => {
    for (const character of characterRecords) {
      const entityId = typeof character.entityId === 'string' ? character.entityId : undefined;
      addValueCandidates(sources, 'character', sourceKind, `/${sourceKind}`, character[sourceKind], entityId);
    }
  };

  addCharacter('displayName');
  addSettlement(['entityStates', 'relationshipChanges', 'knowledgeChanges']);
  addCharacter('state');
  addSettlement(['irreversibleResults', 'closedThreads', 'openThreads', 'exclusions']);
  addCharacter('relationships');
  addCharacter('knowledge');
  addCharacter('profile');
  addCharacter('openQuestions');
  addCharacter('history');
  addSettlement(Object.keys(settlementRecord).filter((key) => ![
    'entityStates', 'relationshipChanges', 'knowledgeChanges', 'irreversibleResults',
    'closedThreads', 'openThreads', 'exclusions'
  ].includes(key)).toSorted());
  return sources;
}

function characterIdentityIndex(characters: unknown): Array<{ entityId: string }> {
  if (!Array.isArray(characters)) return [];
  return characters.filter(isRecord).flatMap((character) =>
    typeof character.entityId === 'string' ? [{ entityId: character.entityId }] : []
  );
}

function addValueCandidates(
  target: MaintenanceSourceCandidate[],
  scope: MaintenanceSourceCandidate['scope'],
  sourceKind: string,
  path: string,
  value: unknown,
  entityId?: string
): void {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => target.push({
      scope, sourceKind, path: `${path}/${index}`, value: item,
      ...(entityId === undefined ? {} : { entityId })
    }));
    return;
  }
  if (isRecord(value) && (sourceKind === 'profile' || sourceKind === 'state')) {
    Object.keys(value).toSorted().forEach((key) => {
      target.push({
        scope, sourceKind, path: `${path}/${key}`, value: value[key],
        ...(entityId === undefined ? {} : { entityId })
      });
    });
    return;
  }
  target.push({ scope, sourceKind, path, value, ...(entityId === undefined ? {} : { entityId }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIssue(value: unknown, entities: Set<string>, evidence: Set<string>): CharacterReviewIssue {
  const item = record(value, '人物审查问题');
  const rawKind = item.kind ?? item.category;
  if (typeof rawKind !== 'string' || !REVIEW_KINDS.has(rawKind)) throw new Error('人物审查问题类型无效');
  const defaultSeverity = rawKind === 'hard_conflict' ? 'blocking' : rawKind === 'continuity_risk' ? 'important' : 'advisory';
  const rawSeverity = item.severity ?? defaultSeverity;
  const severity = normalizeReviewSeverity(rawSeverity);
  if (severity === null) throw new Error('人物审查严重程度无效');
  const entityId = text(item.entityId, '人物编号', 1, 160);
  requireAllowed(entityId, entities, '人物审查引用了本书不存在的人物');
  const evidenceRefs = uniqueTexts(item.evidenceRefs, '人物问题证据', false, 30);
  evidenceRefs.forEach((ref) => requireAllowed(ref, evidence, '人物问题引用了未提供的证据'));
  const publicSummary = text(item.publicSummary ?? item.summary, '问题说明', 1, 800);
  return {
    kind: rawKind as CharacterReviewIssue['kind'], severity,
    entityId, publicSummary, evidenceRefs,
    suggestedAction: text(item.suggestedAction ?? item.action ?? publicSummary, '处理建议', 1, 800)
  };
}

function normalizeReviewSeverity(value: unknown): CharacterReviewIssue['severity'] | null {
  if (typeof value !== 'string') return null;
  if (REVIEW_SEVERITIES.has(value)) return value as CharacterReviewIssue['severity'];
  if (value === 'critical' || value === 'high' || value === 'major') return 'blocking';
  if (value === 'medium' || value === 'moderate') return 'important';
  if (value === 'low' || value === 'minor' || value === 'info') return 'advisory';
  return null;
}

function member(
  memberKey: string,
  displayName: string,
  enabledByDefault: boolean,
  defaultForRole: boolean,
  fallbackPriority: number,
  modelBinding: V7CharacterMemberDefinition['model']
): V7CharacterMemberDefinition {
  return {
    memberKey, displayName, roleKey: 'character_curator', enabledByDefault,
    defaultForRole, fallbackPriority, model: modelBinding, promptInstruction: ''
  };
}

function coding(modelId: string): V7CharacterMemberDefinition['model'] {
  return { provider: 'volcengine-ark-coding-plan', modelId, plan: 'coding' };
}

function agent(modelId: string): V7CharacterMemberDefinition['model'] {
  return { provider: 'volcengine-ark-agent-plan', modelId, plan: 'agent' };
}

function jsonObject(output: string, label: string): Record<string, unknown> {
  const normalized = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = normalized.indexOf('{');
  const last = normalized.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error(`${label}不是JSON对象`);
  return record(JSON.parse(normalized.slice(first, last + 1)) as unknown, label);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`);
  return value;
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是文字`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < min || length > max) throw new Error(`${label}长度必须为${min}至${max}`);
  return normalized;
}

function texts(value: unknown, label: string, allowEmpty: boolean, maxItems: number): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maxItems) {
    throw new Error(`${label}数量无效`);
  }
  return value.map((item) => text(item, label, 1, 500));
}

function uniqueTexts(value: unknown, label: string, allowEmpty: boolean, maxItems: number): string[] {
  const result = texts(value, label, allowEmpty, maxItems);
  if (new Set(result).size !== result.length) throw new Error(`${label}不能重复`);
  return result;
}

function requireAllowed(value: string, allowed: Set<string>, message: string): void {
  if (!allowed.has(value)) throw new Error(message);
}
