/**
 * 分层创作正式合同。旧 VolumePlanContent 只作兼容读取；
 * 新卷方向不得内嵌事件列表，事件链必须保存为独立版本。
 */
export const constraintStrengthValues=['hard_fact','current_task','soft_reference','open_space'] as const;
export type ConstraintStrength=typeof constraintStrengthValues[number];
export const planningTruthStatusValues=['planned','confirmed','actual'] as const;
export type PlanningTruthStatus=typeof planningTruthStatusValues[number];
export const planningScopeTypeValues=['book','volume','event','chapter','scene'] as const;
export type LayeredPlanningScopeType=typeof planningScopeTypeValues[number];

export interface SettingClause {
  id:string;bookId:string;kind:string;statement:string;strength:ConstraintStrength;
  truthStatus:PlanningTruthStatus;scopeType:LayeredPlanningScopeType;scopeId:string;
  sourceVersionId:string;dependencyVersionIds:string[];
}
export type SettingGapDecisionValue='design_now'|'not_used_this_volume'|'keep_unknown';
export interface SettingGapDecision {
  id:string;discoveredAtScopeType:'volume'|'event'|'chapter';discoveredAtScopeId:string;
  question:string;whyNeeded:string;affectedObjects:string[];decision:SettingGapDecisionValue;
  resolvedSettingVersionId?:string;
}

export interface BookStorySpineContent {
  longTermReaderPromises:string[];protagonistLongArc:string;centralQuestion:string;
  escalationLadder:string[];optionalEndingDirections:string[];protectedOpenSpaces:string[];
}
export interface BookStorySpineVersion {
  id:string;bookId:string;version:number;sourceFirstVolumeDirectionVersionId:string;
  sourceVersionIds:string[];content:BookStorySpineContent;contentHash:string;
  status:'candidate'|'active'|'superseded'|'archived';createdAt:string;confirmedAt:string|null;
}

export interface FirstVolumeLaunchPlan {
  primaryDrivers:string[];immersionAnchor:string;
  first500Interest:{readerQuestion:string;immediateSituation:string;emotionalGrip:string;promisedMovement:string};
  goldenThree:Array<{chapterNumber:1|2|3;responsibility:string;protagonistAction:string;
    pressureOrPull:string;deliveredPayoff:string;nextExpectation:string}>;
  earlyMomentum:string[];
  majorClimax:{promiseToFulfill:string;centralChoice:string;cost:string;centralConflictChange:string;
    irreversibleChange:string;nextStageTrigger:string;noLaterThanEffectiveChars:100000};
  variationAndRecovery:string[];forbiddenShortcuts:string[];
}

export interface VolumeDirectionContent {
  title:string;openingSituation:string;protagonistDrive:string;volumeGoal:string;
  centralOpposition:string;escalationPath:string[];majorChoices:string[];
  relationshipMovement:string[];expressionFocus:string[];climaxResponsibility:string;
  costAndConsequence:string;closingState:string;benefits:string[];risks:string[];
  openSpaces:string[];firstVolumeLaunch?:FirstVolumeLaunchPlan;
}
export const volumeDirectionFragmentKeys=[
  'openingSituation','protagonistDrive','volumeGoal','centralOpposition','escalationPath',
  'majorChoices','relationshipMovement','expressionFocus','climaxResponsibility',
  'costAndConsequence','closingState','openSpaces','firstVolumeLaunch'
] as const;
export type VolumeDirectionFragmentKey=typeof volumeDirectionFragmentKeys[number];
export interface VolumeRouteFragmentSelection {
  fragmentId:string;field:VolumeDirectionFragmentKey;sourceProposalId:string;sourceVersionId:string;
}
export interface VolumeRouteSelection {
  selectionMode:'whole'|'fragments';selectedProposalId?:string;selectedVersionId?:string;
  fragments:VolumeRouteFragmentSelection[];authorNotes:string|null;
}
export interface ConfirmedVolumeResponsibilities {
  openingSituation:string;protagonistPush:string;firstStageGoal:string;
  escalationResponsibilities:string[];majorChoice:string;climaxPath:string;
  climaxResolution:string;costAndConsequence:string;closingState:string;
}

