export const reviewerRoles = ['fact', 'literary', 'experience'] as const;
export type ReviewerRole = typeof reviewerRoles[number];
export type ReviewVerdict = 'pass' | 'rewrite' | 'blocked';

export interface ProductionReviewIssue {
  location: string;
  issueType: string;
  severity: 'blocker' | 'major' | 'minor' | 'observation';
  evidence: string;
  requiredAction: string;
}

export interface ProductionReview {
  reviewerRole: ReviewerRole;
  manuscriptVersionId: string;
  modelSnapshotId: string;
  verdict: ReviewVerdict;
  summary: string;
  issues: ProductionReviewIssue[];
  scores: Record<string, number>;
  aiStyle?: {
    riskScore: number;
    flaggedParagraphCount: number;
    totalParagraphCount: number;
    flaggedParagraphRatio: number;
    isAuthorshipProbability: false;
    evidence: string[];
  };
  politicalRisk?: ContentRisk;
  sexualContentRisk?: ContentRisk;
  factCandidates?: FactCandidate[];
}

export const factEntityTypes = ['character', 'location', 'organization', 'item', 'resource', 'skill', 'stat_panel', 'world_rule', 'event', 'foreshadowing', 'hook'] as const;
export const factEpistemicStatuses = ['objective', 'claim', 'belief', 'lie', 'dream', 'plan', 'counterfactual', 'ambiguous', 'conflicted'] as const;
export interface FactCandidate {
  subjectName: string;
  entityType: typeof factEntityTypes[number];
  relationKey: string;
  value: unknown;
  evidenceQuote: string;
  evidenceLocation: string;
  epistemicStatus: typeof factEpistemicStatuses[number];
  negated: boolean;
  viewpointName: string | null;
  knowledgeSubjectName: string | null;
  knowledgeTimeStart: string | null;
  knowledgeTimeEnd: string | null;
  storyTimeStart: string | null;
  storyTimeEnd: string | null;
}

export interface ContentRisk {
  level: 'none' | 'low' | 'medium' | 'high' | 'blocked';
  locations: string[];
  evidence: string[];
  recommendedAction: string;
  policyVersion: string;
}

export interface EditorReviewSynthesis {
  panelId: string;
  manuscriptVersionId: string;
  recommendedVerdict: ReviewVerdict;
  priorityIssueIndexes: number[];
  preservedDisagreements: string[];
  rationale: string;
}

export function parseEditorReviewSynthesis(raw: string, expected: {
  panelId: string; manuscriptVersionId: string; issueCount: number;
}, options: { normalizeRepairedShape?: boolean; normalizeMalformedJsonStrings?: boolean } = {}): EditorReviewSynthesis {
  const value = parseJsonObject(raw, options.normalizeMalformedJsonStrings === true);
  if (options.normalizeRepairedShape !== true
    && (value.panelId !== expected.panelId || value.manuscriptVersionId !== expected.manuscriptVersionId)) {
    throw new Error('主编综合结果与冻结点评轮次不一致');
  }
  if (!['pass', 'rewrite', 'blocked'].includes(String(value.recommendedVerdict))) throw new Error('主编综合recommendedVerdict无效');
  const priorityIssueIndexes = options.normalizeRepairedShape === true
    ? normalizePriorityIssueIndexes(value.priorityIssueIndexes, expected.issueCount)
    : value.priorityIssueIndexes;
  if (!Array.isArray(priorityIssueIndexes)
    || priorityIssueIndexes.some((index) => !Number.isInteger(index) || Number(index) < 0 || Number(index) >= expected.issueCount)
    || new Set(priorityIssueIndexes).size !== priorityIssueIndexes.length) {
    throw new Error('主编综合priorityIssueIndexes无效');
  }
  const rationale = requiredText(value.rationale, '主编综合rationale');
  return {
    panelId: expected.panelId,
    manuscriptVersionId: expected.manuscriptVersionId,
    recommendedVerdict: value.recommendedVerdict as ReviewVerdict,
    priorityIssueIndexes: priorityIssueIndexes as number[],
    preservedDisagreements: options.normalizeRepairedShape === true
      ? normalizePreservedDisagreements(value.preservedDisagreements)
      : stringArray(value.preservedDisagreements, '主编综合preservedDisagreements'),
    rationale
  };
}

