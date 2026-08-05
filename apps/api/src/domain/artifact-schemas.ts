export type ArtifactType = 'creative_plan' | 'story_bible' | 'master_outline' | 'volume_outline' | 'chapter_outline' | 'writing_contract';

export interface StageMasterOutlineStage {
  detailSchema?: 'stage_detail_v1';
  stageNumber: number;
  title: string;
  chapterRange: {
    start: number;
    end: number;
  };
  mainline: {
    encounter: string;
    resolution: string;
    result: string;
  };
  structure: {
    setup: string;
    development: string;
    turn: string;
    conclusion: string;
  };
  stageSummary: string;
  pendingThreads: string[];
  followUpDirection: string;
  cast?: Array<{ name: string; stageRole: string; objective: string; stateChange?: string }>;
  chapterBlocks?: Array<{ start: number; end: number; summary: string; estimatedWords: number }>;
  estimatedWords?: number;
  experience?: { emotionalArc: string[]; payoffPoints: string[]; pressurePoints: string[] };
  turningPoints?: string[];
  foreshadowing?: Array<{
    summary: string;
    action: 'plant' | 'advance' | 'payoff';
    releaseWindow: string;
  }>;
}

export interface StageMasterOutlineV2 {
  outlineSchema: 'stage_master_v2';
  premise: string;
  coreConflict: string;
  protagonistArc: string;
  majorStages: StageMasterOutlineStage[];
  endingDirection: string;
  storyPromises: string[];
  openQuestions: string[];
}

export interface ChapterOutlineV2CastMember {
  name: string;
  objective: string;
  knowledgeBoundary: string;
  chapterRole: string;
  stateChange?: string;
}

export interface ChapterOutlineV2Beat {
  order: number;
  trigger: string;
  action: string;
  resistance?: string;
  turn?: string;
  result: string;
}

export interface ChapterOutlineV2 {
  outlineSchema: 'chapter_outline_v2';
  chapterNumber: number;
  title: string;
  sourceStage: {
    stageNumber: number;
    title: string;
    chapterRange: { start: number; end: number };
  };
  stageBoundary?: {
    mustCloseStage: boolean;
    resolution: string;
    result: string;
    pendingThreads: string[];
  };
  chapterFunction: string;
  openingState: string;
  requiredEndingState: string;
  cast: ChapterOutlineV2CastMember[];
  conflict: {
    surface: string;
    underlying?: string;
    oppositionGoal?: string;
    failureCost: string;
    successCost?: string;
  };
  plotBeats: ChapterOutlineV2Beat[];
  experience?: {
    primaryTone?: string;
    emotionalCurve: string[];
    payoffPoints: string[];
    pressurePoints: string[];
    readerEffect?: string;
  };
  descriptionFocus?: {
    primary: string[];
    secondary: string[];
    compress: string[];
  };
  informationControl?: {
    reveals: string[];
    concealed: string[];
    gaps: string[];
  };
  threadActions: Array<{
    action: 'plant' | 'advance' | 'payoff';
    threadId?: string;
    summary: string;
  }>;
  ending: {
    result: string;
    stateChanges: string[];
    hook: string;
    nextChapterInterface: string;
  };
  mustImplement: string[];
  mustNotViolate: string[];
  allowedCandidates: string[];
  creativeFreedom: string[];
}

const requiredKeys: Record<ArtifactType, string[]> = {
  creative_plan: ['premise', 'audience', 'tone', 'constraints'],
  story_bible: ['title', 'positioning', 'worldRules', 'characters', 'mainPlot'],
  master_outline: ['premise', 'endingDirection'],
  volume_outline: ['volumeNumber', 'goal', 'arcs', 'endingState'],
  chapter_outline: ['chapterNumber', 'goal', 'beats', 'hook'],
  writing_contract: ['chapterId', 'pov', 'tense', 'targetWords', 'hardConstraints']
};

