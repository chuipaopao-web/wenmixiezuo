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
}): EditorReviewSynthesis {
  const value = parseJsonObject(raw);
  if (value.panelId !== expected.panelId || value.manuscriptVersionId !== expected.manuscriptVersionId) {
    throw new Error('主编综合结果与冻结点评轮次不一致');
  }
  if (!['pass', 'rewrite', 'blocked'].includes(String(value.recommendedVerdict))) throw new Error('主编综合recommendedVerdict无效');
  if (!Array.isArray(value.priorityIssueIndexes)
    || value.priorityIssueIndexes.some((index) => !Number.isInteger(index) || Number(index) < 0 || Number(index) >= expected.issueCount)
    || new Set(value.priorityIssueIndexes).size !== value.priorityIssueIndexes.length) {
    throw new Error('主编综合priorityIssueIndexes无效');
  }
  const rationale = requiredText(value.rationale, '主编综合rationale');
  return {
    panelId: expected.panelId,
    manuscriptVersionId: expected.manuscriptVersionId,
    recommendedVerdict: value.recommendedVerdict as ReviewVerdict,
    priorityIssueIndexes: value.priorityIssueIndexes as number[],
    preservedDisagreements: stringArray(value.preservedDisagreements, '主编综合preservedDisagreements'),
    rationale
  };
}

export function parseProductionReview(
  raw: string,
  expected: { reviewerRole: ReviewerRole; manuscriptVersionId: string; modelSnapshotId: string }
): ProductionReview {
  const value = parseJsonObject(raw);
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) throw new Error(`点评结果${field}与冻结任务不一致`);
  }
  if (!['pass', 'rewrite', 'blocked'].includes(String(value.verdict))) throw new Error('点评结果verdict无效');
  if (typeof value.summary !== 'string' || value.summary.trim().length === 0) throw new Error('点评结果summary缺失');
  if (!Array.isArray(value.issues)) throw new Error('点评结果issues必须是数组');
  const issues = value.issues.map(parseIssue);
  if (!isRecord(value.scores)) throw new Error('点评结果scores必须是对象');
  const scores: Record<string, number> = {};
  for (const [key, score] of Object.entries(value.scores)) {
    if (!Number.isFinite(score) || Number(score) < 0 || Number(score) > 100) throw new Error(`点评评分${key}无效`);
    scores[key] = Number(score);
  }
  if (Object.keys(scores).length === 0) throw new Error('点评结果scores不能为空');
  const base: ProductionReview = {
    ...expected,
    verdict: value.verdict as ReviewVerdict,
    summary: value.summary.trim(),
    issues,
    scores
  };
  if (expected.reviewerRole === 'fact') base.factCandidates = parseFactCandidates(value.factCandidates);
  if (expected.reviewerRole === 'literary') base.aiStyle = parseAiStyle(value.aiStyle);
  if (expected.reviewerRole === 'experience') {
    base.politicalRisk = parseRisk(value.politicalRisk, 'politicalRisk');
    base.sexualContentRisk = parseRisk(value.sexualContentRisk, 'sexualContentRisk');
  }
  return base;
}

function parseFactCandidates(value: unknown): FactCandidate[] {
  if (!Array.isArray(value)) throw new Error('事实点评缺少factCandidates数组');
  if (value.length > 40) throw new Error('单章事实候选超过40条上限');
  return value.map((item) => {
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
  });
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('点评模型未返回JSON对象');
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!isRecord(value)) throw new Error('点评结果必须是JSON对象');
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === '点评结果必须是JSON对象') throw error;
    throw new Error('点评模型返回的JSON无法解析');
  }
}

function parseIssue(value: unknown): ProductionReviewIssue {
  if (!isRecord(value)) throw new Error('点评问题必须是对象');
  for (const field of ['location', 'issueType', 'severity', 'evidence', 'requiredAction'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) throw new Error(`点评问题字段${field}无效`);
  }
  if (!['blocker', 'major', 'minor', 'observation'].includes(value.severity as string)) throw new Error('点评问题severity无效');
  return {
    location: (value.location as string).trim(),
    issueType: (value.issueType as string).trim(),
    severity: value.severity as ProductionReviewIssue['severity'],
    evidence: (value.evidence as string).trim(),
    requiredAction: (value.requiredAction as string).trim()
  };
}

function parseAiStyle(value: unknown): NonNullable<ProductionReview['aiStyle']> {
  if (!isRecord(value)) throw new Error('文学点评缺少aiStyle证据结构');
  const riskScore = boundedNumber(value.riskScore, 'aiStyle.riskScore');
  const flagged = integer(value.flaggedParagraphCount, 'aiStyle.flaggedParagraphCount');
  const total = integer(value.totalParagraphCount, 'aiStyle.totalParagraphCount');
  if (total <= 0 || flagged > total) throw new Error('aiStyle段落计数无效');
  const ratio = boundedNumber(value.flaggedParagraphRatio, 'aiStyle.flaggedParagraphRatio', 0, 1);
  if (Math.abs(ratio - flagged / total) > 0.0001) throw new Error('aiStyle比例必须由段落计数计算');
  if (value.isAuthorshipProbability !== false) throw new Error('AI腔风险不得冒充AI作者概率');
  const evidence = stringArray(value.evidence, 'aiStyle.evidence');
  if (flagged > 0 && evidence.length === 0) throw new Error('AI腔风险缺少正文证据');
  return { riskScore, flaggedParagraphCount: flagged, totalParagraphCount: total, flaggedParagraphRatio: ratio, isAuthorshipProbability: false, evidence };
}

function parseRisk(value: unknown, field: string): ContentRisk {
  if (!isRecord(value)) throw new Error(`体验点评缺少${field}`);
  const level = String(value.level);
  if (!['none', 'low', 'medium', 'high', 'blocked'].includes(level)) throw new Error(`${field}.level无效`);
  const locations = stringArray(value.locations, `${field}.locations`);
  const evidence = stringArray(value.evidence, `${field}.evidence`);
  if (level !== 'none' && (locations.length === 0 || evidence.length === 0)) throw new Error(`${field}非零风险必须带位置和证据`);
  if (typeof value.recommendedAction !== 'string' || value.recommendedAction.trim().length === 0) throw new Error(`${field}.recommendedAction缺失`);
  if (typeof value.policyVersion !== 'string' || value.policyVersion.trim().length === 0) throw new Error(`${field}.policyVersion缺失`);
  return { level: level as ContentRisk['level'], locations, evidence, recommendedAction: value.recommendedAction.trim(), policyVersion: value.policyVersion.trim() };
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