function normalizePriorityIssueIndexes(value: unknown, issueCount: number): unknown {
  if (!Array.isArray(value)) return value;
  return [...new Set(value.filter((index): index is number => Number.isInteger(index)
    && Number(index) >= 0 && Number(index) < issueCount))];
}

function normalizePreservedDisagreements(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item.trim();
      if (isRecord(item) && Object.keys(item).length > 0) return JSON.stringify(item);
      throw new Error('主编综合preservedDisagreements修复结果只能包含文本或可追溯对象');
    }).filter(Boolean);
  }
  if (!isRecord(value)) throw new Error('主编综合preservedDisagreements必须是数组或可追溯对象');
  const disagreements = Object.entries(value).map(([key, detail]) => {
    if (typeof detail !== 'string' || detail.trim().length === 0) {
      throw new Error('主编综合preservedDisagreements对象值必须是非空文本');
    }
    return `${key}: ${detail.trim()}`;
  });
  if (disagreements.length === 0) throw new Error('主编综合preservedDisagreements对象不能为空');
  return disagreements;
}

export function parseProductionReview(
  raw: string,
  expected: { reviewerRole: ReviewerRole; manuscriptVersionId: string; modelSnapshotId: string },
  options: {
    allowDroppingInvalidFactCandidates?: boolean;
    normalizeLocalBlockers?: boolean;
    normalizeAiStyleEvidence?: boolean;
    normalizeRepairedVerdict?: boolean;
    normalizeMalformedJsonStrings?: boolean;
    normalizeRiskArrays?: boolean;
    normalizeScoreArray?: boolean;
    normalizeIssueLocations?: boolean;
    normalizeIssueLimit?: boolean;
    normalizeRepairedSeverity?: boolean;
    normalizeIssueFieldAliases?: boolean;
    normalizeFrozenBindings?: boolean;
    normalizeProvisionalDraftBlockers?: boolean;
    normalizeFactOmissionMajor?: boolean;
  } = {}
): ProductionReview {
  const value = parseJsonObject(raw, options.normalizeMalformedJsonStrings === true);
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue && options.normalizeFrozenBindings !== true) {
      throw new Error(`点评结果${field}与冻结任务不一致`);
    }
  }
  let verdict = normalizeVerdict(value.verdict, options.normalizeRepairedVerdict === true);
  if (typeof value.summary !== 'string' || value.summary.trim().length === 0) throw new Error('点评结果summary缺失');
  if (!Array.isArray(value.issues)) throw new Error('点评结果issues必须是数组');
  if (value.issues.length > 8 && options.normalizeIssueLimit !== true) {
    throw new Error('单席点评问题超过8条上限，只保留影响最大的可执行问题');
  }
  const parsedIssues = value.issues.map((issue) => parseIssue(
    issue,
    options.normalizeLocalBlockers === true,
    options.normalizeIssueLocations === true,
    options.normalizeRepairedSeverity === true,
    options.normalizeIssueFieldAliases === true
  ));
  const limitedIssues = options.normalizeIssueLimit === true
    ? prioritizeReviewIssues(parsedIssues).slice(0, 8)
    : parsedIssues;
  const provisionalIssues = limitedIssues.map((issue) => expected.reviewerRole === 'fact'
    && options.normalizeProvisionalDraftBlockers === true
    && isProvisionalDraftConflict(issue)
    ? { ...issue, severity: 'major' as const }
    : issue);
  let promotedObjectiveContradiction = false;
  const objectiveCheckedIssues = provisionalIssues.map((issue) => {
    if (expected.reviewerRole !== 'fact' || !isExplicitObjectiveContradiction(issue)) return issue;
    promotedObjectiveContradiction = true;
    return { ...issue, severity: 'major' as const };
  });
  const unsupportedFactOmissionMajor = expected.reviewerRole === 'fact'
    ? objectiveCheckedIssues.find(isUnsupportedFactOmissionMajor)
    : undefined;
  if (unsupportedFactOmissionMajor !== undefined && options.normalizeFactOmissionMajor !== true) {
    throw new Error('事实席不能把未重复前文细节判为major；只有正文矛盾、因果断裂或章纲硬要求缺失才可阻断');
  }
  const issues = objectiveCheckedIssues.map((issue) => expected.reviewerRole === 'fact'
    && options.normalizeFactOmissionMajor === true
    && (isUnsupportedFactOmissionMajor(issue) || isSelfAcknowledgedCompatibleFactMajor(issue))
    ? { ...issue, severity: 'minor' as const }
    : issue);
  if (promotedObjectiveContradiction && verdict === 'pass') verdict = 'rewrite';
  if (options.normalizeRepairedVerdict === true
    && verdict === 'rewrite'
    && issues.every((issue) => issue.severity === 'minor' || issue.severity === 'observation')) {
    verdict = 'pass';
  }
  if (verdict === 'pass' && issues.some((issue) => issue.severity === 'major' || issue.severity === 'blocker')) {
    if (options.normalizeRepairedVerdict === true) verdict = 'rewrite';
    else throw new Error('pass结论不能包含major或blocker问题');
  }
  if (expected.reviewerRole !== 'experience' && verdict === 'blocked'
    && !issues.some((issue) => issue.severity === 'blocker')) {
    if (options.normalizeLocalBlockers === true) verdict = 'rewrite';
    else throw new Error('blocked结论必须至少包含一个不能自动定点修复的blocker问题');
  }
  const normalizedScores = options.normalizeScoreArray === true
    ? normalizeScores(value.scores)
    : value.scores;
  if (!isRecord(normalizedScores)) throw new Error('点评结果scores必须是对象');
  const scores: Record<string, number> = {};
  for (const [key, score] of Object.entries(normalizedScores)) {
    if (!Number.isFinite(score) || Number(score) < 0 || Number(score) > 100) throw new Error(`点评评分${key}无效`);
    scores[key] = Number(score);
  }
  if (Object.keys(scores).length === 0) throw new Error('点评结果scores不能为空');
  const base: ProductionReview = {
    ...expected,
    verdict,
    summary: value.summary.trim(),
    issues,
    scores
  };
  if (expected.reviewerRole === 'fact') {
    base.factCandidates = parseFactCandidates(value.factCandidates, options.allowDroppingInvalidFactCandidates === true);
  }
  if (expected.reviewerRole === 'literary') base.aiStyle = parseAiStyle(
    value.aiStyle, options.normalizeAiStyleEvidence === true
  );
  if (expected.reviewerRole === 'experience') {
    base.politicalRisk = parseRisk(value.politicalRisk, 'politicalRisk', options.normalizeRiskArrays === true);
    base.sexualContentRisk = parseRisk(value.sexualContentRisk, 'sexualContentRisk', options.normalizeRiskArrays === true);
  }
  return base;
}