export const firstVolumeCoverageResponsibilityValues=[
  'opening_launch','golden_three','early_payoff','conflict_and_emotion_escalation',
  'major_climax_before_100k','climax_setup','climax_consequence'
] as const;
export type FirstVolumeCoverageResponsibility=typeof firstVolumeCoverageResponsibilityValues[number];
export interface EventChainNode {
  nodeId:string;order:number;title:string;volumeResponsibility:string;entryState:string;
  protagonistAction:string;oppositionEscalation:string;stagePayoffOrCost:string;exitState:string;
  leadsToNext:string|null;plantThreadIds:string[];payoffThreadIds:string[];
  consequenceThreadIds:string[];firstVolumeResponsibilities:FirstVolumeCoverageResponsibility[];
}
export interface VolumeResponsibilityCoverage {
  responsibility:string;eventNodeIds:string[];status:'covered'|'gap';
}
export interface EventChainContent {
  volumeDirectionVersionId:string;events:EventChainNode[];coverage:VolumeResponsibilityCoverage[];
}
export interface EventChainVersion {
  id:string;bookId:string;volumePlanId:string;version:number;
  status:'candidate'|'active'|'superseded'|'archived';sourceVersionIds:string[];
  content:EventChainContent;contentHash:string;createdAt:string;confirmedAt:string|null;
}

export type StoryThreadType='promise'|'foreshadowing'|'question'|'relationship'|
  'inner_change'|'conflict'|'identity_resource_emotion';
export type StoryThreadStatus='planned'|'planted'|'advanced'|'due'|'resolved'|'abandoned_by_author';
export interface StoryThreadRecord {
  id:string;type:StoryThreadType;title:string;scopeType:'book'|'volume'|'event';scopeId:string;
  status:StoryThreadStatus;plannedWindow?:{fromEventId?:string;toVolumeId?:string};
  sourceVersionIds:string[];actualEvidenceVersionIds:string[];abandonmentReason?:string;
}
export interface FirstChapterLaunchContract {
  first500InterestAnchor:string;immediateSituation:string;firstDesireDangerOrEmotion:string;
  requiredEffectiveChange:string;firstRevealOfUniqueAppeal:string;firstPayoff:string;
  nextExpectation:string;writerFreedom:string[];
}

export function parseFirstChapterLaunchContract(input:unknown):FirstChapterLaunchContract {
  const value=record(input,'第一章强启动合同');
  return {first500InterestAnchor:text(value.first500InterestAnchor,'前500字兴趣锚点'),
    immediateSituation:text(value.immediateSituation,'主角即时处境'),
    firstDesireDangerOrEmotion:text(value.firstDesireDangerOrEmotion,'首个欲望危机或情绪'),
    requiredEffectiveChange:text(value.requiredEffectiveChange,'第一章有效变化'),
    firstRevealOfUniqueAppeal:text(value.firstRevealOfUniqueAppeal,'独特看点首次露出'),
    firstPayoff:text(value.firstPayoff,'第一章首次回报'),nextExpectation:text(value.nextExpectation,'章末下一期待'),
    writerFreedom:textArray(value.writerFreedom,'第一章主笔自由区',1)};
}
export function parseVolumeDirectionContent(input:unknown,firstVolume=false):VolumeDirectionContent {
  const value=record(input,'卷方向');
  const content:VolumeDirectionContent={
    title:text(value.title,'卷标题'),openingSituation:text(value.openingSituation,'开卷局面'),
    protagonistDrive:text(value.protagonistDrive,'主角推动力'),volumeGoal:text(value.volumeGoal,'本卷目标'),
    centralOpposition:text(value.centralOpposition,'主要对立力量'),
    escalationPath:textArray(value.escalationPath,'升级过程',2),majorChoices:textArray(value.majorChoices,'关键选择',1),
    relationshipMovement:textArray(value.relationshipMovement,'关系变化'),
    expressionFocus:textArray(value.expressionFocus,'本卷重点表达',1),
    climaxResponsibility:text(value.climaxResponsibility,'高潮责任'),
    costAndConsequence:text(value.costAndConsequence,'代价与后果'),
    closingState:text(value.closingState,'卷末状态'),benefits:textArray(value.benefits,'方案好处',1),
    risks:textArray(value.risks,'方案风险',1),openSpaces:textArray(value.openSpaces,'创作留白',1)
  };
  if(value.firstVolumeLaunch!==undefined&&value.firstVolumeLaunch!==null)
    content.firstVolumeLaunch=parseFirstVolumeLaunchPlan(value.firstVolumeLaunch);
  else if(firstVolume)throw new Error('第一卷方向必须包含首卷强启动设计。');
  if(!firstVolume&&content.firstVolumeLaunch!==undefined)throw new Error('首卷强启动设计只属于第一卷。');
  return content;
}

