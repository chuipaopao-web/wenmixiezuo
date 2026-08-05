import {
  parseStageMasterOutlineV2,
  type ChapterOutlineV2,
  type StageMasterOutlineStage
} from './artifact-schemas.js';

const CONTRACT_MARKER = '【章纲阶段边界合同JSON】';

interface StageBoundaryContract {
  stages: StageMasterOutlineStage[];
}

/**
 * Bind the fields that belong to the confirmed stage master on the server.
 *
 * The model may propose chapter-level execution details, but it must not
 * paraphrase, shorten or extend the selected stage range, resolution, result
 * or pending threads.  Those values are planning authority, not prose.
 */
export function bindChapterOutlineToAuthoritativeStage(
  chapter: ChapterOutlineV2,
  stage: StageMasterOutlineStage
): ChapterOutlineV2 {
  if (chapter.chapterNumber < stage.chapterRange.start
    || chapter.chapterNumber > stage.chapterRange.end) {
    throw new Error(`剧情总纲阶段《${stage.title}》不包含第${chapter.chapterNumber}章`);
  }
  const { stageBoundary: _modelStageBoundary, ...chapterWithoutBoundary } = chapter;
  return {
    ...chapterWithoutBoundary,
    sourceStage: {
      stageNumber: stage.stageNumber,
      title: stage.title,
      chapterRange: { ...stage.chapterRange }
    },
    ...(chapter.chapterNumber === stage.chapterRange.end
      ? {
          stageBoundary: {
            mustCloseStage: true as const,
            resolution: stage.mainline.resolution,
            result: stage.mainline.result,
            pendingThreads: [...stage.pendingThreads]
          }
        }
      : {})
  };
}

export function stageBoundaryContractLine(
  evidenceContext: Array<Record<string, unknown>>
): string | null {
  const source = evidenceContext.find((item) => item.sourceType === 'planning:master_outline');
  if (typeof source?.content !== 'string') return null;
  try {
    const master = parseStageMasterOutlineV2(JSON.parse(source.content) as Record<string, unknown>);
    return `${CONTRACT_MARKER}${JSON.stringify({ stages: master.majorStages } satisfies StageBoundaryContract)}`;
  } catch {
    return null;
  }
}

export function chapterOutlineStageBoundaryFailure(
  prompt: string,
  chapter: ChapterOutlineV2
): string | null {
  const contract = parseStageBoundaryContract(prompt);
  if (contract === null) return null;
  const stage = contract.stages.find((candidate) => (
    chapter.chapterNumber >= candidate.chapterRange.start
    && chapter.chapterNumber <= candidate.chapterRange.end
  ));
  if (stage === undefined) {
    return `阶段边界冲突：剧情总纲没有覆盖第${chapter.chapterNumber}章`;
  }
  if (chapter.sourceStage.stageNumber !== stage.stageNumber
    || normalize(chapter.sourceStage.title) !== normalize(stage.title)
    || chapter.sourceStage.chapterRange.start !== stage.chapterRange.start
    || chapter.sourceStage.chapterRange.end !== stage.chapterRange.end) {
    return `阶段边界冲突：第${chapter.chapterNumber}章引用的阶段编号、名称或范围与已确认剧情总纲不一致`;
  }
  if (chapter.chapterNumber !== stage.chapterRange.end) return null;
  const boundary = chapter.stageBoundary;
  if (boundary === undefined || boundary.mustCloseStage !== true) {
    return `阶段边界冲突：第${chapter.chapterNumber}章是《${stage.title}》终章，必须提交阶段闭环合同`;
  }
  if (normalize(boundary.resolution) !== normalize(stage.mainline.resolution)
    || normalize(boundary.result) !== normalize(stage.mainline.result)) {
    return `阶段边界冲突：第${chapter.chapterNumber}章没有原样承接剧情总纲确认的解决方式和阶段结果`;
  }
  if (!sameTextSet(boundary.pendingThreads, stage.pendingThreads)) {
    return `阶段边界冲突：第${chapter.chapterNumber}章保留的未决线索与剧情总纲不一致`;
  }
  const narrative = JSON.stringify({
    chapterFunction: chapter.chapterFunction,
    requiredEndingState: chapter.requiredEndingState,
    plotBeats: chapter.plotBeats,
    ending: chapter.ending,
    mustImplement: chapter.mustImplement,
    mustNotViolate: chapter.mustNotViolate
  });
  const antiClosure = /(?:尚未|仍未|未能|未完成|未解决|未闭合|不闭合|不得闭合|不解决|不得解决|不完成|不得完成|不恢复|不得恢复)[^。；\n]{0,36}(?:阶段|事件|主线|证据链|真相|身份|资格|问题|危机|目标)/u;
  if (antiClosure.test(narrative)) {
    return `阶段边界冲突：第${chapter.chapterNumber}章仍把本阶段主事件写成未完成状态`;
  }
  return null;
}

function parseStageBoundaryContract(prompt: string): StageBoundaryContract | null {
  const markerIndex = prompt.lastIndexOf(CONTRACT_MARKER);
  if (markerIndex < 0) return null;
  const line = prompt.slice(markerIndex + CONTRACT_MARKER.length).split(/\r?\n/u, 1)[0]?.trim();
  if (line === undefined || line.length === 0) return null;
  try {
    const value = JSON.parse(line) as { stages?: unknown };
    if (!Array.isArray(value.stages)) return null;
    return {
      stages: parseStageMasterOutlineV2({
        outlineSchema: 'stage_master_v2',
        premise: '边界校验',
        coreConflict: '边界校验',
        protagonistArc: '边界校验',
        majorStages: value.stages,
        endingDirection: '边界校验',
        storyPromises: [],
        openQuestions: []
      }).majorStages
    };
  } catch {
    return parseContractStagesWithoutWholeOutline(line);
  }
}

function parseContractStagesWithoutWholeOutline(line: string): StageBoundaryContract | null {
  try {
    const value = JSON.parse(line) as { stages?: StageMasterOutlineStage[] };
    if (!Array.isArray(value.stages)) return null;
    return { stages: value.stages };
  } catch {
    return null;
  }
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, '').trim();
}

function sameTextSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left.map(normalize))].sort();
  const b = [...new Set(right.map(normalize))].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