function prioritizeReviewIssues(issues: ProductionReviewIssue[]): ProductionReviewIssue[] {
  const priority: Record<ProductionReviewIssue['severity'], number> = {
    blocker: 0,
    major: 1,
    minor: 2,
    observation: 3
  };
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => priority[left.issue.severity] - priority[right.issue.severity] || left.index - right.index)
    .map(({ issue }) => issue);
}

function isExplicitObjectiveContradiction(issue: ProductionReviewIssue): boolean {
  if (issue.severity !== 'minor' && issue.severity !== 'observation') return false;
  const finding = `${issue.location}\n${issue.issueType}\n${issue.evidence}`;
  const comparesCurrentWithAuthority = /(?:本章|当前正文|current_manuscript)/iu.test(finding)
    && /(?:前章|上一章|已定稿|定稿|正史|已确认)/u.test(finding);
  const statesConflict = /(?:矛盾|冲突|漂移|不一致|混淆|错置|误作|误认)/u.test(finding);
  const objectiveDimension = /(?:编号|账号|日期|时间|颜色|材质|数量|尺寸|长度|宽度|高度|位置|地点|身份|生死|存活|死亡|已经完成|已完成|已发生)/u.test(finding);
  const hasRepair = /(?:修正|修订|改为|统一|更正|替换|区分|恢复)/u.test(issue.requiredAction);
  return comparesCurrentWithAuthority && statesConflict && objectiveDimension && hasRepair;
}

