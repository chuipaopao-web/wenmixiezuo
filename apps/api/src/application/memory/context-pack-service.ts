import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { runWithSqliteBusyRetry } from '../../infrastructure/db/sqlite-busy-retry.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { stableJson } from '../knowledge/canon-service.js';
import { compileWriterSettingContext,type WriterSettingItem } from '../creation/writer-setting-context.js';

export type ContextConstraintStrength = 'hard_fact' | 'current_task' | 'soft_reference' | 'open_space';
export type ContextTruthStatus = 'planned' | 'confirmed' | 'actual';
export type ContextKnowledgeZone = 'hard_fact' | 'author_plan' | 'open_question' | 'ai_candidate';
export const contextComponentKinds=['BookCorePack','SettingConstraintPack','BookStorySpinePack','VolumeResponsibilityPack',
  'EventResponsibilityPack','ChapterTaskPack','RecentActualStatePack','StoryThreadPack'] as const;
export type ContextComponentKind=typeof contextComponentKinds[number];

export interface ContextSource {
  sourceType: string;
  sourceId: string;
  content: string;
  reason: string;
  priority: number;
  version?: number | string;
  constraintStrength?: ContextConstraintStrength;
  truthStatus?: ContextTruthStatus;
  knowledgeZone?: ContextKnowledgeZone;
  scopeType?: 'book' | 'volume' | 'event' | 'chapter' | 'scene' | 'task';
  scopeId?: string;
  dependencies?: string[];
  componentKind?: ContextComponentKind;
}

export interface ContextPackInput {
  taskId: string;
  agentId: string;
  chapterId?: string | null;
  canonRevision: number;
  positioningVersion: number;
  outlineVersionId?: string | null;
  writingContractVersionId?: string | null;
  tokenBudget: number;
  characterBudget?: number;
  hardSourceTokenReserve?: number;
  hardSourceCharacterReserve?: number;
  policyVersion?: string;
  hardSources: ContextSource[];
  optionalSources: ContextSource[];
}

export interface ContextPackRecord {
  contextPackId: string;
  totalTokens: number;
  totalCharacters: number;
  contentHash: string;
  sourceFingerprint: string;
  policyVersion: string;
  sources: Array<ContextSource & { tokenCount: number; hard: boolean }>;
  excluded: Array<{ sourceType: string; sourceId: string; reason: string; tokenCount: number }>;
}

