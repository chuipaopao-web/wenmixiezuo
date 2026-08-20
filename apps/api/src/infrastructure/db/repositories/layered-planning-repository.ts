import type { DatabaseSync } from 'node:sqlite';
import type { BookStorySpineContent,EventChainContent,VolumeDirectionContent,VolumeRouteSelection } from '@wenmi/contracts';
import type { BookScope } from '../../../domain/scope.js';

export interface VolumeDirectionVersionRow {
  volume_direction_version_id:string;volume_plan_id:string;legacy_volume_plan_version_id:string|null;
  version:number;proposal_id:string;candidate_kind:'candidate_a'|'candidate_b'|'author_edit'|'fusion'|'legacy_projection';
  status:'candidate'|'active'|'superseded'|'archived';parent_version_id:string|null;source_task_id:string|null;
  source_version_ids_json:string;author_input_refs_json:string;content_json:string;content_hash:string;
  idempotency_key:string;created_at:string;confirmed_at:string|null;
}
export interface EventChainVersionRow {
  event_chain_version_id:string;volume_plan_id:string;volume_direction_version_id:string;version:number;
  status:'candidate'|'active'|'superseded'|'archived';parent_version_id:string|null;source_task_id:string|null;
  source_version_ids_json:string;content_json:string;content_hash:string;idempotency_key:string;
  created_at:string;confirmed_at:string|null;
}
export interface BookStorySpineVersionRow {
  book_story_spine_version_id:string;version:number;source_first_volume_direction_version_id:string;
  source_version_ids_json:string;content_json:string;content_hash:string;
  status:'candidate'|'active'|'superseded'|'archived';created_at:string;confirmed_at:string|null;
}
export interface VolumeRouteSelectionRow {
  volume_route_selection_id:string;source_task_id:string;selection_mode:'whole'|'fragments';
  selected_proposal_id:string|null;selected_version_id:string|null;fragments_json:string;
  author_notes:string|null;request_hash:string;idempotency_key:string;created_at:string;
}
export interface EventChainGenerationTaskRow {
  task_id:string;status:string;current_phase:string;error_code:string|null;
  checkpoint_json:string;task_brief_json:string;created_at:string;updated_at:string;
}

export class LayeredPlanningRepository {
  public constructor(private readonly database:DatabaseSync){}

