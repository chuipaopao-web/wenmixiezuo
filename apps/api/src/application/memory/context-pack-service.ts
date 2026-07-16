import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { stableJson } from '../knowledge/canon-service.js';

export interface ContextSource {
  sourceType: string;
  sourceId: string;
  content: string;
  reason: string;
  priority: number;
  version?: number | string;
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
  hardSources: ContextSource[];
  optionalSources: ContextSource[];
}

export interface ContextPackRecord {
  contextPackId: string;
  totalTokens: number;
  contentHash: string;
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
    const hard = input.hardSources.map((source) => ({ ...source, tokenCount: estimateTokens(source.content), hard: true as const }));
    const hardTokens = hard.reduce((sum, source) => sum + source.tokenCount, 0);
    if (hardTokens > input.tokenBudget) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        'Token预算不足以容纳不可截断的硬来源',
        { tokenBudget: input.tokenBudget, requiredHardTokens: hardTokens, hardSourceIds: hard.map((source) => source.sourceId) },
        false, 409
      );
    }
    const included: Array<ContextSource & { tokenCount: number; hard: boolean }> = [...hard];
    const excluded: ContextPackRecord['excluded'] = [];
    let totalTokens = hardTokens;
    const optional = [...input.optionalSources]
      .map((source) => ({ ...source, tokenCount: estimateTokens(source.content), hard: false as const }))
      .sort((left, right) => right.priority - left.priority || left.sourceId.localeCompare(right.sourceId));
    for (const source of optional) {
      if (totalTokens + source.tokenCount <= input.tokenBudget) {
        included.push(source);
        totalTokens += source.tokenCount;
      } else {
        excluded.push({ sourceType: source.sourceType, sourceId: source.sourceId, reason: 'token_budget_lower_priority', tokenCount: source.tokenCount });
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
      content: source.content
    }));
    const immutableContent = stableJson({
      taskId: input.taskId,
      agentId: input.agentId,
      chapterId: input.chapterId ?? null,
      canonRevision: input.canonRevision,
      positioningVersion: input.positioningVersion,
      manifest,
      excluded
    });
    const contentHash = createHash('sha256').update(immutableContent).digest('hex');
    const contextPackId = this.ids.next();
    this.database.prepare(`
      INSERT INTO context_packs (
        context_pack_id, owner_id, book_id, task_id, agent_id, chapter_id,
        canon_revision, positioning_version, outline_version_id,
        writing_contract_version_id, token_budget, total_tokens,
        source_manifest_json, excluded_sources_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      contextPackId, scope.ownerId, scope.bookId, input.taskId, input.agentId,
      input.chapterId ?? null, input.canonRevision, input.positioningVersion,
      input.outlineVersionId ?? null, input.writingContractVersionId ?? null,
      input.tokenBudget, totalTokens, stableJson(manifest), stableJson(excluded),
      contentHash, this.clock.now().toISOString()
    );
    return { contextPackId, totalTokens, contentHash, sources: included, excluded };
  }
}

export function estimateTokens(content: string): number {
  let tokens = 0;
  for (const character of content) tokens += /[\u3400-\u9fff]/u.test(character) ? 1 : 0.25;
  return Math.max(1, Math.ceil(tokens));
}
