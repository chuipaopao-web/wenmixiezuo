export type ArtifactType = 'creative_plan' | 'story_bible' | 'master_outline' | 'volume_outline' | 'chapter_outline' | 'writing_contract';

export interface StageMasterOutlineStage {
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

const requiredKeys: Record<ArtifactType, string[]> = {
  creative_plan: ['premise', 'audience', 'tone', 'constraints'],
  story_bible: ['title', 'positioning', 'worldRules', 'characters', 'mainPlot'],
  master_outline: ['premise', 'endingDirection'],
  volume_outline: ['volumeNumber', 'goal', 'arcs', 'endingState'],
  chapter_outline: ['chapterNumber', 'goal', 'beats', 'hook'],
  writing_contract: ['chapterId', 'pov', 'tense', 'targetWords', 'hardConstraints']
};

export function validateArtifactContent(type: ArtifactType, content: Record<string, unknown>): void {
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

export function parseStageMasterOutlineV2(content: Record<string, unknown>): StageMasterOutlineV2 {
  if (content.outlineSchema !== 'stage_master_v2') {
    throw new Error('剧情总纲缺少有效的阶段式结构版本');
  }
  const premise = requiredText(content.premise, '核心前提');
  const coreConflict = requiredText(content.coreConflict, '核心冲突');
  const protagonistArc = requiredText(content.protagonistArc, '主角成长线');
  const endingDirection = requiredText(content.endingDirection, '结局方向');
  if (!Array.isArray(content.majorStages) || content.majorStages.length < 2) {
    throw new Error('剧情总纲必须包含至少两个全书推进阶段');
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
    return {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