function isUnsupportedFactOmissionMajor(issue: ProductionReviewIssue): boolean {
  if (issue.severity !== 'major') return false;
  const finding = `${issue.issueType}\n${issue.evidence}`;
  const isRepetitionOmission = /(?:遗漏|未提及|未重述|没有再次|完全未提|缺少复述)/u.test(finding);
  const isLocalAddition = /(?:插入|补入|补充|增加|添加).{0,12}(?:一|1|两|2)(?:句|处|个细节)|(?:插入|补入|补充|增加|添加)(?:一句|一处)/u.test(issue.requiredAction);
  const provesContradiction = /(?:直接|明确|相互|前后).{0,8}(?:矛盾|冲突|互斥)|(?:矛盾|冲突|互斥).{0,8}(?:直接|明确|相互|前后)/u.test(finding);
  const missesMandatoryBeat = /(?:章纲|写作工单|硬约束|required(?:Beat|Ending|Action)|必须出现|强制信息)/iu.test(finding);
  return isRepetitionOmission && isLocalAddition && !provesContradiction && !missesMandatoryBeat;
}

function isSelfAcknowledgedCompatibleFactMajor(issue: ProductionReviewIssue): boolean {
  if (issue.severity !== 'major') return false;
  const finding = `${issue.issueType}\n${issue.evidence}\n${issue.requiredAction}`;
  const acknowledgesCompatibility = /(?:两句本身可自洽|本身可自洽|可以自洽|可自洽|不构成硬冲突|属合理|合理的策略调整)/u.test(finding);
  const asksForLocalClarity = /(?:补一句|最小过渡|桥接|确认措辞|可保留|策略调整|读者可能误读)/u.test(finding);
  const provesObjectiveConflict = /(?:已确认|正史|定稿).{0,24}(?:明确矛盾|互斥|无法同时成立)|(?:明确矛盾|互斥|无法同时成立).{0,24}(?:已确认|正史|定稿)/u.test(finding);
  return acknowledgesCompatibility && asksForLocalClarity && !provesObjectiveConflict;
}

function isProvisionalDraftConflict(issue: ProductionReviewIssue): boolean {
  if (issue.severity !== 'blocker') return false;
  const evidence = `${issue.location}\n${issue.issueType}\n${issue.evidence}`;
  const action = issue.requiredAction;
  const comparesDraftWithAuthority = /(?:本章|当前正文|current_manuscript)/u.test(evidence)
    && /(?:前章|定稿|正史|章纲|已确认|已固定)/u.test(evidence);
  const canRepairCurrentDraft = /(?:修正|修订|改写|恢复|统一|删除|替换|补充).{0,20}(?:本章|当前正文|描写|钩子|位数|时间线)|(?:本章|当前正文).{0,20}(?:修正|修订|改写|恢复|统一|删除|替换|补充)/u.test(action);
  return comparesDraftWithAuthority && canRepairCurrentDraft;
}

/**
 * A repaired report occasionally returns the requested score map as an array of
 * { dimension, score, reason } objects. On the one-shot repair path only, retain
 * the model's dimension and numeric score verbatim. The complete raw response
 * remains in model_call_results. Duplicate dimensions are rejected because
 * choosing one would invent precedence.
 */
