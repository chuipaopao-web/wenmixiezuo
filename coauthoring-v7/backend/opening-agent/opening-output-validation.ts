import type {
  OpeningPackage,
  OpeningPublishingPlatform,
  OpeningProtagonist,
  OpeningReview,
  OpeningReviewIssue,
  OpeningTaxonomyReference,
  OpeningWorkOrder
} from './opening-agent-contracts.js';
import { OPENING_DECISION_FIELDS, type OpeningReviewDecision } from './opening-agent-contracts.js';

export function parseOpeningWorkOrder(output: string): OpeningWorkOrder {
  const value = parseStructuredObject(output, '开书任务书');
  return {
    corePremise: requiredText(value.corePremise, '核心命题', 500),
    mustKeep: textArray(value.mustKeep, '必须保留', 12, 500, true),
    preferences: textArray(value.preferences, '创作倾向', 12, 500, true),
    openDecisions: textArray(value.openDecisions, '开放项', 12, 500, true),
    intendedExperience: requiredText(value.intendedExperience, '目标阅读体验', 800),
    designResponsibilities: textArray(value.designResponsibilities, '设计责任', 12, 500, false),
    prohibitions: textArray(value.prohibitions, '禁止越界项', 12, 500, false)
  };
}

export function parseOpeningPackage(
  output: string,
  taxonomy?: OpeningTaxonomyReference,
  expectedPublishingPlatform?: OpeningPublishingPlatform
): OpeningPackage {
  const value = parseStructuredObject(output, '开书资料包');
  const positioning = record(value.positioning, '作品定位');
  const backgrounds = record(value.backgrounds, '背景');
  const opening = optionalRecord(value.opening, '开局');
  const longTermDirection = record(value.longTermDirection, '长期方向');
  const possibleEnding = record(value.possibleEnding, '可能终点');
  const channel = requiredText(positioning.channel, '频道', 20);
  const publishingPlatform = requiredText(positioning.publishingPlatform, '发布渠道', 20);
  if (!['fanqie', 'qidian', 'mainstream'].includes(publishingPlatform)) throw new Error('发布渠道无效');
  if (expectedPublishingPlatform !== undefined && publishingPlatform !== expectedPublishingPlatform) {
    throw new Error('发布渠道不得在设计过程中被更换');
  }
  if (!['male', 'female', 'general'].includes(channel)) throw new Error('频道必须是male、female或general');
  const protagonistsRaw = array(value.protagonists, '主角');
  if (protagonistsRaw.length < 1 || protagonistsRaw.length > 2) throw new Error('主角必须为1至2位');
  const category = requiredText(positioning.category, '作品分类', 100);
  const genres = boundedTextArray(positioning.genres, '融合题材', 1, 5, 50);
  const tags = boundedTextArray(positioning.tags, '内容标签', 3, 12, 50);
  const mustFollow = textArray(value.mustFollow ?? [], '必须遵守', 15, 800, true);
  const authorInstructions = textArray(value.authorInstructions ?? [], '作者调整要求', 8, 2_000, true);
  if (taxonomy !== undefined) validateTaxonomySelection(taxonomy, channel, category, genres, tags);
  return {
    title: boundedText(value.title, '暂定书名', publishingPlatform === 'qidian' ? 4 : 6, 15),
    positioning: {
      publishingPlatform: publishingPlatform as OpeningPublishingPlatform,
      channel: channel as OpeningPackage['positioning']['channel'],
      category,
      genres,
      tags,
      coreAppeal: boundedText(positioning.coreAppeal, '核心看点', 8, 800),
      expectedTotalWords: integer(positioning.expectedTotalWords, '预计总字数', 100_000, 10_000_000),
      ...legacyPlanningFields(positioning)
    },
    backgrounds: {
      eraAndWorld: boundedText(backgrounds.eraAndWorld, '时代与世界背景', 8, 800),
      openingSituation: ''
    },
    protagonists: protagonistsRaw.map((item, index) => parseProtagonist(item, index)),
    opening: {
      startingSituation: '',
      incitingIncident: '',
      immediateConflict: '',
      readerPromise: ''
    },
    longTermDirection: {
      centralConflict: requiredText(longTermDirection.centralConflict, '长期核心矛盾', 800),
      progression: requiredText(longTermDirection.progression, '成长方向', 800),
      relationshipDirection: requiredText(longTermDirection.relationshipDirection, '关系方向', 800),
      storyPotential: requiredText(longTermDirection.storyPotential, '持续创作空间', 800)
    },
    possibleEnding: {
      direction: requiredText(possibleEnding.direction, '终点方向', 800),
      price: requiredText(possibleEnding.price, '终点代价', 800),
      openness: requiredText(possibleEnding.openness, '终点可调整空间', 800)
    },
    authorNotes: [],
    mustFollow,
    ...(authorInstructions.length === 0 ? {} : { authorInstructions })
  };
}

/**
 * 只处理作者明确写出的简单主角句式，避免用猜测约束含糊灵感。
 * 命中后必须严格保真；否则交给主编任务书和模型审查。
 */