export function validateArtifactContent(type: ArtifactType, content: Record<string, unknown>): void {
  if (type === 'chapter_outline' && content.outlineSchema !== undefined) {
    parseChapterOutlineV2(content);
    return;
  }
  const missing = requiredKeys[type].filter((key) => !(key in content));
  if (missing.length > 0) throw new Error(`${type}缺少必填字段：${missing.join(', ')}`);
  if (type === 'master_outline') {
    if (content.outlineSchema !== undefined) {
      parseStageMasterOutlineV2(content);
      return;
    }
    const hasLegacyActs = Array.isArray(content.acts);
    const hasCurrentStages = Array.isArray(content.majorStages);
    if (!hasLegacyActs && !hasCurrentStages) {
      throw new Error('master_outline缺少必填字段：majorStages');
    }
    if (hasCurrentStages) {
      const currentMissing = ['coreConflict', 'protagonistArc']
        .filter((key) => typeof content[key] !== 'string' || String(content[key]).trim().length === 0);
      if (currentMissing.length > 0) {
        throw new Error(`master_outline缺少必填字段：${currentMissing.join(', ')}`);
      }
    }
  }
  if (type === 'writing_contract') {
    const targetWords = content.targetWords;
    if (!Number.isInteger(targetWords) || Number(targetWords) < 500) throw new Error('写作契约targetWords必须是不小于500的整数');
  }
}

