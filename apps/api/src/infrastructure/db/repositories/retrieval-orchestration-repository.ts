import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RetrievalPlan } from '../../../contracts/retrieval-plan.js';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export class RetrievalOrchestrationRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findEntityMatches(scope: BookScope, query: string): Array<{ entityId: string; entityType: string; canonicalName: string; aliases: string[]; matchedText: string }> {
    assertBookScope(scope);
    const rows = this.database.prepare(`
      SELECT entity_id, entity_type, canonical_name, aliases_json FROM entities
      WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY canonical_name, entity_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ entity_id: string; entity_type: string; canonical_name: string; aliases_json: string }>;
    const matches: Array<{ entityId: string; entityType: string; canonicalName: string; aliases: string[]; matchedText: string }> = [];
    for (const row of rows) {
      const aliases = JSON.parse(row.aliases_json) as string[];
      const matchedText = [row.canonical_name, ...aliases].sort((left, right) => right.length - left.length).find((name) => name.length > 0 && query.includes(name));
      if (matchedText !== undefined) matches.push({ entityId: row.entity_id, entityType: row.entity_type, canonicalName: row.canonical_name, aliases, matchedText });
    }
    return matches;
  }

  public savePlan(scope: BookScope, plan: RetrievalPlan, taskId: string | null, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO retrieval_query_plans (
        retrieval_query_plan_id, owner_id, book_id, task_id, role_key, mode, original_query,
        normalized_query, query_hash, intent_json, entity_seeds_json, ambiguity_json, channel_plan_json,
        canon_revision, world_time, knowledge_time, viewpoint_entity_id, policy_version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(plan.planId, scope.ownerId, scope.bookId, taskId, plan.roleKey, plan.mode, plan.originalQuery,
      plan.normalizedQuery, createHash('sha256').update(plan.originalQuery).digest('hex'), JSON.stringify(plan.intents),
      JSON.stringify(plan.entitySeeds), JSON.stringify(plan.ambiguities), JSON.stringify(plan.channels),
      plan.canonRevision, plan.worldTime, plan.knowledgeTime, plan.viewpointEntityId, plan.policyVersion,
      plan.blocked ? 'blocked' : 'planned', now);
  }

  public expandRelations(scope: BookScope, seedEntityIds: string[], canonRevision: number, limits = { depth: 2, fanout: 12, nodes: 64 }): Array<{
    relationshipId: string; fromEntityId: string; relationKey: string; toValue: unknown; sourceFactId: string; depth: number; sourceHash: string | null;
  }> {
    assertBookScope(scope);
    if (seedEntityIds.length > 8) throw new Error('关系种子超过8个');
    const visited = new Set(seedEntityIds);
    let frontier = [...seedEntityIds];
    const output: Array<{ relationshipId: string; fromEntityId: string; relationKey: string; toValue: unknown; sourceFactId: string; depth: number; sourceHash: string | null }> = [];
    for (let depth = 1; depth <= limits.depth && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const entityId of frontier) {
        const rows = this.database.prepare(`
          SELECT r.relationship_id, r.from_entity_id, r.relation_key, r.to_value_json, r.source_fact_id,
                 m.content_hash
          FROM relationship_projection r
          JOIN fact_assertions f ON f.fact_id = r.source_fact_id AND f.owner_id = r.owner_id AND f.book_id = r.book_id
          LEFT JOIN manuscript_versions m ON m.manuscript_version_id = f.source_manuscript_version_id
            AND m.owner_id = f.owner_id AND m.book_id = f.book_id
          WHERE r.owner_id = ? AND r.book_id = ? AND r.canon_revision <= ? AND r.from_entity_id = ?
          ORDER BY r.relationship_id LIMIT ?
        `).all(scope.ownerId, scope.bookId, canonRevision, entityId, limits.fanout) as unknown as Array<{
          relationship_id: string; from_entity_id: string; relation_key: string; to_value_json: string; source_fact_id: string; content_hash: string | null;
        }>;
        for (const row of rows) {
          const toValue = JSON.parse(row.to_value_json) as unknown;
          output.push({ relationshipId: row.relationship_id, fromEntityId: row.from_entity_id, relationKey: row.relation_key,
            toValue, sourceFactId: row.source_fact_id, depth, sourceHash: row.content_hash });
          if (typeof toValue === 'string' && !visited.has(toValue) && visited.size < limits.nodes) { visited.add(toValue); next.push(toValue); }
          if (visited.size >= limits.nodes) break;
        }
        if (visited.size >= limits.nodes) break;
      }
      frontier = next;
    }
    return output;
  }
}