  public nextDirectionVersion(scope:BookScope,volumePlanId:string):number {
    const row=this.database.prepare("SELECT COALESCE(MAX(version),0)+1 AS next_version FROM volume_direction_versions WHERE owner_id=? AND book_id=? AND volume_plan_id=?")
      .get(scope.ownerId,scope.bookId,volumePlanId) as {next_version:number};
    return row.next_version;
  }
  public insertDirection(scope:BookScope,input:{
    id:string;volumePlanId:string;legacyVersionId:string|null;version:number;proposalId:string;
    candidateKind:VolumeDirectionVersionRow['candidate_kind'];parentVersionId:string|null;
    sourceTaskId:string|null;sourceVersionIds:string[];authorInputRefs:string[];
    content:VolumeDirectionContent;contentHash:string;idempotencyKey:string;now:string;
  }):void {
    this.database.prepare("INSERT INTO volume_direction_versions(volume_direction_version_id,owner_id,book_id,volume_plan_id,legacy_volume_plan_version_id,version,proposal_id,candidate_kind,status,parent_version_id,source_task_id,source_version_ids_json,author_input_refs_json,content_json,content_hash,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?, 'candidate', ?,?,?,?,?,?,?,?)")
      .run(input.id,scope.ownerId,scope.bookId,input.volumePlanId,input.legacyVersionId,input.version,
        input.proposalId,input.candidateKind,input.parentVersionId,input.sourceTaskId,
        JSON.stringify(input.sourceVersionIds),JSON.stringify(input.authorInputRefs),JSON.stringify(input.content),
        input.contentHash,input.idempotencyKey,input.now);
  }
  public direction(scope:BookScope,id:string):VolumeDirectionVersionRow|undefined {
    return this.database.prepare("SELECT * FROM volume_direction_versions WHERE owner_id=? AND book_id=? AND volume_direction_version_id=?")
      .get(scope.ownerId,scope.bookId,id) as VolumeDirectionVersionRow|undefined;
  }
  public directionByLegacy(scope:BookScope,legacyVersionId:string):VolumeDirectionVersionRow|undefined {
    return this.database.prepare("SELECT * FROM volume_direction_versions WHERE owner_id=? AND book_id=? AND legacy_volume_plan_version_id=?")
      .get(scope.ownerId,scope.bookId,legacyVersionId) as VolumeDirectionVersionRow|undefined;
  }
  public directionByIdempotency(scope:BookScope,key:string):VolumeDirectionVersionRow|undefined {
    return this.database.prepare("SELECT * FROM volume_direction_versions WHERE owner_id=? AND book_id=? AND idempotency_key=?")
      .get(scope.ownerId,scope.bookId,key) as VolumeDirectionVersionRow|undefined;
  }
  public listDirections(scope:BookScope,volumePlanId:string):VolumeDirectionVersionRow[] {
    return this.database.prepare("SELECT * FROM volume_direction_versions WHERE owner_id=? AND book_id=? AND volume_plan_id=? ORDER BY version")
      .all(scope.ownerId,scope.bookId,volumePlanId) as unknown as VolumeDirectionVersionRow[];
  }
  public activeDirection(scope:BookScope,volumePlanId:string):VolumeDirectionVersionRow|undefined {
    return this.database.prepare("SELECT * FROM volume_direction_versions WHERE owner_id=? AND book_id=? AND volume_plan_id=? AND status='active'")
      .get(scope.ownerId,scope.bookId,volumePlanId) as VolumeDirectionVersionRow|undefined;
  }
  public activateDirection(scope:BookScope,id:string,now:string):boolean {
    const target=this.direction(scope,id);if(target===undefined)return false;
    this.database.prepare("UPDATE volume_direction_versions SET status='superseded' WHERE owner_id=? AND book_id=? AND volume_plan_id=? AND status='active'")
      .run(scope.ownerId,scope.bookId,target.volume_plan_id);
    return this.database.prepare("UPDATE volume_direction_versions SET status='active',confirmed_at=? WHERE owner_id=? AND book_id=? AND volume_direction_version_id=? AND status IN ('candidate','superseded')")
      .run(now,scope.ownerId,scope.bookId,id).changes===1;
  }

  public routeSelectionByIdempotency(scope:BookScope,volumePlanId:string,key:string):VolumeRouteSelectionRow|undefined {
    return this.database.prepare("SELECT * FROM volume_route_selections WHERE owner_id=? AND book_id=? AND volume_plan_id=? AND idempotency_key=?")
      .get(scope.ownerId,scope.bookId,volumePlanId,key) as VolumeRouteSelectionRow|undefined;
  }
  public insertRouteSelection(scope:BookScope,input:{
    id:string;volumePlanId:string;sourceTaskId:string;selection:VolumeRouteSelection;
    requestHash:string;idempotencyKey:string;now:string;
  }):void {
    this.database.prepare("INSERT INTO volume_route_selections(volume_route_selection_id,owner_id,book_id,volume_plan_id,source_task_id,selection_mode,selected_proposal_id,selected_version_id,fragments_json,author_notes,request_hash,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(input.id,scope.ownerId,scope.bookId,input.volumePlanId,input.sourceTaskId,input.selection.selectionMode,
        input.selection.selectedProposalId??null,input.selection.selectedVersionId??null,
        JSON.stringify(input.selection.fragments),input.selection.authorNotes,input.requestHash,input.idempotencyKey,input.now);
  }

