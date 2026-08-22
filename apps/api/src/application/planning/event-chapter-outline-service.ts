import {
  hashStableContractContent,parseEventChapterSequenceContent,parseVolumePlanContent,type ChapterOutlineContent,
  type EventChapterSequenceContent,type FirstChapterLaunchContract,type GoldenThreeLaunchPackage,type VersionReference
} from '@wenmi/contracts';
import { ArtifactService } from '../artifacts/artifact-service.js';
import { parseChapterOutlineV2,type ChapterOutlineV2 } from '../../domain/artifact-schemas.js';
import { DomainError,errorCodes } from '../../domain/errors.js';
import type { Clock,IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import {
  EventChapterOutlineRepository,type ActiveEventChapterSnapshot,type EventChapterOutlineRow,
  type EventChapterOutlineVersionRow,type EventChapterSequenceRow,type EventChapterSequenceVersionRow
} from '../../infrastructure/db/repositories/event-chapter-outline-repository.js';

export interface EventChapterSequenceVersionView {
  sequenceVersionId:string;sequenceId:string;version:number;parentVersionId:string|null;
  status:EventChapterSequenceVersionRow['status'];dependencies:VersionReference[];authorInputRefs:string[];
  content:EventChapterSequenceContent;contentHash:string;sourceTaskId:string|null;createdAt:string;confirmedAt:string|null;
}
export interface EventChapterOutlineVersionView {
  outlineVersionId:string;outlineId:string;version:number;parentVersionId:string|null;
  status:EventChapterOutlineVersionRow['status'];sequenceVersionId:string;dependencies:VersionReference[];
  authorInputRefs:string[];content:ChapterOutlineV2;contentHash:string;artifactVersionId:string|null;
  sourceTaskId:string|null;createdAt:string;frozenAt:string|null;
}
export interface EventChapterOutlineView {
  outlineId:string;eventId:string;chapterNumber:number;order:number;revision:number;status:EventChapterOutlineRow['status'];
  activeVersionId:string|null;planned:ChapterOutlineContent;activeVersion:EventChapterOutlineVersionView|null;
  versions:EventChapterOutlineVersionView[];createdAt:string;updatedAt:string;
}
export interface EventChapterSequenceView {
  sequenceId:string;eventId:string;eventVersionId:string;volumePlanVersionId:string;revision:number;
  status:EventChapterSequenceRow['status'];activeVersionId:string|null;activeVersion:EventChapterSequenceVersionView|null;
  versions:EventChapterSequenceVersionView[];outlines:EventChapterOutlineView[];nextChapterNumber:number;
  valid:boolean;createdAt:string;updatedAt:string;
}

export class EventChapterOutlineService {
  public constructor(private readonly repo:EventChapterOutlineRepository,private readonly uow:UnitOfWork,
    private readonly artifacts:ArtifactService,private readonly ids:IdGenerator,private readonly clock:Clock){}

  public get(scope:BookScope,eventId:string):EventChapterSequenceView|null{
    const row=this.repo.sequence(scope,required(eventId,'事件标识'));return row===undefined?null:this.view(scope,row);
  }
  public initialize(scope:BookScope,eventId:string,input:{expectedWorkflowVersion:number;idempotencyKey:string}):EventChapterSequenceView{
    const expected=positive(input.expectedWorkflowVersion,'工作流版本'),key=required(input.idempotencyKey,'幂等键'),now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const snapshot=this.snapshot(scope,eventId),workflow=this.workflow(scope);
      if(workflow.planning_version!==expected||workflow.stage!=='event_confirmed'||workflow.active_event_id!==eventId
        ||workflow.active_event_version_id!==snapshot.eventVersionId)throw conflict('请先确认当前事件大纲。');
      const hash=digest({eventId,key}),id=this.ids.next();
      const existing=this.repo.sequence(scope,eventId);if(existing!==undefined){
        if(existing.event_version_id===snapshot.eventVersionId&&existing.volume_plan_version_id===snapshot.volumePlanVersionId)
          return this.view(scope,existing);
        if(!this.repo.rebaseEmptySequence(scope,{sequenceId:existing.event_chapter_sequence_id,expectedRevision:existing.revision,
          eventVersionId:snapshot.eventVersionId,volumePlanVersionId:snapshot.volumePlanVersionId,key,hash,now}))
          throw conflict('上层事件已经变化，现有章纲包含保留内容，请先查看影响再重新规划。');
        return this.view(scope,this.sequence(scope,eventId));
      }
      this.repo.insertSequence(scope,{id,eventId,eventVersionId:snapshot.eventVersionId,volumePlanVersionId:snapshot.volumePlanVersionId,key,hash,now});
      return this.view(scope,this.sequence(scope,eventId));
    });
  }
  public addSequenceVersion(scope:BookScope,eventId:string,input:{expectedSequenceRevision:number;parentVersionId?:string|null;
    authorInputRefs?:string[];content:unknown;sourceTaskId?:string|null;idempotencyKey:string}):EventChapterSequenceVersionView{
    const expected=positive(input.expectedSequenceRevision,'序列修订号'),parent=optional(input.parentVersionId,'父版本'),
      refs=ids(input.authorInputRefs??[],'作者想法引用'),task=optional(input.sourceTaskId,'来源任务'),key=required(input.idempotencyKey,'幂等键');
    let content:EventChapterSequenceContent;try{content=parseEventChapterSequenceContent(input.content);}
    catch(error){throw validation(error instanceof Error?error.message:'事件章纲序列格式无效。');}
    const requestHash=digest({eventId,expected,parent,refs,content,task}),now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const replay=this.repo.sequenceVersionByKey(scope,key);if(replay!==undefined){same(replay.request_hash,requestHash);return sequenceVersionView(replay);}
      const sequence=this.sequence(scope,eventId),snapshot=this.snapshot(scope,eventId);
      content=bindGoldenThreeLaunch(content,snapshot.volumeContent);
      if(sequence.revision!==expected)throw conflict('事件章纲序列已经变化。');
      this.assertSequenceCurrent(sequence,snapshot);this.assertSequenceContent(scope,sequence,snapshot,content);
      if(parent!==null&&this.repo.sequenceVersion(scope,sequence.event_chapter_sequence_id,parent)===undefined)throw validation('父版本不属于当前序列。');
      if(task!==null&&!this.repo.taskExists(scope,task))throw validation('来源任务不属于当前书籍。');
      const version=this.repo.listSequenceVersions(scope,sequence.event_chapter_sequence_id).length+1,id=this.ids.next();
      const dependencies=baseDependencies(snapshot);
      this.repo.insertSequenceVersion(scope,{id,sequenceId:sequence.event_chapter_sequence_id,version,parent,
        eventVersionId:snapshot.eventVersionId,volumePlanVersionId:snapshot.volumePlanVersionId,
        dependencies:JSON.stringify(dependencies),authorRefs:JSON.stringify(refs),content:JSON.stringify(content),
        hash:digest(content),task,key,requestHash,now});
      this.repo.insertDependencies(scope,{kind:'event_chapter_sequence_version',downstreamId:id,downstreamVersion:version,
        dependencies,ids:dependencies.map(()=>this.ids.next()),now});
      return sequenceVersionView(this.requireSequenceVersion(scope,sequence.event_chapter_sequence_id,id));
    });
  }
  public confirmSequence(scope:BookScope,eventId:string,input:{sequenceVersionId:string;expectedSequenceRevision:number;
    expectedWorkflowVersion:number}):EventChapterSequenceView{
    const versionId=required(input.sequenceVersionId,'序列版本'),expected=positive(input.expectedSequenceRevision,'序列修订号'),
      workflowVersion=positive(input.expectedWorkflowVersion,'工作流版本'),now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const sequence=this.sequence(scope,eventId),snapshot=this.snapshot(scope,eventId),workflow=this.workflow(scope);
      if(sequence.revision!==expected||workflow.planning_version!==workflowVersion)throw conflict('事件章纲或工作流已经变化。');
      this.assertSequenceCurrent(sequence,snapshot);
      const version=this.requireSequenceVersion(scope,sequence.event_chapter_sequence_id,versionId);
      this.assertDependencies(version.dependencies_json,baseDependencies(snapshot));
      const content=parseEventChapterSequenceContent(JSON.parse(version.content_json) as unknown);
      this.assertSequenceContent(scope,sequence,snapshot,content);
      if(!this.repo.activateSequence(scope,{sequenceId:sequence.event_chapter_sequence_id,versionId,expectedRevision:expected,now}))
        throw conflict('事件章纲序列已经变化。');
      this.repo.replacePlannedOutlines(scope,{sequenceId:sequence.event_chapter_sequence_id,eventId,
        items:content.chapters.map((chapter,index)=>({id:this.ids.next(),chapterNumber:chapter.chapterNumber,order:index+1,content:JSON.stringify(chapter)})),now});
      if(!this.repo.advanceForSequence(scope,{eventId,eventVersionId:snapshot.eventVersionId,expectedPlanningVersion:workflowVersion,now}))
        throw conflict('创作工作流已经变化。');
      return this.view(scope,this.sequence(scope,eventId));
    });
  }
  public listOutlineVersions(scope:BookScope,outlineId:string):EventChapterOutlineVersionView[]{
    this.outline(scope,outlineId);return this.repo.listOutlineVersions(scope,outlineId).map(outlineVersionView);
  }
  public addOutlineVersion(scope:BookScope,outlineId:string,input:{expectedOutlineRevision:number;parentVersionId?:string|null;
    authorInputRefs?:string[];content:Record<string,unknown>;sourceTaskId?:string|null;contextOpeningState?:string|null;
    idempotencyKey:string}):EventChapterOutlineVersionView{
    const expected=positive(input.expectedOutlineRevision,'章纲修订号'),parent=optional(input.parentVersionId,'父版本'),
      refs=ids(input.authorInputRefs??[],'作者想法引用'),task=optional(input.sourceTaskId,'来源任务'),
      contextOpeningState=optional(input.contextOpeningState,'正史开场状态'),key=required(input.idempotencyKey,'幂等键');
    const requestHash=digest({outlineId,expected,parent,refs,content:input.content,task,contextOpeningState}),now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const replay=this.repo.outlineVersionByKey(scope,key);if(replay!==undefined){same(replay.request_hash,requestHash);return outlineVersionView(replay);}
      const outline=this.outline(scope,outlineId);if(outline.revision!==expected)throw conflict('章纲已经变化。');
      if(['frozen','settled','archived'].includes(outline.status))throw conflict('已冻结、结算或归档章纲不能覆盖修改。');
      const sequence=this.requireActiveSequence(scope,outline.event_chapter_sequence_id),snapshot=this.snapshot(scope,outline.event_id);
      this.assertSequenceCurrent(sequence,snapshot);const sequenceVersion=this.requireSequenceVersion(scope,sequence.event_chapter_sequence_id,sequence.active_version_id!);
      const bound=this.bindDetailed(outline,this.repo.listOutlines(scope,sequence.event_chapter_sequence_id),snapshot,input.content,
        contextOpeningState);
      if(parent!==null&&this.repo.outlineVersion(scope,outlineId,parent)===undefined)throw validation('父版本不属于当前章纲。');
      if(task!==null&&!this.repo.taskExists(scope,task))throw validation('来源任务不属于当前书籍。');
      if(refs.length!==this.repo.authorInputCount(scope,outlineId,refs))throw validation('作者想法引用必须来自当前章纲。');
      const version=this.repo.listOutlineVersions(scope,outlineId).length+1,id=this.ids.next();
      const dependencies=[...baseDependencies(snapshot),sequenceReference(sequenceVersion)];
      this.repo.insertOutlineVersion(scope,{id,outlineId,version,parent,sequenceVersionId:sequenceVersion.event_chapter_sequence_version_id,
        eventVersionId:snapshot.eventVersionId,volumePlanVersionId:snapshot.volumePlanVersionId,dependencies:JSON.stringify(dependencies),
        authorRefs:JSON.stringify(refs),content:JSON.stringify(bound),hash:digest(bound),task,key,requestHash,now});
      this.repo.insertDependencies(scope,{kind:'event_chapter_outline_version',downstreamId:id,downstreamVersion:version,
        dependencies,ids:dependencies.map(()=>this.ids.next()),now});
      return outlineVersionView(this.requireOutlineVersion(scope,outlineId,id));
    });
  }
  public freezeRecent(scope:BookScope,eventId:string,input:{items:Array<{outlineId:string;outlineVersionId:string;expectedOutlineRevision:number}>;
    expectedWorkflowVersion:number}):EventChapterSequenceView{
    if(!Array.isArray(input.items)||input.items.length<1||input.items.length>3)throw validation('每次只能冻结最近一至三章。');
    const workflowVersion=positive(input.expectedWorkflowVersion,'工作流版本'),now=this.clock.now().toISOString();
    return this.uow.run(()=>{
      const sequence=this.requireActiveSequence(scope,this.sequence(scope,eventId).event_chapter_sequence_id),snapshot=this.snapshot(scope,eventId);
      this.assertSequenceCurrent(sequence,snapshot);const workflow=this.workflow(scope);
      if(workflow.planning_version!==workflowVersion)throw conflict('创作工作流已经变化。');
      const outlines=this.repo.listOutlines(scope,sequence.event_chapter_sequence_id);
      const first=outlines.findIndex(item=>!['frozen','settled'].includes(item.status));
      if(first<0)throw conflict('当前事件所有章纲都已冻结或结算。');
      const expectedIds=outlines.slice(first,first+input.items.length).map(item=>item.event_chapter_outline_id);
      if(input.items.some((item,index)=>item.outlineId!==expectedIds[index]))throw validation('只能从最近未冻结的一章开始连续冻结。');
      const refs:VersionReference[]=[];
      input.items.forEach(item=>{
        const outline=this.outline(scope,item.outlineId);if(outline.revision!==positive(item.expectedOutlineRevision,'章纲修订号'))throw conflict('章纲已经变化。');
        const version=this.requireOutlineVersion(scope,item.outlineId,item.outlineVersionId);
        this.assertDependencies(version.dependencies_json,[...baseDependencies(snapshot),sequenceReference(this.requireSequenceVersion(scope,sequence.event_chapter_sequence_id,sequence.active_version_id!))]);
        const content=parseChapterOutlineV2(JSON.parse(version.content_json) as Record<string,unknown>);
        const artifactTitle=`第${outline.chapter_number}章章纲`,source={...content,sourceVolumePlanVersionId:snapshot.volumePlanVersionId,
          sourceEventId:eventId,sourceEventVersionId:snapshot.eventVersionId,sourceEventChapterSequenceVersionId:sequence.active_version_id,
          sourceEventChapterOutlineVersionId:version.event_chapter_outline_version_id,sourceDecisionId:`event-chapter-freeze:${version.event_chapter_outline_version_id}`};
        const existing=this.repo.artifactByTitle(scope,artifactTitle);
        const artifact=existing===undefined?this.artifacts.create(scope,'chapter_outline',artifactTitle,source,'candidate')
          :this.artifacts.addVersion(scope,existing.artifact_id,source,existing.active_version_id);
        const selected=this.artifacts.select(scope,artifact.artifactId,artifact.artifactVersionId);
        if(!this.repo.freezeOutline(scope,{outlineId:item.outlineId,versionId:item.outlineVersionId,
          artifactVersionId:selected.artifactVersionId,expectedRevision:item.expectedOutlineRevision,now}))throw conflict('章纲已经变化。');
        refs.push({kind:'chapter_outline',id:selected.artifactId,version:selected.version,contentHash:selected.contentHash,required:true});
      });
      if(!this.repo.freezeWorkflow(scope,{expectedPlanningVersion:workflowVersion,refs:JSON.stringify(refs),now}))
        throw conflict('创作工作流已经变化。');
      return this.view(scope,this.sequence(scope,eventId));
    });
  }

  private bindDetailed(outline:EventChapterOutlineRow,all:EventChapterOutlineRow[],snapshot:ActiveEventChapterSnapshot,
    input:Record<string,unknown>,contextOpeningState:string|null):ChapterOutlineV2{
    const planned=JSON.parse(outline.planned_content_json) as ChapterOutlineContent,first=all[0]!,last=all.at(-1)!,event=parseEvent(snapshot);
    const isLast=outline.event_chapter_outline_id===last.event_chapter_outline_id;
    const firstChapterLaunch=outline.chapter_number===1?firstChapterLaunchFromVolume(snapshot.volumeContent):null;
    const openingChapterResponsibility=openingChapterResponsibilityFromVolume(snapshot.volumeContent,outline.chapter_number);
    const candidate={...input,outlineSchema:'chapter_outline_v2',chapterNumber:outline.chapter_number,
      ...(firstChapterLaunch===null?{firstChapterLaunch:undefined}:{firstChapterLaunch}),
      ...(openingChapterResponsibility===null?{openingChapterResponsibility:undefined}:{openingChapterResponsibility}),
      ...(event.storylineResponsibilities.length===0?{storylineResponsibilities:undefined}:{storylineResponsibilities:event.storylineResponsibilities}),
      title:typeof input.title==='string'&&input.title.trim().length>0?input.title:planned.title,
      sourceStage:{stageNumber:snapshot.eventOrder,title:event.title,
        chapterRange:{start:first.chapter_number,end:last.chapter_number}},
      chapterFunction:planned.eventResponsibility,openingState:contextOpeningState??planned.openingState,
      requiredEndingState:planned.endingState,
      ending:{...(record(input.ending)?input.ending:{}),nextChapterInterface:planned.nextChapterInterface},
      ...(isLast?{stageBoundary:{mustCloseStage:true,resolution:event.requiredResult,
        result:planned.endingState,pendingThreads:event.uncertaintyNotes}}:{stageBoundary:undefined})};
    try{return parseChapterOutlineV2(candidate as Record<string,unknown>);}
    catch(error){throw validation(error instanceof Error?error.message:'详细章纲格式无效。');}
  }
  private assertSequenceContent(scope:BookScope,sequence:EventChapterSequenceRow,snapshot:ActiveEventChapterSnapshot,content:EventChapterSequenceContent){
    const event=parseEvent(snapshot),next=this.repo.nextChapterNumber(scope)+1;
    if(sequence.active_version_id===null&&content.startChapterNumber!==next)throw conflict(`当前下一章是第${next}章，请重新生成连续序列。`);
    if(content.eventTitle!==event.title)throw validation('事件章纲序列必须引用当前事件名称。');
    if(digest(content.eventEndingConditions)!==digest(event.endingConditions))throw validation('事件章纲序列不能改写已确认的事件结束条件。');
    if(content.closureCoverage.length!==event.endingConditions.length
      ||content.closureCoverage.some(item=>!event.endingConditions.includes(item.endingCondition)))
      throw validation('每项事件结束条件都必须在完整章纲序列中标出闭环章节。');
    content.chapters.forEach((chapter,index)=>{
      if(index>0&&chapter.openingState!==content.chapters[index-1]!.endingState)
        throw validation(`第${chapter.chapterNumber}章的开场状态必须承接上一章结束状态。`);
      if(index<content.chapters.length-1&&chapter.nextChapterInterface.trim().length===0)throw validation('每章都必须给出下一章承接点。');
    });
  }
  private assertSequenceCurrent(sequence:EventChapterSequenceRow,snapshot:ActiveEventChapterSnapshot){
    if(sequence.event_version_id!==snapshot.eventVersionId||sequence.volume_plan_version_id!==snapshot.volumePlanVersionId||sequence.status==='stale')
      throw conflict('活动卷纲或事件版本已经变化，请重新规划章纲。');
  }
  private assertDependencies(stored:string,current:VersionReference[]){if(digest(JSON.parse(stored))!==digest(current))throw conflict('章纲上游版本已经变化。');}
  private view(scope:BookScope,row:EventChapterSequenceRow):EventChapterSequenceView{
    const versions=this.repo.listSequenceVersions(scope,row.event_chapter_sequence_id),active=versions.find(item=>item.event_chapter_sequence_version_id===row.active_version_id);
    const snapshot=['completed','archived'].includes(row.status)
      ?this.repo.referencedSnapshot(scope,row.event_id,row.event_version_id,row.volume_plan_version_id)
      :this.repo.activeSnapshot(scope,row.event_id);
    return{sequenceId:row.event_chapter_sequence_id,eventId:row.event_id,eventVersionId:row.event_version_id,
      volumePlanVersionId:row.volume_plan_version_id,revision:row.revision,status:row.status,activeVersionId:row.active_version_id,
      activeVersion:active===undefined?null:sequenceVersionView(active),versions:versions.map(sequenceVersionView),
      outlines:this.repo.listOutlines(scope,row.event_chapter_sequence_id).map(item=>this.outlineView(scope,item)),
      nextChapterNumber:this.repo.nextChapterNumber(scope)+1,valid:snapshot!==undefined&&row.event_version_id===snapshot.eventVersionId
        &&row.volume_plan_version_id===snapshot.volumePlanVersionId&&row.status!=='stale',createdAt:row.created_at,updatedAt:row.updated_at};
  }
  private outlineView(scope:BookScope,row:EventChapterOutlineRow):EventChapterOutlineView{
    const versions=this.repo.listOutlineVersions(scope,row.event_chapter_outline_id),active=versions.find(item=>item.event_chapter_outline_version_id===row.active_version_id);
    return{outlineId:row.event_chapter_outline_id,eventId:row.event_id,chapterNumber:row.chapter_number,order:row.sequence_order,
      revision:row.revision,status:row.status,activeVersionId:row.active_version_id,planned:JSON.parse(row.planned_content_json) as ChapterOutlineContent,
      activeVersion:active===undefined?null:outlineVersionView(active),versions:versions.map(outlineVersionView),createdAt:row.created_at,updatedAt:row.updated_at};
  }
  private snapshot(scope:BookScope,eventId:string){const value=this.repo.activeSnapshot(scope,eventId);if(value===undefined)throw conflict('只有当前已确认事件才能规划章纲。');return value;}
  private sequence(scope:BookScope,eventId:string){const value=this.repo.sequence(scope,required(eventId,'事件标识'));if(value===undefined)throw notFound('当前事件还没有章纲序列。');return value;}
  private requireActiveSequence(scope:BookScope,id:string){const value=this.repo.sequenceById(scope,id);if(value===undefined||value.active_version_id===null||value.status!=='active')throw conflict('请先确认完整事件章纲序列。');return value;}
  private outline(scope:BookScope,id:string){const value=this.repo.outline(scope,required(id,'章纲标识'));if(value===undefined)throw notFound('当前书籍中没有这个章纲。');return value;}
  private requireSequenceVersion(scope:BookScope,sequenceId:string,id:string){const value=this.repo.sequenceVersion(scope,sequenceId,id);if(value===undefined)throw notFound('当前序列中没有这个版本。');return value;}
  private requireOutlineVersion(scope:BookScope,outlineId:string,id:string){const value=this.repo.outlineVersion(scope,outlineId,id);if(value===undefined)throw notFound('当前章纲中没有这个版本。');return value;}
  private workflow(scope:BookScope){const value=this.repo.workflow(scope);if(value===undefined)throw conflict('当前书籍没有创作流程状态。');return value;}
}
function launchPlanFromVolume(content:string){try{
  return parseVolumePlanContent(JSON.parse(content) as unknown).firstVolumeLaunch??null;
}catch{return null;}}
function bindGoldenThreeLaunch(content:EventChapterSequenceContent,volumeContent:string):EventChapterSequenceContent{
  if(content.startChapterNumber!==1){const{goldenThreeLaunch:_,...withoutLaunch}=content;return withoutLaunch;}
  const launch=launchPlanFromVolume(volumeContent);if(launch===null)return content;
  const chapters=launch.goldenThree.map(item=>({chapterNumber:item.chapterNumber as 1|2|3,
    responsibility:item.responsibility,protagonistAction:item.action,pressureOrPull:item.pressure,
    deliveredPayoff:item.payoff,nextExpectation:item.nextExpectation}));
  const goldenThreeLaunch:GoldenThreeLaunchPackage={
    overallPromise:`${launch.first500.changePromise}；前三章第一次回报后继续期待：${chapters[2]!.nextExpectation}`,
    chapters,recalibrateAfterChapterOne:true};
  return{...content,goldenThreeLaunch};
}
function firstChapterLaunchFromVolume(volumeContent:string):FirstChapterLaunchContract|null{
  const launch=launchPlanFromVolume(volumeContent);if(launch===null)return null;const first=launch.goldenThree[0]!;
  return{first500InterestAnchor:`${launch.first500.readerQuestion}；${launch.first500.emotionalGrip}`,
    immediateSituation:launch.first500.immediateSituation,
    firstDesireDangerOrEmotion:`${first.action}；${first.pressure}`,
    requiredEffectiveChange:launch.first500.changePromise,
    firstRevealOfUniqueAppeal:first.responsibility,firstPayoff:first.payoff,nextExpectation:first.nextExpectation,
    writerFreedom:['具体对白、动作、场景调度和意象由主笔自由设计','只要求达到兴趣与变化效果，不限定打斗、打脸或反转手段']};
}
function openingChapterResponsibilityFromVolume(volumeContent:string,chapterNumber:number){
  if(chapterNumber<1||chapterNumber>3)return null;const launch=launchPlanFromVolume(volumeContent);if(launch===null)return null;
  const item=launch.goldenThree.find(chapter=>chapter.chapterNumber===chapterNumber);if(item===undefined)return null;
  return{chapterNumber:item.chapterNumber as 1|2|3,responsibility:item.responsibility,protagonistAction:item.action,
    pressureOrPull:item.pressure,deliveredPayoff:item.payoff,nextExpectation:item.nextExpectation};
}
function parseEvent(s:ActiveEventChapterSnapshot){const value=JSON.parse(s.eventContent) as{title:string;requiredResult:string;endingConditions:string[];
  uncertaintyNotes:string[];storylineResponsibilities?:string[]};return{...value,storylineResponsibilities:value.storylineResponsibilities??[]};}
