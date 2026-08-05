type UnknownRecord = Record<string, unknown>;

const REALISM_BOUNDARY = /(?:不(?:得|应|要|能|可|出现|使用|引入|包含)?|禁止|拒绝|避免|无)[^。；\n]{0,24}(?:超自然|灵异|魔法|异能|万能黑客|系统金手指)/u;

const DIRECT_SUPERNATURAL_MARKERS = [
  '超自然',
  '灵异力量',
  '魔法',
  '异能',
  '记忆实体化',
  '系统金手指'
] as const;

const UNEXPLAINED_RULE_ENGINE_MARKERS = [
  '违约线',
  '归还任务',
  '任务界面',
  '规则页',
  '等价载体',
  '接受延期',
  '交换物件换延期',
  '交出物件换延期',
  '系统惩罚'
] as const;

/**
 * This is deliberately a narrow hard-boundary guard, not a genre classifier.
 * It only activates when the owner/model has explicitly stated that supernatural
 * mechanisms are forbidden. Soft preferences and ordinary creative choices are
 * intentionally left to the writers and reviewers.
 */
export function chapterOutlineHardBoundaryFailure(
  scopeText: string,
  chapter: unknown
): string | null {
  if (!isRecord(chapter)) return null;
  const declaredBoundaries = [
    scopeText,
    ...textList(chapter.mustNotViolate)
  ].join('\n');
  if (!REALISM_BOUNDARY.test(declaredBoundaries)) return null;

  const narrative = JSON.stringify({
    title: chapter.title,
    chapterFunction: chapter.chapterFunction,
    openingState: chapter.openingState,
    requiredEndingState: chapter.requiredEndingState,
    cast: chapter.cast,
    conflict: chapter.conflict,
    plotBeats: chapter.plotBeats,
    informationControl: chapter.informationControl,
    threadActions: chapter.threadActions,
    ending: chapter.ending
  });

  const direct = DIRECT_SUPERNATURAL_MARKERS.find((marker) => narrative.includes(marker));
  if (direct !== undefined) {
    return `硬边界冲突：已明确禁止超自然机制，但章纲正文仍出现“${direct}”`;
  }

  const ruleMarkers = UNEXPLAINED_RULE_ENGINE_MARKERS.filter((marker) => narrative.includes(marker));
  const selfActingInterface = /(?:界面|页面|系统|归还单)[^。；\n]{0,40}(?:自行|自动|强制|惩罚|核验|触发|倒计时)/u.test(narrative);
  if (ruleMarkers.length >= 2 || (ruleMarkers.length >= 1 && selfActingInterface)) {
    return `硬边界冲突：现实题材章纲引入了未经设定确认的规则引擎（${ruleMarkers.join('、') || '界面自行裁决'}）`;
  }
  return null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