export function assertOpeningPackageAuthorFidelity(authorIdea: string, openingPackage: OpeningPackage): void {
  const explicitName = extractExplicitProtagonistName(authorIdea);
  if (explicitName === null) return;
  const first = openingPackage.protagonists[0]?.name.trim() ?? '';
  if (first !== explicitName) {
    throw new Error(`作者明确指定主角为“${explicitName}”，资料包却把“${first || '未命名角色'}”放在第一主角位置`);
  }
}

export function extractExplicitProtagonistName(authorIdea: string): string | null {
  const normalized = authorIdea.trim();
  const match = normalized.match(/^(?:我想写|想写|故事是|讲的是|主角是)?\s*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·]{0,11}?)(?=穿越|重生|魂穿|来到|误入)/u);
  const candidate = match?.[1]?.trim() ?? '';
  if (candidate.length === 0 || ['我', '他', '她', '主角', '一个人', '一个男人', '一个女人', '少年', '少女'].includes(candidate)) {
    return null;
  }
  // 这里只能做“明确姓名”的硬保真，不能把“一名现代救援队员”等角色描述
  // 当成人名。含糊主体由主编语义理解，确定性校验只接受短中文姓名或英文姓名。
  if (/^[\p{Script=Han}·]+$/u.test(candidate)) {
    const length = Array.from(candidate).length;
    if (length < 2 || length > 4 || /^(?:一个|一名|某个|某名|这名|那名)/u.test(candidate)) return null;
    return candidate;
  }
  return /^[A-Za-z][A-Za-z0-9·]{0,11}$/u.test(candidate) ? candidate : null;
}

function validateTaxonomySelection(
  taxonomy: OpeningTaxonomyReference,
  channel: string,
  category: string,
  genres: string[],
  tags: string[]
): void {
  if (channel !== 'male' && channel !== 'female') throw new Error('频道必须从男频或女频中选择');
  const categoryItem = taxonomy.categories.find((item) => item.name === category && item.channel === channel);
  if (categoryItem === undefined) throw new Error(`作品分类不在当前${channel === 'male' ? '男频' : '女频'}目录：${category}`);
  const subjectSet = new Set(taxonomy.subjects);
  const invalidGenre = genres.find((item) => !subjectSet.has(item));
  if (invalidGenre !== undefined) throw new Error(`融合题材不在当前目录：${invalidGenre}`);
  const tagSet = new Set(taxonomy.allowedTags);
  const invalidTag = tags.find((item) => !tagSet.has(item));
  if (invalidTag !== undefined) throw new Error(`内容标签不在当前目录：${invalidTag}`);
}

export function parseOpeningReview(output: string): OpeningReview {
  const value = parseStructuredObject(output, '主编审查');
  const verdict = requiredText(value.verdict, '审查结论', 30);
  if (!['pass', 'revise', 'author_decision'].includes(verdict)) {
    throw new Error('审查结论必须是pass、revise或author_decision');
  }
  const issues = array(value.issues, '问题清单').map((item, index) => parseReviewIssue(item, index));
  const requiredChanges = textArray(value.requiredChanges, '必要修订', 12, 800, true);
  const authorDecisions = textArray(value.authorDecisions, '作者决定项', 12, 800, true);
  const decisions = optionalArray(value.decisions, '作者决定卡').map((item, index) => parseReviewDecision(item, index));
  if (decisions.length > 12) throw new Error('作者决定卡最多12项');
  if (verdict === 'pass' && (requiredChanges.length > 0 || authorDecisions.length > 0 || decisions.length > 0)) {
    throw new Error('审查通过时不能同时要求必要修订或作者决定');
  }
  if (verdict === 'revise' && decisions.length === 0) throw new Error('要求修订时必须提供可执行的作者决定卡');
  if (verdict === 'author_decision' && authorDecisions.length === 0 && decisions.length === 0) throw new Error('等待作者决定时必须列出决定项');
  return {
    verdict: verdict as OpeningReview['verdict'],
    summary: requiredText(value.summary, '审查摘要', 1_000),
    issues,
    requiredChanges,
    authorDecisions,
    ...(decisions.length === 0 ? {} : { decisions })
  };
}

function parseReviewDecision(value: unknown, index: number): OpeningReviewDecision {
  const item = record(value, `第${index + 1}个作者决定卡`);
  const field = requiredText(item.field, '决定字段', 200);
  if (!(OPENING_DECISION_FIELDS as readonly string[]).includes(field)) throw new Error('决定字段不在开书资料白名单');
  return {
    decisionId: `decision-${index + 1}`,
    field: field as OpeningReviewDecision['field'],
    question: requiredText(item.question, '决定问题', 500),
    currentValue: requiredText(item.currentValue, '当前方案', 800),
    recommendation: requiredText(item.recommendation, '主编建议', 800),
    reason: requiredText(item.reason, '建议理由', 800),
    impact: requiredText(item.impact, '影响说明', 800),
    required: booleanValue(item.required, '是否必须决定')
  };
}

export function parseStructuredObject(output: string, label: string): Record<string, unknown> {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(output) as unknown); } catch { /* search embedded complete objects */ }
  for (const candidateText of extractCompleteJsonObjects(output)) {
    try { candidates.push(JSON.parse(candidateText) as unknown); } catch { /* continue */ }
  }
  const objectValue = candidates.find(isRecord);
  if (objectValue === undefined) throw new Error(`${label}缺少完整、合法的JSON对象`);
  return objectValue;
}