function baseDependencies(s:ActiveEventChapterSnapshot):VersionReference[]{return[
  {kind:'volume_plan',id:s.volumePlanId,version:s.volumeVersion,contentHash:s.volumeHash,required:true},
  {kind:'story_event',id:s.eventId,version:s.eventVersion,contentHash:s.eventHash,required:true}
];}
function sequenceReference(v:EventChapterSequenceVersionRow):VersionReference{return{kind:'event_chapter_sequence',id:v.event_chapter_sequence_id,
  version:v.version,contentHash:v.content_hash,required:true};}
function sequenceVersionView(r:EventChapterSequenceVersionRow):EventChapterSequenceVersionView{return{sequenceVersionId:r.event_chapter_sequence_version_id,
  sequenceId:r.event_chapter_sequence_id,version:r.version,parentVersionId:r.parent_version_id,status:r.status,
  dependencies:JSON.parse(r.dependencies_json) as VersionReference[],authorInputRefs:JSON.parse(r.author_input_refs_json) as string[],
  content:parseEventChapterSequenceContent(JSON.parse(r.content_json) as unknown),contentHash:r.content_hash,sourceTaskId:r.source_task_id,
  createdAt:r.created_at,confirmedAt:r.confirmed_at};}
function outlineVersionView(r:EventChapterOutlineVersionRow):EventChapterOutlineVersionView{return{outlineVersionId:r.event_chapter_outline_version_id,
  outlineId:r.event_chapter_outline_id,version:r.version,parentVersionId:r.parent_version_id,status:r.status,sequenceVersionId:r.sequence_version_id,
  dependencies:JSON.parse(r.dependencies_json) as VersionReference[],authorInputRefs:JSON.parse(r.author_input_refs_json) as string[],
  content:parseChapterOutlineV2(JSON.parse(r.content_json) as Record<string,unknown>),contentHash:r.content_hash,
  artifactVersionId:r.artifact_version_id,sourceTaskId:r.source_task_id,createdAt:r.created_at,frozenAt:r.frozen_at};}
function digest(v:unknown){return hashStableContractContent(v).slice('sha256:'.length);}
function required(v:unknown,f:string){if(typeof v!=='string'||v.trim().length===0)throw validation(f+'不能为空。');return v.trim();}
function optional(v:unknown,f:string){return v===null||v===undefined||v===''?null:required(v,f);}
function positive(v:unknown,f:string){if(!Number.isInteger(v)||Number(v)<1)throw validation(f+'必须是大于0的整数。');return Number(v);}
function ids(v:unknown,f:string){if(!Array.isArray(v))throw validation(f+'必须是列表。');return[...new Set(v.map(x=>required(x,f)))];}
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function same(a:string,b:string){if(a!==b)throw conflict('同一个幂等键不能用于不同请求。');}
function validation(m:string){return new DomainError(errorCodes.validation,m);}
function conflict(m:string){return new DomainError(errorCodes.bookVersionConflict,m,{},false,409);}
function notFound(m:string){return new DomainError(errorCodes.bookNotFound,m,{},false,404);}
