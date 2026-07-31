import {
  parseChapterOutlineV2,
  type ChapterOutlineV2
} from '../../domain/artifact-schemas.js';

export function compileChapterOutlineForWriter(
  content: Record<string, unknown>,
  maximumCharacters = 1_350
): string {
  const outline = parseChapterOutlineV2(content);
  const hardSections = compileHardSections(outline);
  const hardText = hardSections.join('\n');
  if (hardText.length > maximumCharacters) {
    throw new Error(`章纲硬信息超过${maximumCharacters}字，不能静默截断；请由主编收缩重复信息`);
  }
  const selected = [...hardSections];
  for (const optional of compileOptionalSections(outline)) {
    if (optional.length === 0) continue;
    const candidate = [...selected, optional].join('\n');
    if (candidate.length <= maximumCharacters) selected.push(optional);
  }
  return selected.join('\n');
}

function compileHardSections(outline: ChapterOutlineV2): string[] {
  const stage = outline.sourceStage;
  const cast = outline.cast.map((member) => {
    const change = member.stateChange === undefined ? '' : `；变化：${member.stateChange}`;
    return `- ${member.name}：目标：${member.objective}；知情边界：${member.knowledgeBoundary}；本章作用：${member.chapterRole}${change}`;
  }).join('\n');
  const conflictDetails = [
    `表层：${outline.conflict.surface}`,
    outline.conflict.underlying === undefined ? '' : `深层：${outline.conflict.underlying}`,
    outline.conflict.oppositionGoal === undefined ? '' : `对手目标：${outline.conflict.oppositionGoal}`,
    `失败代价：${outline.conflict.failureCost}`,
    outline.conflict.successCost === undefined ? '' : `成功代价：${outline.conflict.successCost}`
  ].filter(Boolean).join('；');
  const beats = outline.plotBeats.map((beat) => {
    const details = [
      `触发：${beat.trigger}`,
      `行动：${beat.action}`,
      beat.resistance === undefined ? '' : `阻力：${beat.resistance}`,
      beat.turn === undefined ? '' : `转折：${beat.turn}`,
      `结果：${beat.result}`
    ].filter(Boolean).join('；');
    return `${beat.order}. ${details}`;
  }).join('\n');
  const ending = [
    `结果：${outline.ending.result}`,
    outline.ending.stateChanges.length === 0 ? '' : `状态变化：${outline.ending.stateChanges.join('；')}`,
    `钩子：${outline.ending.hook}`,
    `下一章接口：${outline.ending.nextChapterInterface}`
  ].filter(Boolean).join('；');
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
    `必须实现：${outline.mustImplement.join('；')}`,
    `不得违反：${outline.mustNotViolate.join('；')}`,
    `自由创作区：${outline.creativeFreedom.join('；')}`
  ];
}

function compileOptionalSections(outline: ChapterOutlineV2): string[] {
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
    experienceText.length === 0 ? '' : `体验提示（软）：${experienceText}`,
    focusText.length === 0 ? '' : `描写重点（软）：${focusText}`,
    informationText.length === 0 ? '' : `信息控制（软）：${informationText}`,
    threadText.length === 0 ? '' : `伏笔动作（软）：${threadText}`,
    candidates
  ];
}

function threadActionLabel(action: 'plant' | 'advance' | 'payoff'): string {
  return action === 'plant' ? '埋设' : action === 'advance' ? '推进' : '回收';
}