  public nextStorySpineVersion(scope:BookScope):number {
    return (this.database.prepare("SELECT COALESCE(MAX(version),0)+1 AS next_version FROM book_story_spine_versions WHERE owner_id=? AND book_id=?")
      .get(scope.ownerId,scope.bookId) as {next_version:number}).next_version;
  }
  public insertStorySpine(scope:BookScope,input:{
    id:string;version:number;sourceDirectionVersionId:string;sourceVersionIds:string[];
    content:BookStorySpineContent;contentHash:string;now:string;
  }):void {
    this.database.prepare("INSERT INTO book_story_spine_versions(book_story_spine_version_id,owner_id,book_id,version,source_first_volume_direction_version_id,source_version_ids_json,content_json,content_hash,status,created_at) VALUES(?,?,?,?,?,?,?,?, 'candidate', ?)")
      .run(input.id,scope.ownerId,scope.bookId,input.version,input.sourceDirectionVersionId,
        JSON.stringify(input.sourceVersionIds),JSON.stringify(input.content),input.contentHash,input.now);
  }
  public storySpine(scope:BookScope,id:string):BookStorySpineVersionRow|undefined {
    return this.database.prepare("SELECT * FROM book_story_spine_versions WHERE owner_id=? AND book_id=? AND book_story_spine_version_id=?")
      .get(scope.ownerId,scope.bookId,id) as BookStorySpineVersionRow|undefined;
  }
  public activeStorySpine(scope:BookScope):BookStorySpineVersionRow|undefined {
    return this.database.prepare("SELECT * FROM book_story_spine_versions WHERE owner_id=? AND book_id=? AND status='active'")
      .get(scope.ownerId,scope.bookId) as BookStorySpineVersionRow|undefined;
  }
  public storySpineCandidates(scope:BookScope):BookStorySpineVersionRow[] {
    return this.database.prepare("SELECT * FROM book_story_spine_versions WHERE owner_id=? AND book_id=? ORDER BY version")
      .all(scope.ownerId,scope.bookId) as unknown as BookStorySpineVersionRow[];
  }
  public activateStorySpine(scope:BookScope,id:string,now:string):boolean {
    this.database.prepare("UPDATE book_story_spine_versions SET status='superseded' WHERE owner_id=? AND book_id=? AND status='active'")
      .run(scope.ownerId,scope.bookId);
    return this.database.prepare("UPDATE book_story_spine_versions SET status='active',confirmed_at=? WHERE owner_id=? AND book_id=? AND book_story_spine_version_id=? AND status IN ('candidate','superseded')")
      .run(now,scope.ownerId,scope.bookId,id).changes===1;
  }

