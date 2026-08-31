import { createHash } from 'node:crypto';
import {
  parseOpeningPackage,
  type OpeningPackage,
  type OpeningTaxonomyReference
} from '@wenmi/v7-backend';
import {
  OPENING_TAXONOMY,
  type OpeningBlueprintInput,
  type ProtagonistRole
} from '../../contracts/opening-blueprint.js';

const commonGroup = OPENING_TAXONOMY.tagGroups.find((group) => group.key === 'common');

export const V7_OPENING_TAXONOMY_REFERENCE: OpeningTaxonomyReference = {
  version: OPENING_TAXONOMY.version,
  categories: OPENING_TAXONOMY.categories.map((item) => ({
    key: item.key,
    name: item.name,
    channel: item.channel,
    description: item.description,
    recommendedTags: [...item.recommendedMainTags]
  })),
  subjects: OPENING_TAXONOMY.subjects.map((item) => item.name),
  tagSuggestions: [...new Set([
    ...OPENING_TAXONOMY.categories.flatMap((item) => item.recommendedMainTags),
    ...(commonGroup === undefined
      ? []
      : [...commonGroup.mainTags, ...commonGroup.auxiliaryTags, ...commonGroup.storyTraits].slice(0, 80))
  ])],
  allowedTags: [...OPENING_TAXONOMY.mainTags]
};

export function validateV7OpeningPackage(value: unknown): OpeningPackage {
  const root = manualRecord(value, '开书资料');
  const positioning = manualRecord(root.positioning, '作品定位');
  return parseOpeningPackage(JSON.stringify({
    ...root,
    positioning: {
      ...normalizeKnownTaxonomyPlacement(positioning),
      publishingPlatform: normalizePublishingPlatform(positioning.publishingPlatform)
    }
  }), V7_OPENING_TAXONOMY_REFERENCE);
}

/**
 * 模型偶尔会把同一份目录中的“融合题材”放进“内容标签”。这只是已知键的
 * 字段归位，不涉及题材判断；能在目录和容量约束内无损移动时直接修正，避免
 * 为纯JSON结构问题再次调用模型。无法无损归位时仍交给严格校验报错。
 */
function normalizeKnownTaxonomyPlacement(positioning: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(positioning.genres) || !Array.isArray(positioning.tags)) return positioning;
  const genres = [...positioning.genres];
  const tags: unknown[] = [];
  const subjects = new Set(V7_OPENING_TAXONOMY_REFERENCE.subjects);
  const allowedTags = new Set(V7_OPENING_TAXONOMY_REFERENCE.allowedTags);
  for (const candidate of positioning.tags) {
    if (
      typeof candidate === 'string'
      && subjects.has(candidate)
      && !allowedTags.has(candidate)
      && !genres.includes(candidate)
      && genres.length < 5
    ) {
      genres.push(candidate);
    } else {
      tags.push(candidate);
    }
  }
  return { ...positioning, genres, tags };
}

/**
 * 自己设计只建立后续创作所需的最小可信锚点。未知内容保持为空，不用通用文案
 * 冒充作者决定；AI团队生成的资料包仍走上面的完整严格校验。
 */