export function parseChapterOutlineV2(content: Record<string, unknown>): ChapterOutlineV2 {
  if (content.outlineSchema !== 'chapter_outline_v2') {
    throw new Error('章纲缺少有效的分层结构版本');
  }
  if (!Number.isInteger(content.chapterNumber) || Number(content.chapterNumber) < 1) {
    throw new Error('章纲缺少有效章号');
  }
  const chapterNumber = Number(content.chapterNumber);
  const sourceStage = requiredRecord(content.sourceStage, '章纲缺少对应剧情总纲阶段');
  const stageNumber = sourceStage.stageNumber;
  const chapterRange = requiredRecord(sourceStage.chapterRange, '章纲缺少剧情总纲阶段章节范围');
  if (!Number.isInteger(stageNumber) || Number(stageNumber) < 1
    || !Number.isInteger(chapterRange.start) || !Number.isInteger(chapterRange.end)
    || Number(chapterRange.start) < 1 || Number(chapterRange.end) < Number(chapterRange.start)
    || chapterNumber < Number(chapterRange.start) || chapterNumber > Number(chapterRange.end)) {
    throw new Error('章纲引用的剧情总纲阶段范围无效或不包含当前章');
  }
  if (!Array.isArray(content.cast) || content.cast.length < 1 || content.cast.length > 12) {
    throw new Error('章纲必须包含一至十二名本章出场人物');
  }
  const cast = content.cast.map((candidate, index): ChapterOutlineV2CastMember => {
    const item = requiredRecord(candidate, `章纲第${index + 1}名出场人物格式无效`);
    const stateChange = optionalText(item.stateChange);
    return {
      name: requiredChapterText(item.name, `第${index + 1}名人物姓名`),
      objective: requiredChapterText(item.objective, `第${index + 1}名人物当前目标`),
      knowledgeBoundary: requiredChapterText(item.knowledgeBoundary, `第${index + 1}名人物知识边界`),
      chapterRole: requiredChapterText(item.chapterRole, `第${index + 1}名人物本章作用`),
      ...(stateChange === undefined ? {} : { stateChange })
    };
  });
  const conflict = requiredRecord(content.conflict, '章纲缺少核心冲突');
  if (!Array.isArray(content.plotBeats) || content.plotBeats.length < 3 || content.plotBeats.length > 5) {
    throw new Error('章纲必须包含三至五个剧情推进节点');
  }
  const plotBeats = content.plotBeats.map((candidate, index): ChapterOutlineV2Beat => {
    const item = requiredRecord(candidate, `章纲第${index + 1}个推进节点格式无效`);
    if (!Number.isInteger(item.order) || Number(item.order) !== index + 1) {
      throw new Error('章纲推进节点编号必须从一连续递增');
    }
    const resistance = optionalText(item.resistance);
    const turn = optionalText(item.turn);
    return {
      order: Number(item.order),
      trigger: requiredChapterText(item.trigger, `第${index + 1}个推进节点触发`),
      action: requiredChapterText(item.action, `第${index + 1}个推进节点行动`),
      ...(resistance === undefined ? {} : { resistance }),
      ...(turn === undefined ? {} : { turn }),
      result: requiredChapterText(item.result, `第${index + 1}个推进节点结果`)
    };
  });
  const ending = requiredRecord(content.ending, '章纲缺少章末闭环');
  const experience = content.experience === undefined ? undefined : parseExperience(content.experience);
  const descriptionFocus = content.descriptionFocus === undefined
    ? undefined
    : parseDescriptionFocus(content.descriptionFocus);
  const informationControl = content.informationControl === undefined
    ? undefined
    : parseInformationControl(content.informationControl);
  const threadActions = content.threadActions === undefined
    ? []
    : parseThreadActions(content.threadActions);
  const stageBoundary = content.stageBoundary === undefined
    ? undefined
    : parseChapterStageBoundary(content.stageBoundary);
  const mustImplement = requiredTextList(content.mustImplement, '章纲必须实现', 1);
  const mustNotViolate = requiredTextList(content.mustNotViolate, '章纲不得违反', 1);
  const creativeFreedom = requiredTextList(content.creativeFreedom, '章纲自由创作区', 1);

  return {
    outlineSchema: 'chapter_outline_v2',
    chapterNumber,
    title: requiredChapterText(content.title, '章名'),
    sourceStage: {
      stageNumber: Number(stageNumber),
      title: requiredChapterText(sourceStage.title, '剧情总纲阶段名称'),
      chapterRange: { start: Number(chapterRange.start), end: Number(chapterRange.end) }
    },
    ...(stageBoundary === undefined ? {} : { stageBoundary }),
    chapterFunction: requiredChapterText(content.chapterFunction, '本章功能'),
    openingState: requiredChapterText(content.openingState, '开场状态'),
    requiredEndingState: requiredChapterText(content.requiredEndingState, '必须结束状态'),
    cast,
    conflict: {
      surface: requiredChapterText(conflict.surface, '表层冲突'),
      ...optionalProperty('underlying', conflict.underlying),
      ...optionalProperty('oppositionGoal', conflict.oppositionGoal),
      failureCost: requiredChapterText(conflict.failureCost, '失败代价'),
      ...optionalProperty('successCost', conflict.successCost)
    },
    plotBeats,
    ...(experience === undefined ? {} : { experience }),
    ...(descriptionFocus === undefined ? {} : { descriptionFocus }),
    ...(informationControl === undefined ? {} : { informationControl }),
    threadActions,
    ending: {
      result: requiredChapterText(ending.result, '章末结果'),
      stateChanges: optionalTextList(ending.stateChanges, '章末状态变化', 8),
      hook: requiredChapterText(ending.hook, '章末钩子'),
      nextChapterInterface: requiredChapterText(ending.nextChapterInterface, '下一章接口')
    },
    mustImplement,
    mustNotViolate,
    allowedCandidates: optionalTextList(content.allowedCandidates, '允许新增候选', 8),
    creativeFreedom
  };
}

function parseChapterStageBoundary(value: unknown): NonNullable<ChapterOutlineV2['stageBoundary']> {
  const boundary = requiredRecord(value, '阶段终章闭环合同格式无效');
  if (boundary.mustCloseStage !== true) {
    throw new Error('阶段终章闭环合同必须明确要求完成当前阶段');
  }
  return {
    mustCloseStage: true,
    resolution: requiredChapterText(boundary.resolution, '阶段终章解决方式'),
    result: requiredChapterText(boundary.result, '阶段终章结果'),
    pendingThreads: optionalTextList(boundary.pendingThreads, '阶段终章保留伏笔', 12)
  };
}

