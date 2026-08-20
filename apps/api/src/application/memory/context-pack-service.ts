import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { runWithSqliteBusyRetry } from '../../infrastructure/db/sqlite-busy-retry.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { stableJson } from '../knowledge/canon-service.js';

export type ContextConstraintStrength = 'hard_fact' | 'current_task' | 'soft_reference' | 'open_space';
export type ContextTruthStatus = 'planned' | 'confirmed' | 'actual';

export interface ContextSource {
  sourceType: string;
  sourceId: string;
  content: string;
  reason: string;
  priority: number;
  version?: number | string;
  constraintStrength?: ContextConstraintStrength;
  truthStatus?: ContextTruthStatus;
  scopeType?: 'book' | 'volume' | 'event' | 'chapter' | 'task';
  scopeId?: string;
  dependencies?: string[];
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
    const characterBudget = input.characterBudget ?? Number.MAX_SAFE_INTEGER;
    const policyVersion = input.policyVersion?.trim() || 'context-pack-v2';
    const excluded: ContextPackRecord['excluded'] = [];
    const seenContent = new Set<string>();
    const hardSources = deduplicateCoveredHardSources(
      deduplicateExactSources(input.hardSources, seenContent, excluded, 'duplicate_of_hard_source'),
      excluded
    );
    const hard = hardSources.map((source) => ({
      ...source,
      tokenCount: estimateTokens(source.content),
      characterCount: source.content.length,
      hard: true as const,
      constraintStrength: source.constraintStrength ?? inferConstraintStrength(source.sourceType, true),
      truthStatus: source.truthStatus ?? inferTruthStatus(source.sourceType),
      scopeType: source.scopeType ?? inferScopeType(source.sourceType),
      scopeId: source.scopeId ?? source.sourceId,
      dependencies: source.dependencies ?? [],
    }));
    const hardTokens = hard.reduce((sum, source) => sum + source.tokenCount, 0);
    const hardCharacters = hard.reduce((sum, source) => sum + source.characterCount, 0);
    if (hardTokens > input.tokenBudget) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        'Token预算不足以容纳不可截断的硬来源',
        { tokenBudget: input.tokenBudget, requiredHardTokens: hardTokens, hardSourceIds: hard.map((source) => source.sourceId) },
        false, 409
      );
    }
    if (hardCharacters > characterBudget) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '字符预算不足以容纳不可截断的硬来源',
        {
          characterBudget,
          requiredHardCharacters: hardCharacters,
          hardSourceIds: hard.map((source) => source.sourceId)
        },
        false,
        409
      );
    }
    const included: Array<ContextSource & { tokenCount: number; hard: boolean }> = [...hard];
    let totalTokens = hardTokens;
    let totalCharacters = hardCharacters;
    const optionalSources = deduplicateExactSources(
      input.optionalSources,
      seenContent,
      excluded,
      'duplicate_of_included_source'
    );
    const optional = optionalSources
      .map((source) => ({
        ...source,
        tokenCount: estimateTokens(source.content),
        characterCount: source.content.length,
        hard: false as const,
        constraintStrength: source.constraintStrength ?? inferConstraintStrength(source.sourceType, false),
        truthStatus: source.truthStatus ?? inferTruthStatus(source.sourceType),
        scopeType: source.scopeType ?? inferScopeType(source.sourceType),
        scopeId: source.scopeId ?? source.sourceId,
        dependencies: source.dependencies ?? [],
      }))
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
        totalTokens + source.tokenCount <= input.tokenBudget
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
      tokenBudget: input.tokenBudget,
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
      input.tokenBudget, totalTokens, stableJson(manifest), stableJson(excluded),
      contentHash, policyVersion, sourceFingerprint, this.clock.now().toISOString()
    ));
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