export function validateV7ManualOpeningPackage(value: unknown): OpeningPackage {
  const root = manualRecord(value, '开书资料');
  const positioning = manualRecord(root.positioning, '作品定位');
  const backgrounds = manualRecord(root.backgrounds, '背景');
  const opening = manualRecord(root.opening, '开局');
  const longTermDirection = manualRecord(root.longTermDirection, '长期方向');
  const possibleEnding = manualRecord(root.possibleEnding, '可能终点');
  const channel = manualText(positioning.channel, '频道', 20, true);
  if (channel !== 'male' && channel !== 'female') throw new Error('频道必须从男频或女频中选择');
  const category = manualText(positioning.category, '作品分类', 100, true);
  if (!V7_OPENING_TAXONOMY_REFERENCE.categories.some((item) => item.channel === channel && item.name === category)) {
    throw new Error(`作品分类不在当前${channel === 'male' ? '男频' : '女频'}目录：${category}`);
  }
  const genres = manualTextArray(positioning.genres, '融合题材', 0, 5, 50);
  const tags = manualTextArray(positioning.tags, '内容标签', 0, 12, 50);
  const subjectSet = new Set(V7_OPENING_TAXONOMY_REFERENCE.subjects);
  const invalidGenre = genres.find((item) => !subjectSet.has(item));
  if (invalidGenre !== undefined) throw new Error(`融合题材不在当前目录：${invalidGenre}`);
  const tagSet = new Set(V7_OPENING_TAXONOMY_REFERENCE.allowedTags);
  const invalidTag = tags.find((item) => !tagSet.has(item));
  if (invalidTag !== undefined) throw new Error(`内容标签不在当前目录：${invalidTag}`);
  const protagonists = manualArray(root.protagonists, '主角');
  if (protagonists.length < 1 || protagonists.length > 2) throw new Error('主角需要1至2位');

  const normalized: OpeningPackage = {
    title: manualBoundedText(root.title, '书名', 2, 15),
    positioning: {
      publishingPlatform: normalizePublishingPlatform(positioning.publishingPlatform),
      channel,
      category,
      genres,
      tags,
      coreAppeal: manualText(positioning.coreAppeal, '核心看点', 800),
      expectedTotalWords: manualInteger(positioning.expectedTotalWords, '预计总字数', 100_000, 10_000_000),
      ...legacyPlanningFields(positioning)
    },
    backgrounds: {
      eraAndWorld: manualText(backgrounds.eraAndWorld, '时代与世界背景', 800),
      openingSituation: manualText(backgrounds.openingSituation, '开局直接背景', 800)
    },
    protagonists: protagonists.map((candidate, index) => {
      const item = manualRecord(candidate, `主角${index + 1}`);
      return {
        name: manualText(item.name, `主角${index + 1}姓名`, 100, true),
        age: manualText(item.age, `主角${index + 1}年龄或阶段`, 50, true),
        identity: manualText(item.identity, `主角${index + 1}身份`, 800),
        background: manualText(item.background, `主角${index + 1}经历`, 800, true),
        familyBackground: manualText(item.familyBackground ?? '', `主角${index + 1}家庭背景`, 800),
        careerBackground: manualText(item.careerBackground ?? '', `主角${index + 1}职业背景`, 800),
        goldenFinger: manualText(item.goldenFinger ?? '', `主角${index + 1}金手指`, 800),
        visualIdentity: manualVisualIdentity(item.visualIdentity, `主角${index + 1}`),
        goal: manualText(item.goal, `主角${index + 1}目标`, 800),
        dilemma: manualText(item.dilemma, `主角${index + 1}困境`, 800),
        personality: manualTextArray(item.personality, `主角${index + 1}性格`, 1, 12, 50),
        boundary: manualText(item.boundary, `主角${index + 1}边界`, 800)
      };
    }),
    opening: {
      startingSituation: manualText(opening.startingSituation, '开局处境', 800),
      incitingIncident: manualText(opening.incitingIncident, '触发事件', 800),
      immediateConflict: manualText(opening.immediateConflict, '眼前冲突', 800),
      readerPromise: manualText(opening.readerPromise, '读者承诺', 800)
    },
    longTermDirection: {
      centralConflict: manualText(longTermDirection.centralConflict, '长期核心矛盾', 800),
      progression: manualText(longTermDirection.progression, '成长方向', 800),
      relationshipDirection: manualText(longTermDirection.relationshipDirection, '关系方向', 800),
      storyPotential: manualText(longTermDirection.storyPotential, '持续创作空间', 800)
    },
    possibleEnding: {
      direction: manualText(possibleEnding.direction, '终点方向', 800),
      price: manualText(possibleEnding.price, '终点代价', 800),
      openness: manualText(possibleEnding.openness, '终点可调整空间', 800)
    },
    authorNotes: manualTextArray(root.authorNotes, '作者检查项', 0, 8, 500),
    mustFollow: manualTextArray(root.mustFollow ?? [], '必须遵守', 1, 15, 800)
  };
  const authorInstructions = manualTextArray(root.authorInstructions ?? [], '作者调整要求', 0, 8, 2_000);
  return authorInstructions.length === 0 ? normalized : { ...normalized, authorInstructions };
}