function normalizeScores(value: unknown): unknown {
  if (isRecord(value)) {
    // The repair path may preserve useful reviewer metadata (for example an
    // issue-severity distribution) beside the actual 0-100 scores. `scores`
    // is deliberately a numeric map; keep every valid numeric dimension and
    // drop non-numeric metadata instead of rejecting an otherwise complete,
    // auditable review. The immutable raw result stays in model_call_results.
    return Object.fromEntries(Object.entries(value)
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1])
        && Number(entry[1]) >= 0 && Number(entry[1]) <= 100)
      .map(([key, score]) => [key, Number(score)]));
  }
  if (!Array.isArray(value)) return value;
  const scores: Record<string, number> = {};
  for (const item of value) {
    if (!isRecord(item)) throw new Error('点评结果scores数组项必须是对象');
    const dimension = requiredText(item.dimension, '点评结果scores.dimension');
    if (Object.hasOwn(scores, dimension)) throw new Error(`点评结果scores维度${dimension}重复`);
    if (!Number.isFinite(item.score) || Number(item.score) < 0 || Number(item.score) > 100) {
      throw new Error(`点评评分${dimension}无效`);
    }
    scores[dimension] = Number(item.score);
  }
  return scores;
}

function parseFactCandidates(value: unknown, allowDroppingInvalid: boolean): FactCandidate[] {
  if (!Array.isArray(value)) throw new Error('事实点评缺少factCandidates数组');
  if (value.length > 16) throw new Error('单章事实候选超过16条上限，只保留会影响后文的持久事实');
  const parsed: FactCandidate[] = [];
  for (const item of value) {
    try {
      parsed.push(parseFactCandidate(item));
    } catch (error) {
      // Only the one-shot repair path may discard an individually unsafe fact.
      // The review verdict/issues remain usable, while an incomplete fact must
      // never be promoted by guessing a missing negation or epistemic field.
      if (!allowDroppingInvalid) throw error;
    }
  }
  if (allowDroppingInvalid && value.length > 0 && parsed.length === 0) {
    throw new Error('事实点评修复后仍没有任何可安全保存的factCandidates');
  }
  return parsed;
}

function parseFactCandidate(item: unknown): FactCandidate {
  if (!isRecord(item)) throw new Error('事实候选必须是对象');
  const subjectName = requiredText(item.subjectName, 'factCandidates.subjectName');
  const relationKey = requiredText(item.relationKey, 'factCandidates.relationKey');
  const evidenceQuote = requiredText(item.evidenceQuote, 'factCandidates.evidenceQuote');
  const evidenceLocation = requiredText(item.evidenceLocation, 'factCandidates.evidenceLocation');
  if (!factEntityTypes.includes(item.entityType as FactCandidate['entityType'])) throw new Error('factCandidates.entityType无效');
  if (!factEpistemicStatuses.includes(item.epistemicStatus as FactCandidate['epistemicStatus'])) throw new Error('factCandidates.epistemicStatus无效');
  if (typeof item.negated !== 'boolean') throw new Error('factCandidates.negated无效');
  if (!('value' in item)) throw new Error('factCandidates.value缺失');
  for (const field of ['viewpointName', 'knowledgeSubjectName', 'knowledgeTimeStart', 'knowledgeTimeEnd', 'storyTimeStart', 'storyTimeEnd'] as const) {
    if (item[field] !== null && typeof item[field] !== 'string') throw new Error(`factCandidates.${field}无效`);
  }
  return {
    subjectName,
    entityType: item.entityType as FactCandidate['entityType'],
    relationKey,
    value: item.value,
    evidenceQuote,
    evidenceLocation,
    epistemicStatus: item.epistemicStatus as FactCandidate['epistemicStatus'],
    negated: item.negated,
    viewpointName: (item.viewpointName ?? null) as string | null,
    knowledgeSubjectName: (item.knowledgeSubjectName ?? null) as string | null,
    knowledgeTimeStart: (item.knowledgeTimeStart ?? null) as string | null,
    knowledgeTimeEnd: (item.knowledgeTimeEnd ?? null) as string | null,
    storyTimeStart: item.storyTimeStart as string | null,
    storyTimeEnd: item.storyTimeEnd as string | null
  };
}

