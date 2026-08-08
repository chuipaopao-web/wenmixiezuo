import type { DatabaseSync } from 'node:sqlite';
import { DomainError,errorCodes } from '../../domain/errors.js';
import { assertBookScope,type BookScope } from '../../domain/scope.js';

export type ChapterRequestCount=1|2|3|4|5;
export interface WritingReadiness{ready:boolean;chapterNumbers:number[];outlineVersionIds:Record<number,string>;missing:string[];}
interface OutlineRow{artifact_id:string;artifact_version_id:string;version:number;content_hash:string;chapter_number:number;source_decision_id:string|null;}
const newWritingStages=['next_chapters_ready','manuscript_in_progress','waiting_for_author','chapter_settlement_in_progress'] as const;

export class WritingReadinessService{
  public constructor(private readonly database:DatabaseSync){}
  public inspect(scope:BookScope,count:ChapterRequestCount):WritingReadiness{
    assertBookScope(scope);
    if(this.database.prepare("SELECT 1 FROM books WHERE owner_id=? AND book_id=? AND status='active'")
      .get(scope.ownerId,scope.bookId)===undefined)throw new DomainError(errorCodes.bookNotFound,'书籍不存在、已归档或无权访问。',{},false,404);
    const firstNumber=this.nextChapterNumber(scope),chapterNumbers=Array.from({length:count},(_,index)=>firstNumber+index),missing:string[]=[];
    const planning=this.database.prepare(`SELECT stage,active_style_version_id,setting_baseline_version_id,master_outline_version_id
      FROM book_planning_states WHERE owner_id=? AND book_id=?`).get(scope.ownerId,scope.bookId) as{
        stage:string;active_style_version_id:string|null;setting_baseline_version_id:string|null;master_outline_version_id:string|null}|undefined;
    const workflow=this.database.prepare(`SELECT stage,active_volume_plan_version_id,active_event_version_id,frozen_chapter_outline_refs_json
      FROM creation_workflow_states WHERE owner_id=? AND book_id=?`).get(scope.ownerId,scope.bookId) as{
        stage:string;active_volume_plan_version_id:string|null;active_event_version_id:string|null;frozen_chapter_outline_refs_json:string}|undefined;
    const newFlowReady=workflow!==undefined&&(newWritingStages as readonly string[]).includes(workflow.stage)
      &&workflow.active_volume_plan_version_id!==null&&workflow.active_event_version_id!==null
      &&Array.isArray(JSON.parse(workflow.frozen_chapter_outline_refs_json))
      &&(JSON.parse(workflow.frozen_chapter_outline_refs_json) as unknown[]).length>0;
    if(planning===undefined)missing.push('planning_state');
    else{
      if(planning.active_style_version_id===null)missing.push('confirmed_style_baseline');
      if(planning.setting_baseline_version_id===null)missing.push('confirmed_setting_baseline');
      if(!newFlowReady){
        if(planning.master_outline_version_id===null)missing.push('confirmed_master_outline');
        if(!['chapter_outline_ready','writing_enabled'].includes(planning.stage))missing.push('planning_stage');
      }
    }
    const expression=this.database.prepare(`SELECT status,narrative_person,viewpoint_distance FROM book_expression_profiles
      WHERE owner_id=? AND book_id=? AND status IN ('provisional','confirmed') ORDER BY version DESC LIMIT 1`)
      .get(scope.ownerId,scope.bookId) as{status:string;narrative_person:string|null;viewpoint_distance:string|null}|undefined;
    if(expression?.status!=='confirmed'||expression.narrative_person===null||expression.viewpoint_distance===null)
      missing.push('confirmed_expression_viewpoint');
    const hasOpening=this.database.prepare(`SELECT 1 FROM book_opening_blueprints WHERE owner_id=? AND book_id=? AND status='active' LIMIT 1`)
      .get(scope.ownerId,scope.bookId)!==undefined;
    const requiredArtifacts=hasOpening?['story_bible']:['creative_plan','story_bible'];
    if(!newFlowReady)requiredArtifacts.push('master_outline');
    for(const type of requiredArtifacts){
      if(this.database.prepare(`SELECT 1 FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id=a.active_version_id
        WHERE a.owner_id=? AND a.book_id=? AND a.artifact_type=? AND a.status='active' AND v.status='selected' LIMIT 1`)
        .get(scope.ownerId,scope.bookId,type)===undefined)missing.push(type);
    }
    const outlineVersionIds:Record<number,string>={};
    for(const chapterNumber of chapterNumbers){
      const outline=this.selectedOutline(scope,chapterNumber);
      if(outline===undefined){missing.push(`chapter_outline:${chapterNumber}`);continue;}
      if(!this.confirmedLegacyDecision(scope,outline.source_decision_id)&&!this.confirmedEventFreeze(scope,outline)){
        missing.push(`confirmed_outline:${chapterNumber}`);continue;
      }
      outlineVersionIds[chapterNumber]=outline.artifact_version_id;
    }
    return{ready:missing.length===0,chapterNumbers,outlineVersionIds,missing:[...new Set(missing)]};
  }
  public assertReady(scope:BookScope,count:ChapterRequestCount):WritingReadiness{
    const readiness=this.inspect(scope,count);if(!readiness.ready)throw new DomainError(errorCodes.operationIncomplete,
      '创作资料尚未准备完成：请先确认文风、叙事视角和最近章纲，再开始正式写作。',
      {missing:readiness.missing,requestedChapterNumbers:readiness.chapterNumbers},false,409);return readiness;
  }
  public outlineVersionId(scope:BookScope,chapterNumber:number):string{
    const row=this.selectedOutline(scope,chapterNumber);
    if(row===undefined||(!this.confirmedLegacyDecision(scope,row.source_decision_id)&&!this.confirmedEventFreeze(scope,row)))
      throw new DomainError(errorCodes.operationIncomplete,`第${chapterNumber}章缺少作者确认且上游版本有效的冻结章纲。`,
        {chapterNumber},false,409);
    return row.artifact_version_id;
  }
  private selectedOutline(scope:BookScope,chapterNumber:number):OutlineRow|undefined{
    return this.database.prepare(`SELECT a.artifact_id,v.artifact_version_id,v.version,v.content_hash,
        CAST(json_extract(v.content_json,'$.chapterNumber') AS INTEGER) AS chapter_number,
        json_extract(v.content_json,'$.sourceDecisionId') AS source_decision_id
      FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id=a.active_version_id
      WHERE a.owner_id=? AND a.book_id=? AND a.artifact_type='chapter_outline' AND a.status='active' AND v.status='selected'
        AND CAST(json_extract(v.content_json,'$.chapterNumber') AS INTEGER)=?
      ORDER BY v.created_at DESC LIMIT 1`).get(scope.ownerId,scope.bookId,chapterNumber) as OutlineRow|undefined;
  }
  private confirmedLegacyDecision(scope:BookScope,decisionId:string|null):boolean{
    return decisionId!==null&&this.database.prepare(`SELECT 1 FROM discussion_decisions
      WHERE decision_id=? AND owner_id=? AND book_id=? AND boss_confirmed=1`).get(decisionId,scope.ownerId,scope.bookId)!==undefined;
  }
  private confirmedEventFreeze(scope:BookScope,outline:OutlineRow):boolean{
    return this.database.prepare(`SELECT 1
      FROM event_chapter_outline_versions ov
      JOIN event_chapter_outlines o ON o.event_chapter_outline_id=ov.event_chapter_outline_id
        AND o.owner_id=ov.owner_id AND o.book_id=ov.book_id
      JOIN event_chapter_sequences s ON s.event_chapter_sequence_id=o.event_chapter_sequence_id
        AND s.owner_id=o.owner_id AND s.book_id=o.book_id
      JOIN creation_workflow_states w ON w.owner_id=o.owner_id AND w.book_id=o.book_id
      WHERE ov.owner_id=? AND ov.book_id=? AND ov.artifact_version_id=? AND ov.status='frozen'
        AND o.status IN ('frozen','settled') AND o.active_version_id=ov.event_chapter_outline_version_id
        AND s.status IN ('active','completed') AND s.active_version_id=ov.sequence_version_id
        AND w.active_event_id=o.event_id AND w.active_event_version_id=ov.event_version_id
        AND w.active_volume_plan_version_id=ov.volume_plan_version_id
        AND w.stage IN ('next_chapters_ready','manuscript_in_progress','waiting_for_author','chapter_settlement_in_progress')
        AND EXISTS(SELECT 1 FROM json_each(w.frozen_chapter_outline_refs_json) ref
          WHERE json_extract(ref.value,'$.id')=? AND CAST(json_extract(ref.value,'$.version') AS INTEGER)=?
            AND json_extract(ref.value,'$.contentHash')=?)
      LIMIT 1`).get(scope.ownerId,scope.bookId,outline.artifact_version_id,outline.artifact_id,outline.version,outline.content_hash)!==undefined;
  }
  private nextChapterNumber(scope:BookScope):number{
    const settled=this.database.prepare(`SELECT COALESCE(MAX(chapter_number),0) AS last FROM chapters
      WHERE owner_id=? AND book_id=? AND settlement_status='settled'`).get(scope.ownerId,scope.bookId) as{last:number};
    return settled.last+1;
  }
}