export class ContextPackService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public build(scope: BookScope, input: ContextPackInput): ContextPackRecord {
    assertBookScope(scope);
    const automaticStoryThreadSources=loadStoryThreadSources(this.database,scope,input);
    const automaticSettingSources=loadSettingClauseSources(this.database,scope,input);
    const requestedHardSources=[...input.hardSources,...automaticSettingSources.hard];
    const requestedOptionalSources=[...input.optionalSources,...automaticSettingSources.optional,...automaticStoryThreadSources];
    const baseTokenBudget = input.tokenBudget;
    const baseCharacterBudget = input.characterBudget ?? Number.MAX_SAFE_INTEGER;
    const hardSourceTokenReserve = budgetReserve(input.hardSourceTokenReserve);
    const hardSourceCharacterReserve = budgetReserve(input.hardSourceCharacterReserve);
    const policyVersion = input.policyVersion?.trim() || 'context-pack-v2';
    const excluded: ContextPackRecord['excluded'] = [];
    const seenContent = new Set<string>();
    const hardSources = deduplicateCoveredHardSources(
      deduplicateExactSources(requestedHardSources, seenContent, excluded, 'duplicate_of_hard_source'),
      excluded
    );
    const hard = hardSources.map((source) => annotateSource(source, true));
    const hardTokens = hard.reduce((sum, source) => sum + source.tokenCount, 0);
    const hardCharacters = hard.reduce((sum, source) => sum + source.characterCount, 0);
    const hardTokenLimit = baseTokenBudget + hardSourceTokenReserve;
    const hardCharacterLimit = baseCharacterBudget === Number.MAX_SAFE_INTEGER
      ? Number.MAX_SAFE_INTEGER
      : baseCharacterBudget + hardSourceCharacterReserve;
    if (hardTokens > hardTokenLimit) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        'Token预算不足以容纳不可截断的硬来源',
        { tokenBudget: hardTokenLimit, baseTokenBudget, hardSourceTokenReserve,
          requiredHardTokens: hardTokens, hardSourceIds: hard.map((source) => source.sourceId) },
        false, 409
      );
    }
    if (hardCharacters > hardCharacterLimit) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '字符预算不足以容纳不可截断的硬来源',
        {
          characterBudget: hardCharacterLimit,
          baseCharacterBudget,
          hardSourceCharacterReserve,
          requiredHardCharacters: hardCharacters,
          hardSourceIds: hard.map((source) => source.sourceId)
        },
        false,
        409
      );
    }
    const tokenBudget = Math.max(baseTokenBudget, hardTokens);
    const characterBudget = baseCharacterBudget === Number.MAX_SAFE_INTEGER
      ? Number.MAX_SAFE_INTEGER
      : Math.max(baseCharacterBudget, hardCharacters);
    const included: Array<ContextSource & { tokenCount: number; hard: boolean }> = [...hard];
    let totalTokens = hardTokens;
    let totalCharacters = hardCharacters;
    const optionalSources = deduplicateExactSources(
      requestedOptionalSources,
      seenContent,
      excluded,
      'duplicate_of_included_source'
    );
    const optional = optionalSources
      .map((source) => annotateSource(source, false))
      .sort((left, right) => right.priority - left.priority || left.sourceId.localeCompare(right.sourceId));
    // P0-6: 同源去重。完整不可变版本已作为硬来源注入时，排除同版本/同一物理正文的派生检索块，
    // 记录 duplicate_of_hard_source。不同版本、不同故事时间的来源不按相似文本误删，仅按版本血缘
    // 与同一正文版本ID去重。硬正文来源可能只带 sourceId（manuscriptVersionId）而无 version，
    // 而检索块带 version(contentHash) 且 sourceId 形如 manuscriptVersionId:clusterId，
    // 因此同时收录 version 与 sourceId，并对检索块按 version 或 sourceId 根核对。
    const completeHardSourceIds = new Set(hard
      .filter((source) => !['previous_chapter_end', 'previous_chapter_tail', 'previous_chapter_anchors'].includes(source.sourceType))
      .map((source) => source.sourceId));
    const hardManuscriptKeys = new Set<string>();
    for (const source of hard) {
      if (!source.sourceType.includes('manuscript') || source.sourceType.includes('retrieval')) continue;
      if (source.version !== undefined) hardManuscriptKeys.add(String(source.version));
      hardManuscriptKeys.add(source.sourceId);
    }
    const dedupedOptional = optional.filter((source) => {
      const bySourceIdRoot = source.sourceId.split(':')[0] ?? source.sourceId;
      const coveredByHardContent = hard.some((hardSource) => {
        const hardContent = hardSource.content.trim();
        const optionalContent = source.content.trim();
        return optionalContent.length > 0 && hardContent.includes(optionalContent);
      });
      if (
        coveredByHardContent
        || (source.sourceType.startsWith('retrieval:') && completeHardSourceIds.has(bySourceIdRoot))
      ) {
        excluded.push({ sourceType: source.sourceType, sourceId: source.sourceId, reason: 'duplicate_of_hard_source', tokenCount: source.tokenCount });
        return false;
      }
      if (!source.sourceType.includes('manuscript')) return true;
      const byVersion = source.version === undefined ? null : String(source.version);
      if ((byVersion !== null && hardManuscriptKeys.has(byVersion)) || hardManuscriptKeys.has(bySourceIdRoot)) {
        excluded.push({ sourceType: source.sourceType, sourceId: source.sourceId, reason: 'duplicate_of_hard_source', tokenCount: source.tokenCount });
        return false;
      }
      return true;
    });
    for (const source of dedupedOptional) {
      if (
        totalTokens + source.tokenCount <= tokenBudget
        && totalCharacters + source.characterCount <= characterBudget
      ) {
        included.push(source);
        totalTokens += source.tokenCount;
        totalCharacters += source.characterCount;
      } else {
        excluded.push({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          reason: totalCharacters + source.characterCount > characterBudget
            ? 'character_budget_lower_priority'
            : 'token_budget_lower_priority',
          tokenCount: source.tokenCount
        });
      }
    }
    const manifest = included.map((source, order) => ({
      order,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      version: source.version ?? null,
      reason: source.reason,
      priority: source.priority,
      originalLength: source.content.length,
      compression: 'none',
      tokenCount: source.tokenCount,
      hard: source.hard,
      constraintStrength: source.constraintStrength,
      truthStatus: source.truthStatus,
      knowledgeZone: source.knowledgeZone,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      dependencies: source.dependencies,
      content: source.content
    }));
    const immutableContent = stableJson({
      taskId: input.taskId,
      agentId: input.agentId,
      chapterId: input.chapterId ?? null,
      canonRevision: input.canonRevision,
      positioningVersion: input.positioningVersion,
      policyVersion,
      characterBudget: characterBudget === Number.MAX_SAFE_INTEGER ? null : characterBudget,
      tokenBudget,
      manifest,
      excluded
    });
    const contentHash = createHash('sha256').update(immutableContent).digest('hex');
    const sourceFingerprint = createHash('sha256').update(stableJson(manifest.map((source) => ({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      version: source.version,
      constraintStrength: source.constraintStrength,
      truthStatus: source.truthStatus,
      knowledgeZone: source.knowledgeZone,
      scopeType: source.scopeType,
      scopeId: source.scopeId,
      dependencies: source.dependencies,
      contentHash: createHash('sha256').update(source.content).digest('hex')
    })))).digest('hex');
    const contextPackId = this.ids.next();
    runWithSqliteBusyRetry(() => this.database.prepare(`
      INSERT INTO context_packs (
        context_pack_id, owner_id, book_id, task_id, agent_id, chapter_id,
        canon_revision, positioning_version, outline_version_id,
        writing_contract_version_id, token_budget, total_tokens,
        source_manifest_json, excluded_sources_json, content_hash,
        policy_version, source_fingerprint, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      contextPackId, scope.ownerId, scope.bookId, input.taskId, input.agentId,
      input.chapterId ?? null, input.canonRevision, input.positioningVersion,
      input.outlineVersionId ?? null, input.writingContractVersionId ?? null,
      tokenBudget, totalTokens, stableJson(manifest), stableJson(excluded),
      contentHash, policyVersion, sourceFingerprint, this.clock.now().toISOString()
    ));
    persistContextPackComponents(this.database,this.ids,scope,contextPackId,manifest,excluded,[...requestedHardSources,...requestedOptionalSources]);
    return {
      contextPackId,
      totalTokens,
      totalCharacters,
      contentHash,
      sourceFingerprint,
      policyVersion,
      sources: included,
      excluded
    };
  }
}
function budgetReserve(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.floor(value));
}
function loadSettingClauseSources(database:DatabaseSync,scope:BookScope,input:ContextPackInput):{
  hard:ContextSource[];optional:ContextSource[]}{
  const scopeIds=new Set<string>([scope.bookId]);
  for(const source of [...input.hardSources,...input.optionalSources]){
    scopeIds.add(source.sourceId);if(source.scopeId!==undefined)scopeIds.add(source.scopeId);
  }
  const rows=database.prepare(`SELECT setting_clause_id,kind,statement,strength,truth_status,scope_type,scope_id,
    source_version_id,dependency_version_ids_json FROM setting_clauses
    WHERE owner_id=? AND book_id=? AND status='active' ORDER BY source_version_id,setting_clause_id`)
    .all(scope.ownerId,scope.bookId) as unknown as Array<Record<string,unknown>>;
  const scoped=rows.filter(row=>row.scope_type==='book'||scopeIds.has(String(row.scope_id)));
  const grouped=new Map<string,WriterSettingItem>();
  for(const row of scoped){
    const sourceVersion=String(row.source_version_id),match=/^setting-item:(.+):v\d+$/u.exec(sourceVersion);
    const itemKey=match?.[1]??sourceVersion,current=grouped.get(itemKey);
    grouped.set(itemKey,{itemKey,label:itemKey,content:current===undefined?String(row.statement):current.content+'\n'+String(row.statement)});
  }
  const query=[...input.hardSources,...input.optionalSources]
    .filter(source=>source.componentKind!=='SettingConstraintPack'&&!/setting/u.test(source.sourceType))
    .map(source=>source.content).join('\n');
  const selected=new Set(compileWriterSettingContext([...grouped.values()],query).hardItems.map(item=>item.itemKey));
  const hard:ContextSource[]=[],optional:ContextSource[]=[];
  for(const row of scoped){
    const sourceVersion=String(row.source_version_id),match=/^setting-item:(.+):v\d+$/u.exec(sourceVersion);
    const itemKey=match?.[1]??sourceVersion;if(!selected.has(itemKey))continue;
    const strength=String(row.strength) as ContextConstraintStrength;
    const source:ContextSource={sourceType:'setting_clause:'+String(row.kind),sourceId:String(row.setting_clause_id),
      version:sourceVersion,content:String(row.statement),reason:['world-stage','social-order','rules-costs','boundaries-blanks'].includes(itemKey)
        ?'四项宏观核心设定的确认片段，完整进入任务资料。':'与当前任务语义相关的确认设定片段。',priority:90,
      constraintStrength:strength,truthStatus:String(row.truth_status) as ContextTruthStatus,
      scopeType:String(row.scope_type) as 'book'|'volume'|'event'|'chapter'|'scene',scopeId:String(row.scope_id),
      dependencies:JSON.parse(String(row.dependency_version_ids_json)) as string[],componentKind:'SettingConstraintPack'};
    if(strength==='hard_fact'||strength==='open_space')hard.push(source);else optional.push(source);
  }
  return{hard,optional};
}
function loadStoryThreadSources(database:DatabaseSync,scope:BookScope,input:ContextPackInput):ContextSource[]{
  const scopeIds=new Set<string>([scope.bookId]);
  for(const source of [...input.hardSources,...input.optionalSources]){
    scopeIds.add(source.sourceId);if(source.scopeId!==undefined)scopeIds.add(source.scopeId);
  }
  const rows=database.prepare(`SELECT story_thread_record_id,thread_key,title,thread_type,scope_type,scope_id,status,
    planned_window_json,actual_evidence_version_ids_json,revision FROM story_thread_records
    WHERE owner_id=? AND book_id=? AND status NOT IN ('resolved','abandoned_by_author')`)
    .all(scope.ownerId,scope.bookId) as unknown as Array<Record<string,unknown>>;
  return rows.filter(row=>row.scope_type==='book'||scopeIds.has(String(row.scope_id))).map(row=>({
    sourceType:'story_thread',sourceId:String(row.story_thread_record_id),version:Number(row.revision),
    content:stableJson({title:row.title,type:row.thread_type,status:row.status,
      plannedWindow:row.planned_window_json===null?null:JSON.parse(String(row.planned_window_json)),
      actualEvidenceCount:(JSON.parse(String(row.actual_evidence_version_ids_json)) as unknown[]).length}),
    reason:row.status==='due'?'已经到期但尚未兑现的故事线程，当前任务必须显式处理或说明延后。':'与当前业务对象直接相关的未解决故事线程。',
    priority:row.status==='due'?92:row.status==='advanced'?78:row.status==='planted'?72:52,
    constraintStrength:row.status==='due'?'current_task':'soft_reference',
    truthStatus:row.status==='planned'?'planned':'actual',scopeType:String(row.scope_type) as 'book'|'volume'|'event',
    scopeId:String(row.scope_id),componentKind:'StoryThreadPack'
  }));
}
function persistContextPackComponents(database:DatabaseSync,ids:IdGenerator,scope:BookScope,contextPackId:string,
  manifest:Array<Record<string,unknown>>,excluded:Array<{sourceType:string;sourceId:string;reason:string;tokenCount:number}>,
  originalSources:ContextSource[]):void{
  const sourceKinds=new Map(originalSources.map(source=>[source.sourceType+'\u0000'+source.sourceId,
    source.componentKind??inferComponentKind(source.sourceType)]));
  for(const kind of contextComponentKinds){
    const included=manifest.filter(source=>{
      const sourceType=String(source.sourceType),sourceId=String(source.sourceId);
      return (sourceKinds.get(sourceType+'\u0000'+sourceId)??inferComponentKind(sourceType))===kind;
    });
    const omitted=excluded.filter(source=>
      (sourceKinds.get(source.sourceType+'\u0000'+source.sourceId)??inferComponentKind(source.sourceType))===kind);
    const sourceVersionIds=[...new Set(included.map(source=>String(source.version??source.sourceId)))];
    const includedReasons=included.map(source=>({sourceType:source.sourceType,sourceId:source.sourceId,
      reason:source.reason,hard:source.hard,constraintStrength:source.constraintStrength,truthStatus:source.truthStatus,
      knowledgeZone:source.knowledgeZone}));
    const excludedReasons=omitted.map(source=>({sourceType:source.sourceType,sourceId:source.sourceId,reason:source.reason}));
    const tokenBudget=included.reduce((sum,source)=>sum+Number(source.tokenCount??0),0);
    const characterBudget=included.reduce((sum,source)=>sum+Number(source.originalLength??0),0);
    const contentHash=createHash('sha256').update(stableJson({kind,sourceVersionIds,includedReasons,excludedReasons,
      tokenBudget,characterBudget})).digest('hex');
    runWithSqliteBusyRetry(()=>database.prepare(`INSERT INTO context_pack_components(
      context_pack_component_id,owner_id,book_id,context_pack_id,component_kind,compile_version,
      source_version_ids_json,included_reasons_json,excluded_reasons_json,token_budget,character_budget,content_hash,created_at)
      VALUES(?,?,?,?,?,1,?,?,?,?,?,?,datetime('now'))`).run(ids.next(),scope.ownerId,scope.bookId,contextPackId,kind,
        stableJson(sourceVersionIds),stableJson(includedReasons),stableJson(excludedReasons),tokenBudget,characterBudget,contentHash));
  }
}
function inferComponentKind(sourceType:string):ContextComponentKind{
  if(/story[_:-]?thread/u.test(sourceType))return'StoryThreadPack';
  if(/story[_:-]?spine/u.test(sourceType))return'BookStorySpinePack';
  if(/setting|rule|boundary|world|character|organization|resource/u.test(sourceType))return'SettingConstraintPack';
  if(/previous|manuscript|settlement|canon|fact|actual|continuity/u.test(sourceType))return'RecentActualStatePack';
  if(/chapter|outline|writing_contract|work_order|first_500/u.test(sourceType))return'ChapterTaskPack';
  if(/event|story_arc/u.test(sourceType))return'EventResponsibilityPack';
  if(/volume/u.test(sourceType))return'VolumeResponsibilityPack';
  return'BookCorePack';
}
function annotateSource(source: ContextSource, hard: boolean): ContextSource & {
  tokenCount: number; characterCount: number; hard: boolean; knowledgeZone: ContextKnowledgeZone;
} {
  const truthStatus = source.truthStatus ?? inferTruthStatus(source.sourceType);
  const knowledgeZone = source.knowledgeZone ?? inferKnowledgeZone(source.sourceType, truthStatus);
  let constraintStrength = source.constraintStrength ?? inferConstraintStrength(source.sourceType, hard);
  if (knowledgeZone === 'ai_candidate' && constraintStrength === 'hard_fact') constraintStrength = 'current_task';
  if (knowledgeZone === 'open_question') constraintStrength = 'open_space';
  return { ...source, tokenCount: estimateTokens(source.content), characterCount: source.content.length, hard,
    constraintStrength, truthStatus, knowledgeZone, scopeType: source.scopeType ?? inferScopeType(source.sourceType),
    scopeId: source.scopeId ?? source.sourceId, dependencies: source.dependencies ?? [] };
}

function inferKnowledgeZone(sourceType: string, truthStatus: ContextTruthStatus): ContextKnowledgeZone {
  if (/(open[_:-]?question|unknown|unresolved_question)/iu.test(sourceType)) return 'open_question';
  if (/(candidate|proposal|recommendation|suggestion|independent_.*candidate)/iu.test(sourceType)) return 'ai_candidate';
  if (truthStatus === 'actual') return 'hard_fact';
  if (truthStatus === 'planned' || /(author[_:-]?(?:input|boundary|frontier)|plan|outline|contract|work_order)/iu.test(sourceType)) return 'author_plan';
  return 'hard_fact';
}
function inferConstraintStrength(sourceType: string, hard: boolean): ContextConstraintStrength {
  if (!hard) return 'soft_reference';
  if (/(system_rule|work_order|writing_contract|chapter_outline|owner_.*instruction|task)/u.test(sourceType)) {
    return 'current_task';
  }
  if (/(creative_freedom|open_space)/u.test(sourceType)) return 'open_space';
  if (/(style|tone|genre|template|brief)/u.test(sourceType)) return 'soft_reference';
  return 'hard_fact';
}

function inferTruthStatus(sourceType: string): ContextTruthStatus {
  if (/(manuscript|settlement|previous_chapter|commitment|canon|fact)/u.test(sourceType)) return 'actual';
  if (/(plan|outline|contract|work_order|template|event_seed)/u.test(sourceType)) return 'planned';
  return 'confirmed';
}

function inferScopeType(sourceType: string): NonNullable<ContextSource['scopeType']> {
  if (/(chapter|writing_contract|work_order)/u.test(sourceType)) return 'chapter';
  if (/(event|story_arc)/u.test(sourceType)) return 'event';
  if (/volume/u.test(sourceType)) return 'volume';
  if (/(task|owner_.*instruction)/u.test(sourceType)) return 'task';
  return 'book';
}

function deduplicateCoveredHardSources(
  sources: ContextSource[],
  excluded: ContextPackRecord['excluded']
): ContextSource[] {
  const previousChapterSourceTypes = new Set(['previous_chapter_full', 'previous_chapter_end', 'previous_chapter_tail']);
  const previousChapterSources = sources.filter((source) => previousChapterSourceTypes.has(source.sourceType));
  return sources.filter((source) => {
    if (!previousChapterSourceTypes.has(source.sourceType)) return true;
    const excerpt = source.content.trim();
    const covered = previousChapterSources.some((candidate) => {
      if (candidate === source) return false;
      const candidateContent = candidate.content.trim();
      return candidateContent.length > excerpt.length && candidateContent.includes(excerpt);
    });
    if (excerpt.length === 0 || !covered) return true;
    excluded.push({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      reason: 'duplicate_of_hard_source',
      tokenCount: estimateTokens(source.content)
    });
    return false;
  });
}

export function estimateTokens(content: string): number {
  let tokens = 0;
  for (const character of content) tokens += /[\u3400-\u9fff]/u.test(character) ? 1 : 0.25;
  return Math.max(1, Math.ceil(tokens));
}

function deduplicateExactSources(
  sources: ContextSource[],
  seenContent: Set<string>,
  excluded: ContextPackRecord['excluded'],
  reason: 'duplicate_of_hard_source' | 'duplicate_of_included_source'
): ContextSource[] {
  const unique: ContextSource[] = [];
  for (const source of sources) {
    const contentKey = createHash('sha256').update(source.content.trim()).digest('hex');
    if (seenContent.has(contentKey)) {
      excluded.push({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        reason,
        tokenCount: estimateTokens(source.content)
      });
      continue;
    }
    seenContent.add(contentKey);
    unique.push(source);
  }
  return unique;
}