/** 作者提交的是待主编重做的草稿，不是可直接建书的正式资料，因此允许暂时留空。 */
export function validateV7OpeningRevisionDraft(
  value: unknown,
  fallback: OpeningPackage,
  authorInstructions: string[],
  allowedFields: string[]
): OpeningPackage {
  const root = manualRecord(value, '开书调整资料');
  const positioning = manualRecord(root.positioning, '作品定位');
  const backgrounds = manualRecord(root.backgrounds, '背景');
  const opening = manualRecord(root.opening, '开局');
  const longTermDirection = manualRecord(root.longTermDirection, '长期方向');
  const possibleEnding = manualRecord(root.possibleEnding, '可能终点');
  const channel = manualText(positioning.channel, '频道', 20) as OpeningPackage['positioning']['channel'];
  if (!['male', 'female', 'general'].includes(channel)) throw new Error('频道选择无效');
  const category = manualText(positioning.category, '作品分类', 100);
  if (category.length > 0 && channel !== 'general' && !V7_OPENING_TAXONOMY_REFERENCE.categories.some((item) => (
    item.channel === channel && item.name === category
  ))) throw new Error('作品分类不在当前目录');
  const genres = manualTextArray(positioning.genres, '融合题材', 0, 5, 50);
  const tags = manualTextArray(positioning.tags, '内容标签', 0, 12, 50);
  const protagonists = manualArray(root.protagonists, '主角');
  if (protagonists.length < 1 || protagonists.length > 2) throw new Error('主角需要1至2位');
  return {
    title: manualText(root.title, '书名', 15),
    positioning: {
      publishingPlatform: normalizePublishingPlatform(positioning.publishingPlatform ?? fallback.positioning.publishingPlatform),
      channel,
      category,
      genres,
      tags,
      coreAppeal: manualText(positioning.coreAppeal, '核心看点', 800),
      expectedTotalWords: manualInteger(positioning.expectedTotalWords ?? fallback.positioning.expectedTotalWords, '预计总字数', 100_000, 10_000_000),
      ...legacyPlanningFields(positioning, fallback.positioning)
    },
    backgrounds: {
      eraAndWorld: manualText(backgrounds.eraAndWorld, '时代与世界背景', 800),
      openingSituation: manualText(backgrounds.openingSituation, '开局直接背景', 800)
    },
    protagonists: protagonists.map((candidate, index) => {
      const item = manualRecord(candidate, `主角${index + 1}`);
      return {
        name: manualText(item.name, `主角${index + 1}姓名`, 100),
        age: manualText(item.age, `主角${index + 1}年龄`, 50),
        identity: manualText(item.identity, `主角${index + 1}身份`, 800),
        background: manualText(item.background, `主角${index + 1}经历`, 800),
        familyBackground: manualText(item.familyBackground ?? '', `主角${index + 1}家庭背景`, 800),
        careerBackground: manualText(item.careerBackground ?? '', `主角${index + 1}职业背景`, 800),
        goldenFinger: manualText(item.goldenFinger ?? '', `主角${index + 1}特殊能力`, 800),
        visualIdentity: manualVisualIdentity(item.visualIdentity, `主角${index + 1}`),
        goal: manualText(item.goal, `主角${index + 1}目标`, 800),
        dilemma: manualText(item.dilemma, `主角${index + 1}困境`, 800),
        personality: manualTextArray(item.personality, `主角${index + 1}性格`, 0, 12, 50),
        boundary: manualText(item.boundary, `主角${index + 1}边界`, 800)
      };
    }),
    opening: {
      startingSituation: manualText(opening.startingSituation, '开局处境', 800),
      incitingIncident: manualText(opening.incitingIncident, '触发事件', 800),
      immediateConflict: manualText(opening.immediateConflict, '眼前冲突', 800),
      readerPromise: manualText(opening.readerPromise, '读者承诺', 800)
    },
    longTermDirection: {
      centralConflict: manualText(longTermDirection.centralConflict, '长期核心矛盾', 800),
      progression: manualText(longTermDirection.progression, '成长方向', 800),
      relationshipDirection: manualText(longTermDirection.relationshipDirection, '关系方向', 800),
      storyPotential: manualText(longTermDirection.storyPotential, '持续创作空间', 800)
    },
    possibleEnding: {
      direction: manualText(possibleEnding.direction, '终点方向', 800),
      price: manualText(possibleEnding.price, '终点代价', 800),
      openness: manualText(possibleEnding.openness, '终点可调整空间', 800)
    },
    authorNotes: manualTextArray(root.authorNotes ?? [], '作者检查项', 0, 8, 500),
    mustFollow: manualTextArray(root.mustFollow ?? [], '必须遵守', 0, 15, 800),
    authorInstructions: authorInstructions.slice(0, 8),
    revisionDirective: {
      allowedFields: [...new Set(allowedFields)].slice(0, 80),
      authorMessages: authorInstructions.slice(0, 8)
    }
  };
}