export function parseStageMasterOutlineV2(content: Record<string, unknown>): StageMasterOutlineV2 {
  if (content.outlineSchema !== 'stage_master_v2') {
    throw new Error('剧情总纲缺少有效的阶段式结构版本');
  }
  const premise = requiredText(content.premise, '核心前提');
  const coreConflict = requiredText(content.coreConflict, '核心冲突');
  const protagonistArc = requiredText(content.protagonistArc, '主角成长线');
  const endingDirection = requiredText(content.endingDirection, '结局方向');
  if (!Array.isArray(content.majorStages) || content.majorStages.length < 1) {
    throw new Error('剧情总纲必须包含至少一个完整剧情阶段');
  }

  let previousEnd = 0;
  const majorStages = content.majorStages.map((candidate, index): StageMasterOutlineStage => {
    if (!isRecord(candidate)) throw new Error(`剧情总纲第${index + 1}个阶段格式无效`);
    const stageNumber = candidate.stageNumber;
    if (!Number.isInteger(stageNumber) || Number(stageNumber) !== index + 1) {
      throw new Error(`剧情总纲第${index + 1}个阶段编号必须连续`);
    }
    if (!isRecord(candidate.chapterRange)) {
      throw new Error(`剧情总纲第${index + 1}个阶段缺少章节范围`);
    }
    const start = candidate.chapterRange.start;
    const end = candidate.chapterRange.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 1 || Number(end) < Number(start)) {
      throw new Error(`剧情总纲第${index + 1}个阶段章节范围无效`);
    }
    if (Number(end) - Number(start) + 1 > 50) {
      throw new Error(`剧情总纲第${index + 1}个阶段不能超过50章`);
    }
    if (Number(start) !== previousEnd + 1) {
      throw new Error(`剧情总纲第${index + 1}个阶段必须紧接上一阶段，不能重叠或留空`);
    }
    previousEnd = Number(end);
    if (!isRecord(candidate.mainline)) {
      throw new Error(`剧情总纲第${index + 1}个阶段缺少主线遭遇、解决方式或阶段结果`);
    }
    if ([candidate.mainline.encounter, candidate.mainline.resolution, candidate.mainline.result]
      .some((item) => typeof item !== 'string' || item.trim().length === 0)) {
      throw new Error(`剧情总纲第${index + 1}个阶段缺少主线遭遇、解决方式或阶段结果`);
    }
    if (!isRecord(candidate.structure)) {
      throw new Error(`剧情总纲第${index + 1}个阶段缺少起承转合`);
    }
    const pendingThreads = textArray(candidate.pendingThreads, `剧情总纲第${index + 1}个阶段的待回收信息与伏笔`);
    const detail = candidate.detailSchema === 'stage_detail_v1'
      ? parseStageDetail(candidate, Number(start), Number(end), index)
      : {};
    return {
      ...detail,
      stageNumber: Number(stageNumber),
      title: requiredText(candidate.title, `第${index + 1}阶段标题`),
      chapterRange: { start: Number(start), end: Number(end) },
      mainline: {
        encounter: requiredText(candidate.mainline.encounter, `第${index + 1}阶段主线遭遇`),
        resolution: requiredText(candidate.mainline.resolution, `第${index + 1}阶段解决方式`),
        result: requiredText(candidate.mainline.result, `第${index + 1}阶段结果`)
      },
      structure: {
        setup: requiredText(candidate.structure.setup, `第${index + 1}阶段起`),
        development: requiredText(candidate.structure.development, `第${index + 1}阶段承`),
        turn: requiredText(candidate.structure.turn, `第${index + 1}阶段转`),
        conclusion: requiredText(candidate.structure.conclusion, `第${index + 1}阶段合`)
      },
      stageSummary: requiredText(candidate.stageSummary, `第${index + 1}阶段总结`),
      pendingThreads,
      followUpDirection: requiredText(candidate.followUpDirection, `第${index + 1}阶段后续方向`)
    };
  });

  return {
    outlineSchema: 'stage_master_v2',
    premise,
    coreConflict,
    protagonistArc,
    majorStages,
    endingDirection,
    storyPromises: textArray(content.storyPromises, '作品承诺'),
    openQuestions: textArray(content.openQuestions, '开放问题')
  };
}