export function parseFirstVolumeLaunchPlan(input:unknown):FirstVolumeLaunchPlan {
  const value=record(input,'首卷强启动'),first500=record(value.first500Interest,'前500字兴趣锚点');
  const climax=record(value.majorClimax,'十万字内重大高潮');
  const goldenThree=records(value.goldenThree,'黄金三章').map(item=>({
    chapterNumber:integer(item.chapterNumber,'黄金三章章号') as 1|2|3,
    responsibility:text(item.responsibility,'章节职责'),protagonistAction:text(item.protagonistAction,'主角行动'),
    pressureOrPull:text(item.pressureOrPull,'压力或吸引力'),deliveredPayoff:text(item.deliveredPayoff,'阶段回报'),
    nextExpectation:text(item.nextExpectation,'下一步期待')
  }));
  if(goldenThree.length!==3||goldenThree.some((item,index)=>item.chapterNumber!==index+1))
    throw new Error('黄金三章必须按第1、2、3章各设计一次。');
  if(integer(climax.noLaterThanEffectiveChars,'高潮最晚有效字符')!==100000)
    throw new Error('第一卷重大高潮最晚必须固定为100000有效正文字符。');
  return {
    primaryDrivers:textArray(value.primaryDrivers,'主要追读动力',1),immersionAnchor:text(value.immersionAnchor,'代入锚点'),
    first500Interest:{readerQuestion:text(first500.readerQuestion,'读者问题'),
      immediateSituation:text(first500.immediateSituation,'即时处境'),emotionalGrip:text(first500.emotionalGrip,'情绪抓力'),
      promisedMovement:text(first500.promisedMovement,'变化承诺')},goldenThree,
    earlyMomentum:textArray(value.earlyMomentum,'早期持续动力',1),
    majorClimax:{promiseToFulfill:text(climax.promiseToFulfill,'高潮兑现承诺'),
      centralChoice:text(climax.centralChoice,'高潮核心选择'),cost:text(climax.cost,'高潮代价'),
      centralConflictChange:text(climax.centralConflictChange,'主要冲突变化'),
      irreversibleChange:text(climax.irreversibleChange,'不可逆变化'),
      nextStageTrigger:text(climax.nextStageTrigger,'下一阶段触发'),noLaterThanEffectiveChars:100000},
    variationAndRecovery:textArray(value.variationAndRecovery,'节奏换型与恢复',1),
    forbiddenShortcuts:textArray(value.forbiddenShortcuts,'禁止的套路捷径')
  };
}

export function parseBookStorySpineContent(input:unknown):BookStorySpineContent {
  const value=record(input,'全书故事总线');
  return {longTermReaderPromises:textArray(value.longTermReaderPromises,'长期读者承诺',1),
    protagonistLongArc:text(value.protagonistLongArc,'主角长期变化'),centralQuestion:text(value.centralQuestion,'全书中心问题'),
    escalationLadder:textArray(value.escalationLadder,'跨卷升级阶梯',1),
    optionalEndingDirections:textArray(value.optionalEndingDirections,'可选结局方向'),
    protectedOpenSpaces:textArray(value.protectedOpenSpaces,'受保护留白',1)};
}