export function openingPackageHash(value: OpeningPackage): string {
  return createHash('sha256').update(JSON.stringify(publicV7OpeningPackage(value))).digest('hex');
}

/**
 * 作者端只能看到并提交创作资料；编辑部用于约束返修范围的内部执行指令
 * 必须继续留在候选快照中，但不能参与作者内容一致性校验。
 */
export function publicV7OpeningPackage(value: OpeningPackage): OpeningPackage {
  const content = structuredClone(value);
  delete content.revisionDirective;
  return content;
}

export function toV7OpeningBlueprint(openingPackage: OpeningPackage, openingIdea: string): OpeningBlueprintInput {
  const channel = openingPackage.positioning.channel;
  if (channel === 'general') {
    throw new Error('作品频道必须从男频或女频中选择。');
  }
  const category = OPENING_TAXONOMY.categories.find((item) => (
    item.channel === channel && item.name === openingPackage.positioning.category
  ));
  if (category === undefined) {
    throw new Error('作品频道和分类不在当前开书目录，请重新选择。');
  }
  const protagonists = openingPackage.protagonists.map((item, index) => ({
    role: protagonistRole(channel, index),
    name: item.name,
    age: item.age,
    background: item.background,
    familyBackground: item.familyBackground ?? item.background,
    careerBackground: item.careerBackground ?? item.identity,
    goldenFinger: item.goldenFinger ?? '',
    ...(item.visualIdentity === undefined ? {} : { visualIdentity: item.visualIdentity }),
    personalities: [...item.personality]
  }));
  const mustFollow = openingPackage.protagonists
    .filter((item) => item.boundary.trim().length > 0)
    .map((item) => `${item.name}：${item.boundary}`);
  return {
    creationMode: 'new',
    openingIdea: limit(openingIdea, 2_000),
    taxonomyVersion: OPENING_TAXONOMY.version,
    channel,
    categoryKey: category.key,
    targetAudience: limit(openingPackage.positioning.targetReaders ?? '', 500),
    planningProfile: {
      publishingPlatform: openingPackage.positioning.publishingPlatform,
      expectedTotalWords: openingPackage.positioning.expectedTotalWords,
      ...(openingPackage.positioning.volumePlan === undefined ? {} : { volumePlan: { ...openingPackage.positioning.volumePlan } }),
      ...((openingPackage.positioning.targetReaders ?? '').trim().length === 0 ? {} : { commercialAudience: limit(openingPackage.positioning.targetReaders ?? '', 500) }),
      ...((openingPackage.positioning.retentionPositioning ?? '').trim().length === 0 ? {} : { retentionPositioning: limit(openingPackage.positioning.retentionPositioning ?? '', 800) })
    },
    protagonists,
    storyDirection: limit(openingPackage.longTermDirection.centralConflict, 800),
    openingStart: '',
    storyEnding: limit(openingPackage.possibleEnding.direction, 800),
    worldBackground: openingPackage.backgrounds.eraAndWorld,
    openingBackground: '',
    stageOne: {
      start: '',
      development: '',
      end: ''
    },
    fullBookOutline: limit([
      openingPackage.longTermDirection.centralConflict,
      openingPackage.possibleEnding.direction
    ].filter(Boolean).join('\n'), 4_000),
    mainTags: [...openingPackage.positioning.tags],
    auxiliaryTags: [...openingPackage.positioning.genres],
    storyTraits: [],
    styleIntent: {
      languageTones: [],
      emotionalTones: [],
      pacingAndPayoff: [],
      atmospheres: [],
      custom: []
    },
    customTags: [],
    initialMap: '',
    mustFollow: [...new Set([...(openingPackage.mustFollow ?? []), ...mustFollow])].length > 0
      ? [...new Set([...(openingPackage.mustFollow ?? []), ...mustFollow])]
      : ['作者原始开书思路不得被后续设计覆盖；未确认细节保持开放']
  };
}

function manualRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

function normalizePublishingPlatform(value: unknown): OpeningPackage['positioning']['publishingPlatform'] {
  if (value === undefined || value === null || value === '') return 'fanqie';
  if (value === 'fanqie' || value === 'qidian' || value === 'mainstream') return value;
  throw new Error('发布渠道选择无效');
}

function manualVisualIdentity(value: unknown, label: string): NonNullable<OpeningPackage['protagonists'][number]['visualIdentity']> {
  if (value === undefined || value === null) return { appearance: '', build: '', signatureFeature: '' };
  const item = manualRecord(value, `${label}视觉特征`);
  return {
    appearance: manualText(item.appearance ?? '', `${label}外貌`, 800),
    build: manualText(item.build ?? '', `${label}身形`, 800),
    signatureFeature: manualText(item.signatureFeature ?? '', `${label}醒目标志`, 800)
  };
}

function manualVolumePlan(value: unknown): NonNullable<OpeningPackage['positioning']['volumePlan']> {
  const item = manualRecord(value, '建议卷数');
  const minimum = manualInteger(item.minimum, '建议最少卷数', 1, 30);
  const recommended = manualInteger(item.recommended, '建议卷数', 1, 30);
  const maximum = manualInteger(item.maximum, '建议最多卷数', 1, 30);
  if (!(minimum <= recommended && recommended <= maximum)) throw new Error('建议卷数必须满足最少卷数≤建议卷数≤最多卷数');
  return { minimum, recommended, maximum };
}

function legacyPlanningFields(
  value: Record<string, unknown>,
  fallback?: OpeningPackage['positioning']
): Pick<OpeningPackage['positioning'], 'targetReaders' | 'volumePlan' | 'retentionPositioning'> {
  const targetReaders = manualText(value.targetReaders ?? fallback?.targetReaders ?? '', '商业受众', 500);
  const retentionPositioning = manualText(value.retentionPositioning ?? fallback?.retentionPositioning ?? '', '追读定位', 800);
  const volumePlanValue = value.volumePlan ?? fallback?.volumePlan;
  return {
    ...(targetReaders.length === 0 ? {} : { targetReaders }),
    ...(volumePlanValue === undefined || volumePlanValue === null ? {} : { volumePlan: manualVolumePlan(volumePlanValue) }),
    ...(retentionPositioning.length === 0 ? {} : { retentionPositioning })
  };
}

function manualInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label}必须是${minimum}至${maximum}之间的整数`);
  }
  return Number(value);
}

function manualArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`);
  return value;
}

function manualText(value: unknown, label: string, maximum: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是文字`);
  const result = value.trim();
  if (required && result.length === 0) throw new Error(`${label}不能为空`);
  if (Array.from(result).length > maximum) throw new Error(`${label}最多${maximum}字`);
  return result;
}

function manualBoundedText(value: unknown, label: string, minimum: number, maximum: number): string {
  const result = manualText(value, label, maximum, true);
  if (Array.from(result).length < minimum) throw new Error(`${label}至少需要${minimum}字`);
  return result;
}

function manualTextArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  itemMaximum: number
): string[] {
  const values = manualArray(value, label).map((item) => manualText(item, `${label}条目`, itemMaximum, true));
  const result = [...new Set(values)];
  if (result.length < minimum) throw new Error(`${label}至少需要${minimum}项`);
  if (result.length > maximum) throw new Error(`${label}最多${maximum}项`);
  return result;
}

function protagonistRole(channel: 'male' | 'female', index: number): ProtagonistRole {
  if (index > 0) return 'co_lead';
  return channel === 'female' ? 'female_lead' : 'male_lead';
}

function limit(value: string, maximum: number): string {
  return Array.from(value.trim()).slice(0, maximum).join('');
}
