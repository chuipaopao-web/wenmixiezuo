import {
  hashStableContractContent,
  parseEventChainContent,
  parseVolumeRouteSelection,
  type BookStorySpineContent,
  type EventChainContent,
  type EventChainVersion,
  type FirstVolumeLaunchPlan,
  type LegacyFirstVolumeLaunchPlan,
  type StorySpine,
  type VolumeDirectionContent,
  type VolumePlanContent,
  type VolumeRouteSelection
} from '@wenmi/contracts';
import type { Clock,IdGenerator } from '../../domain/ids.js';
import { DomainError,errorCodes } from '../../domain/errors.js';
import type { BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import type { StoryThreadService } from './story-thread-service.js';
import {
  LayeredPlanningRepository,
  type EventChainVersionRow,
  type VolumeDirectionVersionRow
} from '../../infrastructure/db/repositories/layered-planning-repository.js';

export interface VolumeDirectionVersionView {
  volumeDirectionVersionId:string;volumePlanId:string;legacyVolumePlanVersionId:string|null;
  version:number;proposalId:string;candidateKind:VolumeDirectionVersionRow['candidate_kind'];
  status:VolumeDirectionVersionRow['status'];parentVersionId:string|null;sourceVersionIds:string[];
  authorInputRefs:string[];content:VolumeDirectionContent;contentHash:string;
  createdAt:string;confirmedAt:string|null;
}

export interface VolumeFusionSource {
  sourceTaskId:string;
  selectedDirections:Array<{
    proposalId:string;versionId:string;selectedContent:Record<string,unknown>;
  }>;
}

export class LayeredPlanningService {
  public constructor(
    private readonly repository:LayeredPlanningRepository,
    private readonly unitOfWork:UnitOfWork,
    private readonly ids:IdGenerator,
    private readonly clock:Clock,
    private readonly storyThreads?:StoryThreadService
  ){}

  public projectLegacyVolumeVersion(scope:BookScope,input:{
    volumePlanId:string;legacyVolumePlanVersionId:string;planNumber:number;
    candidateKind:'candidate_a'|'candidate_b'|'author_edit'|'fusion'|'legacy';
    sourceTaskId:string|null;parentLegacyVersionId:string|null;authorInputRefs:string[];
    content:VolumePlanContent;
  }):VolumeDirectionVersionView {
    const existing=this.repository.directionByLegacy(scope,input.legacyVolumePlanVersionId);
    if(existing!==undefined)return directionView(existing);
    return this.unitOfWork.run(()=>{
      const replay=this.repository.directionByLegacy(scope,input.legacyVolumePlanVersionId);
      if(replay!==undefined)return directionView(replay);
      const id=this.ids.next(),proposalId=this.ids.next(),now=this.clock.now().toISOString();
      const content=legacyToDirection(input.content,input.planNumber);
      const kind=input.candidateKind==='legacy'?'legacy_projection':input.candidateKind;
      this.repository.insertDirection(scope,{
        id,volumePlanId:input.volumePlanId,legacyVersionId:input.legacyVolumePlanVersionId,
        version:this.repository.nextDirectionVersion(scope,input.volumePlanId),proposalId,candidateKind:kind,
        parentVersionId:input.parentLegacyVersionId===null?null:
          this.repository.directionByLegacy(scope,input.parentLegacyVersionId)?.volume_direction_version_id??null,
        sourceTaskId:input.sourceTaskId,sourceVersionIds:[input.legacyVolumePlanVersionId],
        authorInputRefs:input.authorInputRefs,content,contentHash:digest(content),
        idempotencyKey:'direction-projection:'+input.legacyVolumePlanVersionId,now
      });
      if(input.planNumber===1&&input.content.storySpine!==null&&input.content.storySpine!==undefined){
        const spine=legacyStorySpine(input.content.storySpine);
        this.repository.insertStorySpine(scope,{
          id:this.ids.next(),version:this.repository.nextStorySpineVersion(scope),
          sourceDirectionVersionId:id,sourceVersionIds:[id,input.legacyVolumePlanVersionId],
          content:spine,contentHash:digest(spine),now
        });
      }
      return directionView(this.repository.direction(scope,id)!);
    });
  }

  public listDirections(scope:BookScope,volumePlanId:string):VolumeDirectionVersionView[]{
    return this.repository.listDirections(scope,volumePlanId).map(directionView);
  }

  public activeDirection(scope:BookScope,volumePlanId:string):VolumeDirectionVersionView|null {
    const row=this.repository.activeDirection(scope,volumePlanId);
    return row===undefined?null:directionView(row);
  }

  public activeStorySpine(scope:BookScope):BookStorySpineContent|null {
    const row=this.repository.activeStorySpine(scope);
    return row===undefined?null:JSON.parse(row.content_json) as BookStorySpineContent;
  }

  public activeEventChain(scope:BookScope,volumePlanId:string):EventChainVersion|null {
    const row=this.repository.activeEventChain(scope,volumePlanId);
    return row===undefined?null:eventChainView(scope.bookId,row);
  }

  public eventChainForTask(scope:BookScope,volumePlanId:string,taskId:string):EventChainVersion|null {
    const row=this.repository.eventChainBySourceTask(scope,volumePlanId,taskId);
    return row===undefined?null:eventChainView(scope.bookId,row);
  }

  public eventRoleCharacters(scope:BookScope,eventChainVersionId:string,eventNodeId:string):Array<{
    roleFunctionKey:string;roleFunctionLabel:string;characterId:string;characterName:string;
  }>{
    return this.repository.eventRoleCharacters(scope,eventChainVersionId,eventNodeId).map((row)=>({
      roleFunctionKey:row.role_function_key,roleFunctionLabel:row.role_function_label,
      characterId:row.character_id,characterName:row.character_name
    }));
  }

  public confirmDirectionForLegacy(scope:BookScope,legacyVersionId:string):void {
    const row=this.repository.directionByLegacy(scope,legacyVersionId);
    if(row===undefined)return;
    const now=this.clock.now().toISOString();
    this.unitOfWork.run(()=>{
      const previousDirection=this.repository.activeDirection(scope,row.volume_plan_id);
      if(!this.repository.activateDirection(scope,row.volume_direction_version_id,now))
        throw conflict('卷方向确认状态已经变化，请刷新后再试。');
      if(previousDirection!==undefined&&previousDirection.volume_direction_version_id!==row.volume_direction_version_id)
        this.repository.supersedeEventChainsExceptDirection(scope,row.volume_plan_id,row.volume_direction_version_id);
      const candidate=this.findStorySpineForDirection(scope,row.volume_direction_version_id);
      const activeSpine=this.repository.activeStorySpine(scope);
      if(candidate!==undefined&&activeSpine?.book_story_spine_version_id!==candidate.book_story_spine_version_id)
        this.repository.activateStorySpine(scope,candidate.book_story_spine_version_id,now);
    });
  }

  public recordRouteSelection(scope:BookScope,volumePlanId:string,input:{
    selection:unknown;idempotencyKey:string;
  }):VolumeRouteSelection {
    const selection=parseVolumeRouteSelection(input.selection);
    const sourceTaskId=this.validateSelectionSources(scope,volumePlanId,selection);
    const key=required(input.idempotencyKey,'幂等键');
    const requestHash=digest({volumePlanId,sourceTaskId,selection});
    const replay=this.repository.routeSelectionByIdempotency(scope,volumePlanId,key);
    if(replay!==undefined){
      if(replay.request_hash!==requestHash)throw conflict('同一个幂等键不能用于不同的路线选择。');
      return selectionFromRow(replay);
    }
    this.unitOfWork.run(()=>this.repository.insertRouteSelection(scope,{
      id:this.ids.next(),volumePlanId,sourceTaskId,selection,requestHash,idempotencyKey:key,
      now:this.clock.now().toISOString()
    }));
    return selection;
  }

  public buildFusionSource(
    scope:BookScope,volumePlanId:string,selection:VolumeRouteSelection
  ):VolumeFusionSource {
    const sourceTaskId=this.validateSelectionSources(scope,volumePlanId,selection);
    if(selection.selectionMode==='whole'){
      const row=this.repository.direction(scope,selection.selectedVersionId!)!;
      return {sourceTaskId,selectedDirections:[{
        proposalId:row.proposal_id,versionId:row.volume_direction_version_id,
        selectedContent:JSON.parse(row.content_json) as Record<string,unknown>
      }]};
    }
    const grouped=new Map<string,{proposalId:string;selectedContent:Record<string,unknown>}>();
    for(const fragment of selection.fragments){
      const row=this.repository.direction(scope,fragment.sourceVersionId)!;
      const source=JSON.parse(row.content_json) as Record<string,unknown>;
      const current=grouped.get(fragment.sourceVersionId)??{
        proposalId:row.proposal_id,selectedContent:{title:source.title}
      };
      current.selectedContent[fragment.field]=source[fragment.field];
      grouped.set(fragment.sourceVersionId,current);
    }
    return {sourceTaskId,selectedDirections:[...grouped].map(([versionId,item])=>({
      proposalId:item.proposalId,versionId,selectedContent:item.selectedContent
    }))};
  }

  public addEventChain(scope:BookScope,volumePlanId:string,input:{
    planNumber:number;content:unknown;parentVersionId?:string|null;sourceTaskId?:string|null;
    sourceVersionIds?:string[];idempotencyKey:string;
  }):EventChainVersion {
    const content=parseEventChainContent(input.content,input.planNumber===1);
    const direction=this.repository.direction(scope,content.volumeDirectionVersionId);
    if(direction===undefined||direction.volume_plan_id!==volumePlanId)
      throw validation('事件链引用的卷方向不属于当前卷。');
    if(direction.status!=='active')throw conflict('请先确认卷方向，再设计事件链。');
    const parentVersionId=input.parentVersionId??null;
    if(parentVersionId!==null){
      const parent=this.repository.eventChain(scope,parentVersionId);
      if(parent===undefined||parent.volume_plan_id!==volumePlanId
        ||parent.volume_direction_version_id!==direction.volume_direction_version_id)
        throw validation('父事件链版本不属于当前卷方向。');
    }
    const key=required(input.idempotencyKey,'幂等键'),now=this.clock.now().toISOString();
    const contentHash=digest(content);
    const replay=this.repository.eventChainByIdempotency(scope,key);
    if(replay!==undefined){
      if(replay.volume_plan_id!==volumePlanId||replay.content_hash!==contentHash)
        throw conflict('同一个幂等键不能用于不同的事件链。');
      return eventChainView(scope.bookId,replay);
    }
    return this.unitOfWork.run(()=>{
      const secondReplay=this.repository.eventChainByIdempotency(scope,key);
      if(secondReplay!==undefined)return eventChainView(scope.bookId,secondReplay);
      const id=this.ids.next();
      this.repository.insertEventChain(scope,{
        id,volumePlanId,directionVersionId:direction.volume_direction_version_id,
        version:this.repository.nextEventChainVersion(scope,volumePlanId),
        parentVersionId,sourceTaskId:input.sourceTaskId??null,
        sourceVersionIds:input.sourceVersionIds??[direction.volume_direction_version_id],
        content,contentHash,idempotencyKey:key,now
      });
      return eventChainView(scope.bookId,this.repository.eventChain(scope,id)!);
    });
  }

  public listEventChains(scope:BookScope,volumePlanId:string):EventChainVersion[]{
    return this.repository.listEventChains(scope,volumePlanId).map(row=>eventChainView(scope.bookId,row));
  }

  public confirmEventChain(scope:BookScope,volumePlanId:string,eventChainVersionId:string):EventChainVersion {
    const row=this.repository.eventChain(scope,eventChainVersionId);
    if(row===undefined||row.volume_plan_id!==volumePlanId)throw validation('事件链版本不属于当前卷。');
    const direction=this.repository.activeDirection(scope,volumePlanId);
    if(direction===undefined||row.volume_direction_version_id!==direction.volume_direction_version_id)
      throw conflict('卷方向已经变化，这条事件链已过期，请重新设计。');
    const now=this.clock.now().toISOString();
    this.unitOfWork.run(()=>{
      if(!this.repository.activateEventChain(scope,eventChainVersionId,now))
        throw conflict('事件链确认状态已经变化，请刷新后再试。');
      this.storyThreads?.registerPlan(scope,volumePlanId,eventChainVersionId,
        JSON.parse(row.content_json) as EventChainContent);
    });
    return eventChainView(scope.bookId,this.repository.eventChain(scope,eventChainVersionId)!);
  }

  private validateSelectionSources(scope:BookScope,volumePlanId:string,selection:VolumeRouteSelection):string {
    let sourceTaskId:string|null=null;
    const validate=(versionId:string,proposalId:string)=>{
      const row=this.repository.direction(scope,versionId);
      if(row===undefined||row.volume_plan_id!==volumePlanId||row.proposal_id!==proposalId)
        throw validation('所选路线片段不是本轮当前卷的有效候选。');
      if(row.source_task_id===null)throw validation('所选路线不是AI团队本轮生成的独立候选。');
      if(!['candidate_a','candidate_b'].includes(row.candidate_kind))
        throw validation('只能从两位编剧的独立候选中选择路线。');
      if(sourceTaskId===null)sourceTaskId=row.source_task_id;
      else if(sourceTaskId!==row.source_task_id)throw validation('不能跨不同设计轮次混合路线片段。');
    };
    if(selection.selectionMode==='whole')
      validate(selection.selectedVersionId!,selection.selectedProposalId!);
    else for(const fragment of selection.fragments)validate(fragment.sourceVersionId,fragment.sourceProposalId);
    if(sourceTaskId===null)throw validation('没有可用的路线选择。');
    return sourceTaskId;
  }

  private findStorySpineForDirection(scope:BookScope,directionId:string){
    return this.repository.storySpineCandidates(scope).find(
      row=>row.source_first_volume_direction_version_id===directionId
    );
  }
}

function legacyToDirection(content:VolumePlanContent,planNumber:number):VolumeDirectionContent {
  const route=content.routeCard;
  const focus=content.focusExpression?.trim();
  const result:VolumeDirectionContent={
    title:content.title,openingSituation:content.openingState,
    protagonistDrive:route?.drivingMotivation??content.coreGoal,volumeGoal:content.coreGoal,
    centralOpposition:content.coreConflict,
    escalationPath:route?.escalationPath?.length?route.escalationPath:content.escalationAndRecovery,
    majorChoices:[route?.keyChoiceAndCost??content.failureCost],
    relationshipMovement:content.characterChanges,
    expressionFocus:focus?[focus]:[content.stylePrimary??'延续全书基调'],
    climaxResponsibility:route?.climaxResolution??('解决本卷核心冲突：'+content.coreConflict),
    costAndConsequence:route?.keyChoiceAndCost??content.failureCost,
    closingState:route?.endingChange??content.endingState,benefits:route?.benefits??['因果方向清楚'],
    risks:route?.risks??['需要在事件链阶段继续检查节奏换型'],
    openSpaces:[...content.boundaries.creativeFreedom,...content.boundaries.openQuestions]
  };
  if(planNumber===1&&content.firstVolumeLaunch!==null&&content.firstVolumeLaunch!==undefined)
    result.firstVolumeLaunch=legacyLaunch(content.firstVolumeLaunch,content);
  return result;
}

function legacyLaunch(value:LegacyFirstVolumeLaunchPlan,content:VolumePlanContent):FirstVolumeLaunchPlan {
  return {
    primaryDrivers:value.immersionPriorities.length?value.immersionPriorities:['人物行动与冲突变化'],
    immersionAnchor:value.immersionPriorities[0]??value.first500.emotionalGrip,
    first500Interest:{readerQuestion:value.first500.readerQuestion,immediateSituation:value.first500.immediateSituation,
      emotionalGrip:value.first500.emotionalGrip,promisedMovement:value.first500.changePromise},
    goldenThree:value.goldenThree.slice(0,3).map((item,index)=>({
      chapterNumber:(index+1) as 1|2|3,responsibility:item.responsibility,protagonistAction:item.action,
      pressureOrPull:item.pressure,deliveredPayoff:item.payoff,nextExpectation:item.nextExpectation
    })),
    earlyMomentum:content.escalationAndRecovery,
    majorClimax:{promiseToFulfill:value.majorClimax.setup,centralChoice:value.majorClimax.choice,
      cost:value.majorClimax.cost,centralConflictChange:content.coreConflict,
      irreversibleChange:value.majorClimax.irreversibleChange,nextStageTrigger:value.majorClimax.nextStage,
      noLaterThanEffectiveChars:100000},
    variationAndRecovery:content.escalationAndRecovery,forbiddenShortcuts:[]
  };
}

function legacyStorySpine(value:StorySpine):BookStorySpineContent {
  return {longTermReaderPromises:[value.longTermPromise],protagonistLongArc:value.protagonistLongArc,
    centralQuestion:value.centralQuestion,escalationLadder:value.escalationLadder,
    optionalEndingDirections:value.endingDirection===null?[]:[value.endingDirection],
    protectedOpenSpaces:value.protectedOpenSpace};
}
function directionView(row:VolumeDirectionVersionRow):VolumeDirectionVersionView {
  return {volumeDirectionVersionId:row.volume_direction_version_id,volumePlanId:row.volume_plan_id,
    legacyVolumePlanVersionId:row.legacy_volume_plan_version_id,version:row.version,proposalId:row.proposal_id,
    candidateKind:row.candidate_kind,status:row.status,parentVersionId:row.parent_version_id,
    sourceVersionIds:JSON.parse(row.source_version_ids_json) as string[],
    authorInputRefs:JSON.parse(row.author_input_refs_json) as string[],
    content:JSON.parse(row.content_json) as VolumeDirectionContent,contentHash:row.content_hash,
    createdAt:row.created_at,confirmedAt:row.confirmed_at};
}
function eventChainView(bookId:string,row:EventChainVersionRow):EventChainVersion {
  return {id:row.event_chain_version_id,bookId,volumePlanId:row.volume_plan_id,version:row.version,
    status:row.status,sourceVersionIds:JSON.parse(row.source_version_ids_json) as string[],
    content:parseEventChainContent(JSON.parse(row.content_json) as unknown),contentHash:row.content_hash,
    createdAt:row.created_at,confirmedAt:row.confirmed_at};
}
function selectionFromRow(row:{selection_mode:'whole'|'fragments';selected_proposal_id:string|null;
  selected_version_id:string|null;fragments_json:string;author_notes:string|null}):VolumeRouteSelection {
  const result:VolumeRouteSelection={selectionMode:row.selection_mode,
    fragments:JSON.parse(row.fragments_json) as VolumeRouteSelection['fragments'],authorNotes:row.author_notes};
  if(row.selected_proposal_id!==null)result.selectedProposalId=row.selected_proposal_id;
  if(row.selected_version_id!==null)result.selectedVersionId=row.selected_version_id;
  return result;
}
function digest(value:unknown):string{return hashStableContractContent(value).slice('sha256:'.length);}
function required(value:unknown,label:string):string {
  if(typeof value!=='string'||value.trim().length===0)throw validation(label+'不能为空。');return value.trim();
}
function validation(message:string):DomainError{return new DomainError(errorCodes.validation,message);}
function conflict(message:string):DomainError{return new DomainError(errorCodes.bookVersionConflict,message,{},false,409);}
