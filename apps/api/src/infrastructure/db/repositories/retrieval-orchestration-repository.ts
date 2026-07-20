import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { EvidenceClosure, EvidenceCluster, RetrievalCandidate, RetrievalChannel, RetrievalPlan } from '../../../contracts/retrieval-plan.js';
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

  public projectionState(scope: BookScope): {
    fts: { snapshotId: string; canonRevision: number } | null;
    vector: { snapshotId: string; canonRevision: number; tableName: string; dimension: number; embeddingSnapshotId: string;
      modelId: string; modelVersion: string; assetHash: string } | null;
  } {
    assertBookScope(scope);
    const fts = this.database.prepare(`
      SELECT active_snapshot_id, canon_revision FROM projection_watermarks
      WHERE owner_id = ? AND book_id = ? AND projection_type = 'fts' AND status = 'ready' AND active_snapshot_id IS NOT NULL
    `).get(scope.ownerId, scope.bookId) as { active_snapshot_id: string; canon_revision: number } | undefined;
    const vector = this.database.prepare(`
      SELECT w.active_snapshot_id, w.canon_revision, m.table_name, m.dimension, m.embedding_model_snapshot_id,
             e.model_id, e.model_version, e.asset_hash
      FROM projection_watermarks w
      JOIN vector_index_manifests m ON m.owner_id = w.owner_id AND m.book_id = w.book_id
        AND m.chunk_snapshot_id = w.active_snapshot_id AND m.canon_revision = w.canon_revision AND m.status = 'ready'
      JOIN embedding_model_snapshots e ON e.embedding_model_snapshot_id = m.embedding_model_snapshot_id AND e.status = 'available'
      WHERE w.owner_id = ? AND w.book_id = ? AND w.projection_type = 'vector'
        AND w.status = 'ready' AND w.active_snapshot_id IS NOT NULL
      ORDER BY m.ready_at DESC, m.vector_index_manifest_id DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as {
      active_snapshot_id: string; canon_revision: number; table_name: string; dimension: number; embedding_model_snapshot_id: string;
      model_id: string; model_version: string; asset_hash: string;
    } | undefined;
    return {
      fts: fts === undefined ? null : { snapshotId: fts.active_snapshot_id, canonRevision: fts.canon_revision },
      vector: vector === undefined ? null : { snapshotId: vector.active_snapshot_id, canonRevision: vector.canon_revision,
        tableName: vector.table_name, dimension: vector.dimension, embeddingSnapshotId: vector.embedding_model_snapshot_id,
        modelId: vector.model_id, modelVersion: vector.model_version, assetHash: vector.asset_hash }
    };
  }

  public saveExecution(scope: BookScope, input: {
    planId: string;
    runs: Array<{ runId: string; channel: RetrievalChannel; snapshotId: string | null; canonRevision: number | null;
      candidateCount: number; adoptedCount: number; durationMs: number; status: 'ready' | 'degraded' | 'skipped' | 'failed'; reason: string | null }>;
    candidates: Array<{ candidate: RetrievalCandidate; status: 'candidate' | 'adopted' | 'excluded'; exclusionReason: string | null }>;
    clusters: EvidenceCluster[];
    closures: Array<{ closureId: string; closure: EvidenceClosure }>;
    legacyRecord: { retrievalId: string; taskId: string | null; queryText: string; filtersJson: string; resultsJson: string;
      adoptedSourceIdsJson: string; canonRevision: number };
    now: string;
  }): void {
    assertBookScope(scope);
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      const insertRun = this.database.prepare(`
        INSERT INTO retrieval_channel_runs (
          retrieval_channel_run_id, owner_id, book_id, retrieval_query_plan_id, channel,
          projection_snapshot_id, projection_canon_revision, candidate_count, adopted_count,
          duration_ms, status, reason_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const run of input.runs) insertRun.run(run.runId, scope.ownerId, scope.bookId, input.planId, run.channel,
        run.snapshotId, run.canonRevision, run.candidateCount, run.adoptedCount, run.durationMs, run.status, run.reason, input.now);
      const insertCandidate = this.database.prepare(`
        INSERT INTO retrieval_candidates (
          retrieval_candidate_id, owner_id, book_id, retrieval_query_plan_id, channel, channel_rank,
          lane, source_type, source_id, source_version, source_hash, source_locator_json,
          provenance_key, assertion_key, content, authority_grade, epistemic_status, conflict_group,
          metadata_json, status, exclusion_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of input.candidates) {
        const candidate = item.candidate;
        insertCandidate.run(candidate.candidateId, scope.ownerId, scope.bookId, input.planId, candidate.channel,
          candidate.channelRank, candidate.lane, candidate.sourceType, candidate.sourceId, candidate.sourceVersion,
          candidate.sourceHash, JSON.stringify(candidate.sourceLocator), candidate.provenanceKey, candidate.assertionKey,
          candidate.content, candidate.authorityGrade, candidate.epistemicStatus, candidate.conflictGroup,
          JSON.stringify({ ...candidate.metadata, lifecycleLayer: candidate.lifecycleLayer, negated: candidate.negated }),
          item.status, item.exclusionReason, input.now);
      }
      const insertCluster = this.database.prepare(`
        INSERT INTO retrieval_evidence_clusters (
          retrieval_evidence_cluster_id, owner_id, book_id, retrieval_query_plan_id, lane,
          cluster_key, primary_candidate_id, candidate_ids_json, channel_ranks_json, rrf_score,
          conflict_group, adopted, adoption_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cluster of input.clusters) insertCluster.run(cluster.clusterId, scope.ownerId, scope.bookId, input.planId,
        cluster.lane, cluster.clusterKey, cluster.primary.candidateId, JSON.stringify(cluster.candidates.map((candidate) => candidate.candidateId)),
        JSON.stringify(cluster.channelRanks), cluster.rrfScore, cluster.conflictGroup, cluster.adopted ? 1 : 0, cluster.adoptionReason, input.now);
      const insertClosure = this.database.prepare(`
        INSERT INTO retrieval_evidence_checks (
          retrieval_evidence_check_id, owner_id, book_id, retrieval_query_plan_id,
          retrieval_evidence_cluster_id, source_resolved, hash_verified, canon_verified,
          time_verified, viewpoint_verified, negation_checked, epistemic_checked,
          result, details_json, checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of input.closures) {
        const closure = item.closure;
        insertClosure.run(item.closureId, scope.ownerId, scope.bookId, input.planId, closure.clusterId,
          closure.sourceResolved ? 1 : 0, closure.hashVerified ? 1 : 0, closure.canonVerified ? 1 : 0,
          closure.timeVerified ? 1 : 0, closure.viewpointVerified ? 1 : 0, closure.negationChecked ? 1 : 0,
          closure.epistemicChecked ? 1 : 0, closure.result, JSON.stringify({ reasons: closure.reasons }), input.now);
      }
      this.database.prepare(`
        INSERT INTO retrieval_records (
          retrieval_id, owner_id, book_id, task_id, query_text, filters_json,
          results_json, adopted_source_ids_json, canon_revision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.legacyRecord.retrievalId, scope.ownerId, scope.bookId, input.legacyRecord.taskId,
        input.legacyRecord.queryText, input.legacyRecord.filtersJson, input.legacyRecord.resultsJson,
        input.legacyRecord.adoptedSourceIdsJson, input.legacyRecord.canonRevision, input.now);
      const updated = this.database.prepare(`
        UPDATE retrieval_query_plans SET status = 'completed'
        WHERE retrieval_query_plan_id = ? AND owner_id = ? AND book_id = ? AND status = 'planned'
      `).run(input.planId, scope.ownerId, scope.bookId);
      if (updated.changes !== 1) throw new Error('检索计划状态已经变化');
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public failPlan(scope: BookScope, planId: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE retrieval_query_plans SET status = 'failed'
      WHERE retrieval_query_plan_id = ? AND owner_id = ? AND book_id = ? AND status IN ('planned','running')
    `).run(planId, scope.ownerId, scope.bookId);
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
          WHERE r.owner_id = ? AND r.book_id = ? AND r.canon_revision = ? AND r.from_entity_id = ?
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