function parseProtagonist(value: unknown, index: number): OpeningProtagonist {
  const item = record(value, `第${index + 1}位主角`);
  const visual = item.visualIdentity === undefined ? null : record(item.visualIdentity, `第${index + 1}位主角视觉特征`);
  const familyBackground = requiredText(item.familyBackground, `第${index + 1}位主角家庭背景`, 800);
  const careerBackground = requiredText(item.careerBackground, `第${index + 1}位主角职业背景`, 800);
  const goldenFinger = requiredText(item.goldenFinger, `第${index + 1}位主角特殊能力`, 800);
  if (visual === null) throw new Error(`第${index + 1}位主角视觉特征不能为空`);
  const appearance = requiredText(visual.appearance, `第${index + 1}位主角外貌`, 800);
  const build = requiredText(visual.build, `第${index + 1}位主角身形`, 800);
  const signatureFeature = requiredText(visual.signatureFeature, `第${index + 1}位主角醒目标志`, 800);
  return {
    name: requiredText(item.name, `第${index + 1}位主角姓名`, 100),
    age: requiredText(item.age, `第${index + 1}位主角年龄`, 50),
    identity: requiredText(item.identity, `第${index + 1}位主角身份`, 800),
    background: requiredText(item.background, `第${index + 1}位主角经历`, 800),
    familyBackground,
    careerBackground,
    goldenFinger,
    visualIdentity: {
      appearance,
      build,
      signatureFeature
    },
    goal: '',
    dilemma: '',
    personality: boundedTextArray(item.personality, `第${index + 1}位主角性格`, 1, 6, 50),
    boundary: ''
  };
}

function parseReviewIssue(value: unknown, index: number): OpeningReviewIssue {
  const item = record(value, `第${index + 1}个审查问题`);
  return {
    field: requiredText(item.field, '问题字段', 200),
    evidence: requiredText(item.evidence, '问题证据', 1_000),
    impact: requiredText(item.impact, '问题影响', 1_000),
    requiredAction: requiredText(item.requiredAction, '修改动作', 1_000)
  };
}

function boundedText(value: unknown, label: string, minimum: number, maximum: number): string {
  const result = requiredText(value, label, maximum);
  if ([...result].length < minimum) throw new Error(`${label}至少需要${minimum}个字`);
  return result;
}

function validatedVolumePlan(value: Record<string, unknown>): NonNullable<OpeningPackage['positioning']['volumePlan']> {
  const minimum = integer(value.minimum, '建议最少卷数', 1, 30);
  const recommended = integer(value.recommended, '建议卷数', 1, 30);
  const maximum = integer(value.maximum, '建议最多卷数', 1, 30);
  if (!(minimum <= recommended && recommended <= maximum)) throw new Error('建议卷数必须满足最少卷数≤建议卷数≤最多卷数');
  return { minimum, recommended, maximum };
}

function legacyPlanningFields(value: Record<string, unknown>): Pick<OpeningPackage['positioning'], 'targetReaders' | 'volumePlan' | 'retentionPositioning'> {
  const targetReaders = optionalText(value.targetReaders, '商业受众', 500);
  const retentionPositioning = optionalText(value.retentionPositioning, '追读定位', 800);
  const volumePlan = value.volumePlan === undefined || value.volumePlan === null
    ? undefined
    : validatedVolumePlan(record(value.volumePlan, '建议卷数'));
  return {
    ...(targetReaders.length === 0 ? {} : { targetReaders }),
    ...(volumePlan === undefined ? {} : { volumePlan }),
    ...(retentionPositioning.length === 0 ? {} : { retentionPositioning })
  };
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label}必须是${minimum}至${maximum}之间的整数`);
  }
  return Number(value);
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空`);
  const result = value.trim();
  if ([...result].length > maximum) throw new Error(`${label}最多${maximum}个字`);
  return result;
}

function boundedTextArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  itemMaximum: number
): string[] {
  const result = textArray(value, label, maximum, itemMaximum, minimum === 0);
  if (result.length < minimum) throw new Error(`${label}至少需要${minimum}项`);
  return result;
}

function textArray(value: unknown, label: string, maximum: number, itemMaximum: number, allowEmpty: boolean): string[] {
  const values = array(value, label);
  const result = [...new Set(values.map((item) => requiredText(item, `${label}条目`, itemMaximum)))];
  if (!allowEmpty && result.length === 0) throw new Error(`${label}不能为空`);
  if (result.length > maximum) throw new Error(`${label}最多${maximum}项`);
  return result;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}必须是对象`);
  return value;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return record(value, label);
}

function optionalText(value: unknown, label: string, maximum: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${label}必须是文字`);
  const result = value.trim();
  if ([...result].length > maximum) throw new Error(`${label}最多${maximum}个字`);
  return result;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`);
  return value;
}

function optionalArray(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return [];
  return array(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是真或假`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractCompleteJsonObjects(value: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return results;
}