function parseJsonObject(raw: string, normalizeMalformedJsonStrings = false): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('点评模型未返回JSON对象');
  const candidate = trimmed.slice(start, end + 1);
  try {
    const value = JSON.parse(candidate) as unknown;
    if (!isRecord(value)) throw new Error('点评结果必须是JSON对象');
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === '点评结果必须是JSON对象') throw error;
    if (normalizeMalformedJsonStrings) {
      try {
        const repaired = JSON.parse(escapeUnquotedJsonStringContent(
          insertMissingCommaBeforeKnownProperty(candidate)
        )) as unknown;
        if (!isRecord(repaired)) throw new Error('点评结果必须是JSON对象');
        return repaired;
      } catch (repairError) {
        if (repairError instanceof Error && repairError.message === '点评结果必须是JSON对象') throw repairError;
      }
    }
    throw new Error('点评模型返回的JSON无法解析');
  }
}

/**
 * A one-shot model repair can occasionally omit the comma between a completed
 * string value and the next contract property. Repair only that punctuation,
 * only across a line break, and only for a known review-contract property. The
 * field name and both values remain byte-for-byte unchanged, while arbitrary
 * prose that happens to contain a colon is left untouched.
 */
function insertMissingCommaBeforeKnownProperty(input: string): string {
  const knownProperties = [
    'reviewerRole', 'manuscriptVersionId', 'modelSnapshotId', 'verdict', 'summary',
    'issues', 'scores', 'factCandidates', 'aiStyle', 'politicalRisk', 'sexualContentRisk',
    'location', 'issueType', 'severity', 'evidence', 'requiredAction',
    'riskScore', 'flaggedParagraphCount', 'totalParagraphCount', 'flaggedParagraphRatio',
    'isAuthorshipProbability', 'level', 'locations', 'recommendedAction', 'policyVersion',
    'subjectName', 'entityType', 'relationKey', 'value', 'evidenceQuote', 'evidenceLocation',
    'epistemicStatus', 'negated', 'viewpointName', 'knowledgeSubjectName',
    'knowledgeTimeStart', 'knowledgeTimeEnd', 'storyTimeStart', 'storyTimeEnd'
  ];
  const propertyAlternation = knownProperties.join('|');
  return input.replace(
    new RegExp(`"([ \\t]*\\r?\\n[ \\t]*)"(${propertyAlternation})"([ \\t]*:)`, 'gu'),
    '",$1"$2"$3'
  );
}

/**
 * Repairs only lexical JSON string mistakes produced by a model: an ASCII quote or raw control
 * character inside an otherwise valid string. It never inserts/removes fields or changes values,
 * and is enabled only after the one-shot model repair path.
 */
function escapeUnquotedJsonStringContent(input: string): string {
  let output = '';
  let inString = false;
  const containers: Array<'object' | 'array'> = [];
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (!inString) {
      output += character;
      if (character === '{') containers.push('object');
      else if (character === '[') containers.push('array');
      else if (character === '}' || character === ']') containers.pop();
      else if (character === '"') inString = true;
      continue;
    }
    if (character === '\\') {
      output += character;
      if (index + 1 < input.length) output += input[index += 1]!;
      continue;
    }
    if (character === '\n') { output += '\\n'; continue; }
    if (character === '\r') { output += '\\r'; continue; }
    if (character === '\t') { output += '\\t'; continue; }
    if (character !== '"') {
      output += character;
      continue;
    }
    if (isStructuralStringEnd(input, index, containers.at(-1))) {
      output += character;
      inString = false;
    } else output += '\\"';
  }
  if (inString) throw new Error('点评模型JSON字符串没有闭合');
  return output;
}