function parseStageDetail(
  candidate: Record<string, unknown>,
  stageStart: number,
  stageEnd: number,
  index: number
): Pick<StageMasterOutlineStage, 'detailSchema' | 'cast' | 'chapterBlocks' | 'estimatedWords' | 'experience' | 'turningPoints' | 'foreshadowing'> {
  if (!Array.isArray(candidate.cast) || candidate.cast.length < 1) {
    throw new Error(`剧情总纲第${index + 1}个阶段缺少出场人物`);
  }
  const cast = candidate.cast.map((item, castIndex) => {
    if (!isRecord(item)) throw new Error(`剧情总纲第${index + 1}个阶段第${castIndex + 1}名人物格式无效`);
    const stateChange = typeof item.stateChange === 'string' && item.stateChange.trim().length > 0
      ? item.stateChange.trim()
      : undefined;
    return {
      name: requiredText(item.name, `第${index + 1}阶段人物姓名`),
      stageRole: requiredText(item.stageRole, `第${index + 1}阶段人物作用`),
      objective: requiredText(item.objective, `第${index + 1}阶段人物目标`),
      ...(stateChange === undefined ? {} : { stateChange })
    };
  });
  if (!Array.isArray(candidate.chapterBlocks) || candidate.chapterBlocks.length < 1) {
    throw new Error(`剧情总纲第${index + 1}个阶段缺少章节内容安排`);
  }
  let previousEnd = stageStart - 1;
  const chapterBlocks = candidate.chapterBlocks.map((item, blockIndex) => {
    if (!isRecord(item)) throw new Error(`剧情总纲第${index + 1}个阶段第${blockIndex + 1}个章节段格式无效`);
    const start = Number(item.start);
    const end = Number(item.end);
    const estimatedWords = Number(item.estimatedWords);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start !== previousEnd + 1 || end < start || end > stageEnd) {
      throw new Error(`剧情总纲第${index + 1}个阶段章节内容安排必须连续且位于阶段范围内`);
    }
    if (!Number.isInteger(estimatedWords) || estimatedWords < 1) {
      throw new Error(`剧情总纲第${index + 1}个阶段章节段字数预估无效`);
    }
    previousEnd = end;
    return { start, end, estimatedWords, summary: requiredText(item.summary, `第${index + 1}阶段章节段内容`) };
  });
  if (previousEnd !== stageEnd) throw new Error(`剧情总纲第${index + 1}个阶段章节内容安排未覆盖完整阶段`);
  const estimatedWords = Number(candidate.estimatedWords);
  if (!Number.isInteger(estimatedWords) || estimatedWords < 1) throw new Error(`剧情总纲第${index + 1}个阶段总字数预估无效`);
  if (!isRecord(candidate.experience)) throw new Error(`剧情总纲第${index + 1}个阶段缺少读者体验设计`);
  const experience = {
    emotionalArc: textArray(candidate.experience.emotionalArc, `第${index + 1}阶段情绪曲线`),
    payoffPoints: textArray(candidate.experience.payoffPoints, `第${index + 1}阶段爽点`),
    pressurePoints: textArray(candidate.experience.pressurePoints, `第${index + 1}阶段压力或虐点`)
  };
  const foreshadowing = Array.isArray(candidate.foreshadowing) ? candidate.foreshadowing.map((item, threadIndex) => {
    if (!isRecord(item) || !['plant', 'advance', 'payoff'].includes(String(item.action))) {
      throw new Error(`剧情总纲第${index + 1}个阶段第${threadIndex + 1}条伏笔格式无效`);
    }
    return {
      summary: requiredText(item.summary, `第${index + 1}阶段伏笔`),
      action: item.action as 'plant' | 'advance' | 'payoff',
      releaseWindow: requiredText(item.releaseWindow, `第${index + 1}阶段伏笔释放周期`)
    };
  }) : [];
  return {
    detailSchema: 'stage_detail_v1',
    cast,
    chapterBlocks,
    estimatedWords,
    experience,
    turningPoints: textArray(candidate.turningPoints, `第${index + 1}阶段转折`),
    foreshadowing
  };
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`剧情总纲缺少${label}`);
  }
  return value.trim();
}

function textArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label}必须是文本列表`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function parseExperience(value: unknown): NonNullable<ChapterOutlineV2['experience']> {
  const item = requiredRecord(value, '章纲体验提示格式无效');
  return {
    ...optionalProperty('primaryTone', item.primaryTone),
    emotionalCurve: optionalTextList(item.emotionalCurve, '情绪变化', 5),
    payoffPoints: optionalTextList(item.payoffPoints, '爽点', 2),
    pressurePoints: optionalTextList(item.pressurePoints, '压力或虐点', 2),
    ...optionalProperty('readerEffect', item.readerEffect)
  };
}

function parseDescriptionFocus(value: unknown): NonNullable<ChapterOutlineV2['descriptionFocus']> {
  if (Array.isArray(value)) {
    return {
      primary: optionalTextList(value, '主要描写', 5),
      secondary: [],
      compress: []
    };
  }
  const item = requiredRecord(value, '章纲描写重点格式无效');
  return {
    primary: optionalTextList(item.primary, '主要描写', 5),
    secondary: optionalTextList(item.secondary, '次要描写', 5),
    compress: optionalTextList(item.compress, '压缩描写', 5)
  };
}

function parseInformationControl(value: unknown): NonNullable<ChapterOutlineV2['informationControl']> {
  if (Array.isArray(value)) {
    return {
      reveals: [],
      concealed: [],
      gaps: optionalTextList(value, '本章信息差', 5)
    };
  }
  const item = requiredRecord(value, '章纲信息控制格式无效');
  const canonicalKeys = ['reveals', 'concealed', 'gaps'];
  if (!canonicalKeys.some((key) => key in item)) {
    const groupedBoundaries = Object.entries(item).map(([entity, boundaries]) => {
      const statements = optionalTextList(boundaries, `${entity}的知情边界`, 12);
      return `${entity}：${statements.join('；')}`;
    });
    return {
      reveals: [],
      concealed: [],
      gaps: compactTextGroups(groupedBoundaries, 5)
    };
  }
  return {
    reveals: optionalTextList(item.reveals, '本章揭示', 5),
    concealed: optionalTextList(item.concealed, '本章保留', 5),
    gaps: optionalTextList(item.gaps, '本章信息差', 5)
  };
}

function compactTextGroups(items: string[], maximum: number): string[] {
  if (items.length <= maximum) return items;
  return [
    ...items.slice(0, maximum - 1),
    items.slice(maximum - 1).join('；')
  ];
}

function parseThreadActions(value: unknown): ChapterOutlineV2['threadActions'] {
  if (!Array.isArray(value) || value.length > 2) {
    throw new Error('章纲伏笔动作最多两项');
  }
  return value.map((candidate, index) => {
    const item = requiredRecord(candidate, `章纲第${index + 1}个伏笔动作格式无效`);
    if (!['plant', 'advance', 'payoff'].includes(String(item.action))) {
      throw new Error('章纲伏笔动作只能是埋设、推进或回收');
    }
    const threadId = optionalText(item.threadId);
    return {
      action: item.action as 'plant' | 'advance' | 'payoff',
      ...(threadId === undefined ? {} : { threadId }),
      summary: requiredChapterText(item.summary, `第${index + 1}个伏笔动作说明`)
    };
  });
}

function requiredChapterText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`章纲缺少${label}`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalProperty<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  const text = optionalText(value);
  return text === undefined ? {} : { [key]: text } as Record<Key, string>;
}

function requiredTextList(value: unknown, label: string, minimum: number): string[] {
  const items = optionalTextList(value, label, 12);
  if (items.length < minimum) throw new Error(`${label}至少需要${minimum}项`);
  return items;
}

function optionalTextList(value: unknown, label: string, maximum: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label}必须是文本列表`);
  }
  const items = value.map((item) => item.trim()).filter(Boolean);
  if (items.length > maximum) throw new Error(`${label}最多${maximum}项`);
  return items;
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