export function parseEventChainContent(input:unknown,firstVolume=false):EventChainContent {
  const value=record(input,'事件链');
  const events=records(value.events,'事件链节点').map(item=>({
    nodeId:text(item.nodeId,'事件节点标识'),order:integer(item.order,'事件顺序'),title:text(item.title,'事件标题'),
    volumeResponsibility:text(item.volumeResponsibility,'卷责任'),entryState:text(item.entryState,'进入状态'),
    protagonistAction:text(item.protagonistAction,'人物主要行动'),oppositionEscalation:text(item.oppositionEscalation,'阻力升级'),
    stagePayoffOrCost:text(item.stagePayoffOrCost,'阶段回报或代价'),exitState:text(item.exitState,'移交状态'),
    leadsToNext:nullableText(item.leadsToNext,'下一事件接口'),plantThreadIds:textArray(item.plantThreadIds,'铺垫线程'),
    payoffThreadIds:textArray(item.payoffThreadIds,'兑现线程'),consequenceThreadIds:textArray(item.consequenceThreadIds,'后果线程'),
    firstVolumeResponsibilities:enumArray(item.firstVolumeResponsibilities,firstVolumeCoverageResponsibilityValues,'首卷责任')
  }));
  if(events.length===0)throw new Error('事件链至少需要一个事件。');
  if(new Set(events.map(item=>item.nodeId)).size!==events.length)throw new Error('事件节点标识不能重复。');
  if(events.some((item,index)=>item.order!==index+1))throw new Error('事件顺序必须从1开始连续排列。');
  const ids=new Set(events.map(item=>item.nodeId));
  const coverage=records(value.coverage,'卷责任覆盖').map(item=>{
    const eventNodeIds=textArray(item.eventNodeIds,'责任承载事件');
    if(eventNodeIds.some(id=>!ids.has(id)))throw new Error('卷责任覆盖引用了不存在的事件节点。');
    const status=enumValue(item.status,['covered','gap'] as const,'覆盖状态');
    if(status==='covered'&&eventNodeIds.length===0)throw new Error('已覆盖的卷责任必须有承载事件。');
    return {responsibility:text(item.responsibility,'卷责任'),eventNodeIds,status};
  });
  if(coverage.length===0||coverage.some(item=>item.status==='gap'))throw new Error('事件链仍有未覆盖的卷责任，不能确认。');
  if(firstVolume){
    const present=new Set(events.flatMap(item=>item.firstVolumeResponsibilities));
    const missing=firstVolumeCoverageResponsibilityValues.filter(item=>!present.has(item));
    if(missing.length>0)throw new Error('首卷事件链缺少责任：'+missing.join('、'));
  }
  return {volumeDirectionVersionId:text(value.volumeDirectionVersionId,'卷方向版本'),events,coverage};
}

export function parseVolumeRouteSelection(input:unknown):VolumeRouteSelection {
  const value=record(input,'卷路线选择');
  const selectionMode=enumValue(value.selectionMode,['whole','fragments'] as const,'选择方式');
  const fragments=records(value.fragments??[],'所选片段').map(item=>({
    fragmentId:text(item.fragmentId,'片段标识'),field:enumValue(item.field,volumeDirectionFragmentKeys,'片段字段'),
    sourceProposalId:text(item.sourceProposalId,'来源方案'),sourceVersionId:text(item.sourceVersionId,'来源版本')
  }));
  const result:VolumeRouteSelection={selectionMode,fragments,authorNotes:nullableText(value.authorNotes,'作者补充说明')};
  if(selectionMode==='whole'){
    result.selectedProposalId=text(value.selectedProposalId,'所选方案');
    result.selectedVersionId=text(value.selectedVersionId,'所选版本');
    if(fragments.length>0)throw new Error('整份采用时不能同时提交片段选择。');
  }else{
    if(fragments.length===0)throw new Error('分段融合至少需要选择一个片段。');
    if(new Set(fragments.map(item=>item.fragmentId)).size!==fragments.length)throw new Error('片段标识不能重复。');
  }
  return result;
}

function record(value:unknown,label:string):Record<string,unknown>{
  if(typeof value!=='object'||value===null||Array.isArray(value))throw new Error(label+'必须是对象。');
  return value as Record<string,unknown>;
}
function records(value:unknown,label:string):Array<Record<string,unknown>>{
  if(!Array.isArray(value))throw new Error(label+'必须是列表。');return value.map(item=>record(item,label));
}
function text(value:unknown,label:string):string{
  if(typeof value!=='string'||value.trim().length===0)throw new Error(label+'不能为空。');return value.trim();
}
function nullableText(value:unknown,label:string):string|null{
  return value===null||value===undefined||value===''?null:text(value,label);
}
function textArray(value:unknown,label:string,minimum=0):string[]{
  if(!Array.isArray(value))throw new Error(label+'必须是列表。');
  const result=[...new Set(value.map(item=>text(item,label)))];
  if(result.length<minimum)throw new Error(label+'至少需要'+minimum+'项。');return result;
}
function integer(value:unknown,label:string):number{
  if(!Number.isInteger(value)||Number(value)<1)throw new Error(label+'必须是正整数。');return Number(value);
}
function enumValue<const T extends readonly string[]>(value:unknown,allowed:T,label:string):T[number]{
  if(typeof value!=='string'||!allowed.includes(value))throw new Error(label+'无效。');return value as T[number];
}
function enumArray<const T extends readonly string[]>(value:unknown,allowed:T,label:string):T[number][]{
  if(!Array.isArray(value))throw new Error(label+'必须是列表。');
  return [...new Set(value.map(item=>enumValue(item,allowed,label)))];
}
