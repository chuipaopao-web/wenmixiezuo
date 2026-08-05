import {
  parseChapterOutlineV2,
  type ChapterOutlineV2
} from '../../domain/artifact-schemas.js';

export function compileChapterOutlineForWriter(
  content: Record<string, unknown>,
  maximumCharacters = 1_350
): string {
  const outline = parseChapterOutlineV2(content);
  const hardSections = compileEssentialSections(outline);
  const hardText = hardSections.join('\n');
  if (hardText.length > maximumCharacters) {
    throw new Error(`章纲硬信息超过${maximumCharacters}字，不能静默截断；请由主编收缩重复信息`);
  }
  const selected = [...hardSections];
  for (const optional of compileEnhancementSections(outline)) {
    if (optional.length === 0) continue;
    const candidate = [...selected, optional].join('\n');
    if (candidate.length <= maximumCharacters) selected.push(optional);
  }
  return selected.join('\n');
}

function compileEssentialSections(outline: ChapterOutlineV2): string[] {
  const stage = outline.sourceStage;
  const cast = outline.cast.map((member) => {
    return `- ${member.name}：目标${member.objective}；知情边界${member.knowledgeBoundary}`;
  }).join('\n');
  const conflictDetails = [
    `表层：${outline.conflict.surface}`,
    `失败代价：${outline.conflict.failureCost}`,
    outline.conflict.successCost === undefined ? '' : `成功代价：${outline.conflict.successCost}`
  ].filter(Boolean).join('；');
  const beats = outline.plotBeats.map((beat) => {
    return `${beat.order}. 行动：${beat.action}；结果：${beat.result}`;
  }).join('\n');
  const ending = [
    `钩子：${outline.ending.hook}`,
    `下一章接口：${outline.ending.nextChapterInterface}`
  ].filter(Boolean).join('；');
  const stageBoundary = outline.stageBoundary === undefined ? '' : [
    '阶段终章硬要求：必须在本章完成当前阶段主事件',
    `解决方式：${outline.stageBoundary.resolution}`,
    `阶段结果：${outline.stageBoundary.result}`,
    outline.stageBoundary.pendingThreads.length === 0
      ? '阶段结算后不保留未决线索'
      : `仅可保留：${outline.stageBoundary.pendingThreads.join('；')}`
  ].join('；');
  return [
    `第${outline.chapterNumber}章《${outline.title}》`,
    `对应总纲：第${stage.stageNumber}阶段《${stage.title}》（第${stage.chapterRange.start}—${stage.chapterRange.end}章）`,
    `本章功能：${outline.chapterFunction}`,
    `开场状态：${outline.openingState}`,
    `必须结束状态：${outline.requiredEndingState}`,
    `人物与当下状态：\n${cast}`,
    `核心冲突：${conflictDetails}`,
    `剧情推进：\n${beats}`,
    `章末闭环：${ending}`,
    stageBoundary,
    `必须实现：${outline.mustImplement.join('；')}`,
    `不得违反：${outline.mustNotViolate.join('；')}`
  ];
}

function compileEnhancementSections(outline: ChapterOutlineV2): string[] {
  const castEnhancements = outline.cast.flatMap((member) => {
    const items = [`${member.name}本章作用：${member.chapterRole}`];
    if (member.stateChange !== undefined) items.push(`${member.name}状态变化：${member.stateChange}`);
    return items;
  });
  const conflictEnhancements = [
    outline.conflict.underlying === undefined ? '' : `深层冲突：${outline.conflict.underlying}`,
    outline.conflict.oppositionGoal === undefined ? '' : `对手目标：${outline.conflict.oppositionGoal}`
  ];
  const beatEnhancements = outline.plotBeats.flatMap((beat) => [
    `节点${beat.order}触发：${beat.trigger}`,
    beat.resistance === undefined ? '' : `节点${beat.order}阻力：${beat.resistance}`,
    beat.turn === undefined ? '' : `节点${beat.order}转折：${beat.turn}`
  ]);
  const endingEnhancements = [
    `章末结果补充：${outline.ending.result}`,
    outline.ending.stateChanges.length === 0 ? '' : `章末状态变化：${outline.ending.stateChanges.join('；')}`
  ];
  const experience = outline.experience;
  const experienceText = experience === undefined ? '' : [
    experience.primaryTone === undefined ? '' : `主情绪：${experience.primaryTone}`,
    experience.emotionalCurve.length === 0 ? '' : `情绪变化：${experience.emotionalCurve.join('→')}`,
    experience.payoffPoints.length === 0 ? '' : `爽点：${experience.payoffPoints.join('；')}`,
    experience.pressurePoints.length === 0 ? '' : `压力/虐点：${experience.pressurePoints.join('；')}`,
    experience.readerEffect === undefined ? '' : `读者感受：${experience.readerEffect}`
  ].filter(Boolean).join('；');
  const focus = outline.descriptionFocus;
  const focusText = focus === undefined ? '' : [
    focus.primary.length === 0 ? '' : `主要描写：${focus.primary.join('；')}`,
    focus.secondary.length === 0 ? '' : `次要描写：${focus.secondary.join('；')}`,
    focus.compress.length === 0 ? '' : `压缩处理：${focus.compress.join('；')}`
  ].filter(Boolean).join('；');
  const information = outline.informationControl;
  const informationText = information === undefined ? '' : [
    information.reveals.length === 0 ? '' : `揭示：${information.reveals.join('；')}`,
    information.concealed.length === 0 ? '' : `保留：${information.concealed.join('；')}`,
    information.gaps.length === 0 ? '' : `信息差：${information.gaps.join('；')}`
  ].filter(Boolean).join('；');
  const threadText = outline.threadActions.length === 0 ? '' : outline.threadActions
    .map((item) => `${threadActionLabel(item.action)}：${item.summary}`)
    .join('；');
  const candidates = outline.allowedCandidates.length === 0 ? '' : `允许新增候选：${outline.allowedCandidates.join('；')}`;
  return [
    ...castEnhancements,
    ...conflictEnhancements,
    ...beatEnhancements,
    ...endingEnhancements,
    experienceText.length === 0 ? '' : `体验提示（软）：${experienceText}`,
    focusText.length === 0 ? '' : `描写重点（软）：${focusText}`,
    informationText.length === 0 ? '' : `信息控制（软）：${informationText}`,
    threadText.length === 0 ? '' : `伏笔动作（软）：${threadText}`,
    candidates,
    outline.creativeFreedom.length === 0 ? '' : `自由创作区（软）：${outline.creativeFreedom.join('；')}`
  ];
}

function threadActionLabel(action: 'plant' | 'advance' | 'payoff'): string {
  return action === 'plant' ? '埋设' : action === 'advance' ? '推进' : '回收';
}