  public nextEventChainVersion(scope:BookScope,volumePlanId:string):number {
    return (this.database.prepare("SELECT COALESCE(MAX(version),0)+1 AS next_version FROM event_chain_versions WHERE owner_id=? AND book_id=? AND volume_plan_id=?")
      .get(scope.ownerId,scope.bookId,volumePlanId) as {next_version:number}).next_version;
  }
  public insertEventChain(scope:BookScope,input:{
    id:string;volumePlanId:string;directionVersionId:string;version:number;parentVersionId:string|null;
    sourceTaskId:string|null;sourceVersionIds:string[];content:EventChainContent;
    contentHash:string;idempotencyKey:string;now:string;
  }):void {
    this.database.prepare("INSERT INTO event_chain_versions(event_chain_version_id,owner_id,book_id,volume_plan_id,volume_direction_version_id,version,status,parent_version_id,source_task_id,source_version_ids_json,content_json,content_hash,idempotency_key,created_at) VALUES(?,?,?,?,?,?, 'candidate', ?,?,?,?,?,?,?)")
      .run(input.id,scope.ownerId,scope.bookId,input.volumePlanId,input.directionVersionId,input.version,
        input.parentVersionId,input.sourceTaskId,JSON.stringify(input.sourceVersionIds),JSON.stringify(input.content),
        input.contentHash,input.idempotencyKey,input.now);
  }
  public eventChain(scope:BookScope,id:string):EventChainVersionRow|undefined {
    return this.database.prepare("SELECT * FROM event_chain_versions WHERE owner_id=? AND book_id=? AND event_chain_version_id=?")
      .get(scope.ownerId,scope.bookId,id) as EventChainVersionRow|undefined;
  }
  public eventChainByIdempotency(scope:BookScope,key:string):EventChainVersionRow|undefined {
    return this.database.prepare("SELECT * FROM event_chain_versions WHERE owner_id=? AND book_id=? AND idempotency_key=?")
      .get(scope.ownerId,scope.bookId,key) as EventChainVersionRow|undefined;
  }
  public eventChainBySourceTask(scope:BookScope,volumePlanId:string,taskId:string):EventChainVersionRow|undefined {
    return this.database.prepare("SELECT * FROM event_chain_versions WHERE owner_id=? AND book_id=? AND volume_plan_id=? AND source_task_id=? ORDER BY version DESC LIMIT 1")
      .get(scope.ownerId,scope.bookId,volumePlanId,taskId) as EventChainVersionRow|undefined;
  }
  public activeEventChain(scope:BookScope,volumePlanId:string):EventChainVersionRow|undefined {
    return this.database.prepare("SELECT ec.* FROM event_chain_versions ec JOIN volume_direction_versions vd ON vd.owner_id=ec.owner_id AND vd.book_id=ec.book_id AND vd.volume_direction_version_id=ec.volume_direction_version_id AND vd.status='active' WHERE ec.owner_id=? AND ec.book_id=? AND ec.volume_plan_id=? AND ec.status='active'")
      .get(scope.ownerId,scope.bookId,volumePlanId) as EventChainVersionRow|undefined;
  }
  public listEventChains(scope:BookScope,volumePlanId:string):EventChainVersionRow[] {
    return this.database.prepare("SELECT * FROM event_chain_versions WHERE owner_id=? AND book_id=? AND volume_plan_id=? ORDER BY version")
      .all(scope.ownerId,scope.bookId,volumePlanId) as unknown as EventChainVersionRow[];
  }
  public latestEventChainGenerationTask(scope:BookScope,volumePlanId:string):EventChainGenerationTaskRow|undefined {
    return this.database.prepare("SELECT task_id,status,current_phase,error_code,checkpoint_json,task_brief_json,created_at,updated_at FROM tasks WHERE owner_id=? AND book_id=? AND task_type='event_chain_generation' AND json_extract(task_brief_json,'$.volumePlanId')=? ORDER BY created_at DESC,task_id DESC LIMIT 1")
      .get(scope.ownerId,scope.bookId,volumePlanId) as EventChainGenerationTaskRow|undefined;
  }
  public attachEventChainWaitingTask(scope:BookScope,input:{volumePlanId:string;taskId:string;expectedWorkflowVersion:number;now:string}):boolean {
    return this.database.prepare("UPDATE creation_workflow_states SET stage='event_sequence_in_progress',waiting_task_id=?,blocking_reason=NULL,updated_at=? WHERE owner_id=? AND book_id=? AND planning_version=? AND active_volume_plan_id=? AND stage IN ('volume_plan_confirmed','event_sequence_in_progress') AND (waiting_task_id IS NULL OR waiting_task_id=? OR EXISTS(SELECT 1 FROM tasks t WHERE t.owner_id=creation_workflow_states.owner_id AND t.book_id=creation_workflow_states.book_id AND t.task_id=creation_workflow_states.waiting_task_id AND t.status IN ('failed','cancelled','succeeded','interrupted','blocked')))")
      .run(input.taskId,input.now,scope.ownerId,scope.bookId,input.expectedWorkflowVersion,input.volumePlanId,input.taskId).changes===1;
  }

  public supersedeEventChainsExceptDirection(scope:BookScope,volumePlanId:string,directionVersionId:string):number {
    return Number(this.database.prepare("UPDATE event_chain_versions SET status='superseded' WHERE owner_id=? AND book_id=? AND volume_plan_id=? AND volume_direction_version_id<>? AND status IN ('candidate','active')")
      .run(scope.ownerId,scope.bookId,volumePlanId,directionVersionId).changes);
  }
  public activateEventChain(scope:BookScope,id:string,now:string):boolean {
    const target=this.eventChain(scope,id);if(target===undefined)return false;
    this.database.prepare("UPDATE event_chain_versions SET status='superseded' WHERE owner_id=? AND book_id=? AND volume_plan_id=? AND event_chain_version_id<>? AND status IN ('candidate','active')")
      .run(scope.ownerId,scope.bookId,target.volume_plan_id,id);
    return this.database.prepare("UPDATE event_chain_versions SET status='active',confirmed_at=? WHERE owner_id=? AND book_id=? AND event_chain_version_id=? AND status IN ('candidate','superseded')")
      .run(now,scope.ownerId,scope.bookId,id).changes===1;
  }
}