function isStructuralStringEnd(input: string, quoteIndex: number, container: 'object' | 'array' | undefined): boolean {
  let cursor = quoteIndex + 1;
  while (cursor < input.length && /\s/u.test(input[cursor]!)) cursor += 1;
  if (cursor >= input.length) return true;
  const next = input[cursor]!;
  if (next === ':' || next === '}' || next === ']') return true;
  if (next !== ',') return false;
  cursor += 1;
  while (cursor < input.length && /\s/u.test(input[cursor]!)) cursor += 1;
  if (cursor >= input.length) return false;
  if (container === 'object') {
    if (input[cursor] !== '"') return false;
    const keyEnd = findNextUnescapedQuote(input, cursor + 1);
    if (keyEnd < 0) return false;
    let afterKey = keyEnd + 1;
    while (afterKey < input.length && /\s/u.test(input[afterKey]!)) afterKey += 1;
    return input[afterKey] === ':';
  }
  return container === 'array' && /["{[\d\-tfn]/u.test(input[cursor]!);
}

function findNextUnescapedQuote(input: string, start: number): number {
  for (let index = start; index < input.length; index += 1) {
    if (input[index] !== '"') continue;
    let slashes = 0;
    for (let before = index - 1; before >= 0 && input[before] === '\\'; before -= 1) slashes += 1;
    if (slashes % 2 === 0) return index;
  }
  return -1;
}

function parseIssue(
  value: unknown,
  normalizeLocalBlocker: boolean,
  normalizeLocation: boolean,
  normalizeSeverity: boolean,
  normalizeFieldAliases: boolean
): ProductionReviewIssue {
  if (!isRecord(value)) throw new Error('点评问题必须是对象');
  const location = normalizeLocation && isRecord(value.location) && Object.keys(value.location).length > 0
    ? JSON.stringify(value.location)
    : value.location;
  const requiredAction = normalizeFieldAliases
    && (typeof value.requiredAction !== 'string' || value.requiredAction.trim().length === 0)
    && typeof value.requiredFix === 'string'
    ? value.requiredFix
    : value.requiredAction;
  for (const field of ['issueType', 'evidence'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new Error(`点评问题字段${field}无效`);
  }
  if (typeof requiredAction !== 'string' || requiredAction.trim().length === 0) throw new Error('点评问题字段requiredAction无效');
  if (typeof location !== 'string' || location.trim().length === 0) throw new Error('点评问题字段location无效');
  const rawSeverity = typeof value.severity === 'string' ? value.severity.trim().toLowerCase() : '';
  const severity = normalizeSeverity && (rawSeverity === 'moderate' || rawSeverity === 'medium')
    ? 'major'
    : rawSeverity;
  if (!['blocker', 'major', 'minor', 'observation'].includes(severity)) throw new Error('点评问题severity无效');
  const unsupportedBlocker = severity === 'blocker'
    && !/(?:停止|等待(?:老板|作者)|老板确认|作者确认|不可自动|无法定点|永久|侵权|高风险|重新设计|整体重构)/u.test(requiredAction);
  if (unsupportedBlocker && !normalizeLocalBlocker) {
    throw new Error('blocker只用于不能自动定点修复且必须停止或等待确认的问题；可给出局部修改动作的问题应标为major');
  }
  return {
    location: location.trim(),
    issueType: (value.issueType as string).trim(),
    severity: unsupportedBlocker ? 'major' : severity as ProductionReviewIssue['severity'],
    evidence: (value.evidence as string).trim(),
    requiredAction: requiredAction.trim()
  };
}

function parseAiStyle(value: unknown, normalizeEvidence: boolean): NonNullable<ProductionReview['aiStyle']> {
  if (!isRecord(value)) throw new Error('文学点评缺少aiStyle证据结构');
  const riskScore = boundedNumber(value.riskScore, 'aiStyle.riskScore');
  const flagged = integer(value.flaggedParagraphCount, 'aiStyle.flaggedParagraphCount');
  const total = integer(value.totalParagraphCount, 'aiStyle.totalParagraphCount');
  if (total <= 0 || flagged > total) throw new Error('aiStyle段落计数无效');
  const reportedRatio = boundedNumber(value.flaggedParagraphRatio, 'aiStyle.flaggedParagraphRatio', 0, 1);
  const ratio = flagged / total;
  if (Math.abs(reportedRatio - ratio) > 0.001) throw new Error('aiStyle比例必须由段落计数计算');
  if (value.isAuthorshipProbability !== false) throw new Error('AI腔风险不得冒充AI作者概率');
  const evidence = normalizeEvidence
    ? normalizedEvidenceArray(value.evidence, 'aiStyle.evidence')
    : stringArray(value.evidence, 'aiStyle.evidence');
  if (flagged > 0 && evidence.length === 0) throw new Error('AI腔风险缺少正文证据');
  return { riskScore, flaggedParagraphCount: flagged, totalParagraphCount: total, flaggedParagraphRatio: ratio, isAuthorshipProbability: false, evidence };
}

function normalizedEvidenceArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field}必须是字符串数组`);
  return value.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (isRecord(item) && Object.keys(item).length > 0) return JSON.stringify(item);
    throw new Error(`${field}修复结果只能包含文本或可追溯证据对象`);
  }).filter(Boolean);
}

function parseRisk(value: unknown, field: string, normalizeArrays: boolean): ContentRisk {
  if (!isRecord(value)) throw new Error(`体验点评缺少${field}`);
  const level = String(value.level);
  if (!['none', 'low', 'medium', 'high', 'blocked'].includes(level)) throw new Error(`${field}.level无效`);
  const locations = normalizeArrays
    ? normalizedRiskArray(value.locations, `${field}.locations`)
    : stringArray(value.locations, `${field}.locations`);
  // 套餐模型偶尔把 none 级风险的空数组写成空字符串；二者都明确表示“无证据”，
  // 这里只做等价结构规范化，非零风险仍严格禁止缺少位置或证据。
  const evidence = level === 'none' && value.evidence === ''
    ? []
    : normalizeArrays
      ? normalizedRiskArray(value.evidence, `${field}.evidence`)
      : stringArray(value.evidence, `${field}.evidence`);
  if (level !== 'none' && (locations.length === 0 || evidence.length === 0)) throw new Error(`${field}非零风险必须带位置和证据`);
  const recommendedAction = typeof value.recommendedAction === 'string' ? value.recommendedAction.trim() : null;
  // A repaired none-risk object may truthfully have no action. Preserve that empty value instead
  // of inventing a recommendation; any non-zero risk still requires an explicit action.
  if (recommendedAction === null || (recommendedAction.length === 0 && (level !== 'none' || !normalizeArrays))) {
    throw new Error(`${field}.recommendedAction缺失`);
  }
  if (typeof value.policyVersion !== 'string' || value.policyVersion.trim().length === 0) throw new Error(`${field}.policyVersion缺失`);
  return { level: level as ContentRisk['level'], locations, evidence, recommendedAction, policyVersion: value.policyVersion.trim() };
}

function normalizedRiskArray(value: unknown, field: string): string[] {
  if (typeof value === 'string') return value.trim().length === 0 ? [] : [value.trim()];
  return stringArray(value, field);
}

function normalizeVerdict(value: unknown, normalizeRepairedVerdict = false): ReviewVerdict {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'pass' || normalized === '通过' || normalized === '合规') return 'pass';
  if (normalized === 'rewrite' || normalized === '重写' || normalized === '需重写') return 'rewrite';
  if (normalized === 'blocked' || normalized === '阻断' || normalized === '禁止通过') return 'blocked';
  if (normalizeRepairedVerdict && normalized === 'minor_issues') return 'pass';
  throw new Error('点评结果verdict无效');
}

function boundedNumber(value: unknown, field: string, minimum = 0, maximum = 100): number {
  if (!Number.isFinite(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${field}无效`);
  return Number(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field}缺失`);
  return value.trim();
}

function integer(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field}无效`);
  return Number(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${field}必须是字符串数组`);
  return value.map((item) => (item as string).trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
