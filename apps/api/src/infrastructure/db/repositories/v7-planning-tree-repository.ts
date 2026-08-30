import type { DatabaseSync } from 'node:sqlite';
import type {
  PlanningNodeActual,
  PlanningTreeDocument,
  PlanningTreeKind,
  PlanningTreeSourceRef
} from '@wenmi/v7-backend';

export interface V7PlanningTreeHeadRow {
  owner_id: string;
  book_id: string;
  tree_kind: PlanningTreeKind;
  scope_id: string;
  revision: number;
  candidate_version_id: string | null;
  confirmed_version_id: string | null;
  updated_at: string;
}

export interface V7PlanningTreeVersionRow {
  tree_version_id: string;
  owner_id: string;
  book_id: string;
  tree_kind: PlanningTreeKind;
  scope_id: string;
  revision: number;
  lifecycle: 'candidate' | 'confirmed' | 'superseded';
  parent_version_id: string | null;
  content_json: string;
  content_hash: string;
  source_refs_json: string;
  created_by: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface V7PlanningTreeActionRow {
  action_id: string;
  request_hash: string;
  result_json: string;
}

interface V7PlanningActualRow {
  node_key: string;
  state: PlanningNodeActual['state'];
  summary: string;
  emotion_result: string;
  experience_result: string;
  outcome: string;
  source_kind: PlanningNodeActual['sourceKind'];
  source_version_id: string;
  evidence_refs_json: string;
  recorded_at: string;
}

export class V7PlanningTreeRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public action(ownerId: string, bookId: string, idempotencyKey: string): V7PlanningTreeActionRow | undefined {
    return this.database.prepare(`SELECT action_id,request_hash,result_json FROM v7_planning_tree_actions
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`)
      .get(ownerId, bookId, idempotencyKey) as V7PlanningTreeActionRow | undefined;
  }

  public head(ownerId: string, bookId: string, treeKind: PlanningTreeKind, scopeId: string): V7PlanningTreeHeadRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_tree_heads
      WHERE owner_id=? AND book_id=? AND tree_kind=? AND scope_id=?`)
      .get(ownerId, bookId, treeKind, scopeId) as V7PlanningTreeHeadRow | undefined;
  }

  public version(ownerId: string, bookId: string, versionId: string): V7PlanningTreeVersionRow | undefined {
    return this.database.prepare(`SELECT * FROM v7_planning_tree_versions
      WHERE owner_id=? AND book_id=? AND tree_version_id=?`)
      .get(ownerId, bookId, versionId) as V7PlanningTreeVersionRow | undefined;
  }

  public history(ownerId: string, bookId: string, treeKind: PlanningTreeKind, scopeId: string): V7PlanningTreeVersionRow[] {
    return this.database.prepare(`SELECT * FROM v7_planning_tree_versions
      WHERE owner_id=? AND book_id=? AND tree_kind=? AND scope_id=?
      ORDER BY revision DESC`)
      .all(ownerId, bookId, treeKind, scopeId) as unknown as V7PlanningTreeVersionRow[];
  }

  public latestActuals(ownerId: string, bookId: string, treeKind: PlanningTreeKind, scopeId: string): PlanningNodeActual[] {
    const rows = this.database.prepare(`SELECT a.* FROM v7_planning_node_actuals a
      WHERE a.owner_id=? AND a.book_id=? AND a.tree_kind=? AND a.scope_id=?
        AND a.revision=(SELECT MAX(b.revision) FROM v7_planning_node_actuals b
          WHERE b.owner_id=a.owner_id AND b.book_id=a.book_id AND b.tree_kind=a.tree_kind
            AND b.scope_id=a.scope_id AND b.node_key=a.node_key)
      ORDER BY a.node_key`).all(ownerId, bookId, treeKind, scopeId) as unknown as V7PlanningActualRow[];
    return rows.map((row) => ({
      nodeKey: row.node_key,
      state: row.state,
      summary: row.summary,
      emotionResult: row.emotion_result,
      experienceResult: row.experience_result,
      outcome: row.outcome,
      sourceKind: row.source_kind,
      sourceVersionId: row.source_version_id,
      evidenceRefs: JSON.parse(row.evidence_refs_json) as string[],
      recordedAt: row.recorded_at
    }));
  }

  public actualBySource(input: {
    ownerId: string;
    bookId: string;
    treeKind: PlanningTreeKind;
    scopeId: string;
    nodeKey: string;
    sourceKind: PlanningNodeActual['sourceKind'];
    sourceVersionId: string;
  }): PlanningNodeActual | undefined {
    const row = this.database.prepare(`SELECT * FROM v7_planning_node_actuals
      WHERE owner_id=? AND book_id=? AND tree_kind=? AND scope_id=? AND node_key=? AND source_kind=? AND source_version_id=?`)
      .get(input.ownerId, input.bookId, input.treeKind, input.scopeId, input.nodeKey, input.sourceKind, input.sourceVersionId) as V7PlanningActualRow | undefined;
    if (row === undefined) return undefined;
    return {
      nodeKey: row.node_key, state: row.state, summary: row.summary,
      emotionResult: row.emotion_result, experienceResult: row.experience_result, outcome: row.outcome,
      sourceKind: row.source_kind, sourceVersionId: row.source_version_id,
      evidenceRefs: JSON.parse(row.evidence_refs_json) as string[], recordedAt: row.recorded_at
    };
  }

  public saveCandidate(input: {
    actionId: string;
    versionId: string;
    ownerId: string;
    bookId: string;
    treeKind: PlanningTreeKind;
    scopeId: string;
    expectedRevision: number;
    document: PlanningTreeDocument;
    contentHash: string;
    sourceRefs: readonly PlanningTreeSourceRef[];
    createdBy: string;
    actionKind: 'create_candidate' | 'revise_candidate';
    idempotencyKey: string;
    requestHash: string;
    now: string;
  }): { revision: number; versionId: string } | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const head = this.head(input.ownerId, input.bookId, input.treeKind, input.scopeId);
      if ((head?.revision ?? 0) !== input.expectedRevision) {
        this.database.exec('ROLLBACK');
        return null;
      }
      const nextRevision = input.expectedRevision + 1;
      if (head?.candidate_version_id !== null && head?.candidate_version_id !== undefined) {
        this.database.prepare(`UPDATE v7_planning_tree_versions SET lifecycle='superseded'
          WHERE owner_id=? AND book_id=? AND tree_version_id=? AND lifecycle='candidate'`)
          .run(input.ownerId, input.bookId, head.candidate_version_id);
      }
      const parentVersionId = head?.candidate_version_id ?? head?.confirmed_version_id ?? null;
      this.database.prepare(`INSERT INTO v7_planning_tree_versions
        (tree_version_id,owner_id,book_id,tree_kind,scope_id,revision,lifecycle,parent_version_id,schema_version,
         content_json,content_hash,source_refs_json,created_by,created_at)
        VALUES (?,?,?,?,?,?,'candidate',?,'v7-planning-tree-v1',?,?,?,?,?)`).run(
        input.versionId, input.ownerId, input.bookId, input.treeKind, input.scopeId, nextRevision, parentVersionId,
        JSON.stringify(input.document), input.contentHash, JSON.stringify(input.sourceRefs), input.createdBy, input.now
      );
      if (head === undefined) {
        this.database.prepare(`INSERT INTO v7_planning_tree_heads
          (owner_id,book_id,tree_kind,scope_id,revision,candidate_version_id,confirmed_version_id,updated_at)
          VALUES (?,?,?,?,?,?,NULL,?)`).run(
          input.ownerId, input.bookId, input.treeKind, input.scopeId, nextRevision, input.versionId, input.now
        );
      } else {
        const updated = this.database.prepare(`UPDATE v7_planning_tree_heads SET revision=?,candidate_version_id=?,updated_at=?
          WHERE owner_id=? AND book_id=? AND tree_kind=? AND scope_id=? AND revision=?`).run(
          nextRevision, input.versionId, input.now, input.ownerId, input.bookId, input.treeKind, input.scopeId, input.expectedRevision
        );
        if (updated.changes !== 1) {
          this.database.exec('ROLLBACK');
          return null;
        }
      }
      this.saveAction({
        actionId: input.actionId, ownerId: input.ownerId, bookId: input.bookId, treeKind: input.treeKind,
        scopeId: input.scopeId, actionKind: input.actionKind, idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash, result: { revision: nextRevision, versionId: input.versionId }, now: input.now
      });
      this.database.exec('COMMIT');
      return { revision: nextRevision, versionId: input.versionId };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public confirmCandidate(input: {
    actionId: string;
    ownerId: string;
    bookId: string;
    treeKind: PlanningTreeKind;
    scopeId: string;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    now: string;
  }): { revision: number; versionId: string } | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const head = this.head(input.ownerId, input.bookId, input.treeKind, input.scopeId);
      if (head === undefined || head.revision !== input.expectedRevision || head.candidate_version_id === null) {
        this.database.exec('ROLLBACK');
        return null;
      }
      if (head.confirmed_version_id !== null) {
        this.database.prepare(`UPDATE v7_planning_tree_versions SET lifecycle='superseded'
          WHERE owner_id=? AND book_id=? AND tree_version_id=? AND lifecycle='confirmed'`)
          .run(input.ownerId, input.bookId, head.confirmed_version_id);
      }
      this.database.prepare(`UPDATE v7_planning_tree_versions SET lifecycle='confirmed',confirmed_at=?
        WHERE owner_id=? AND book_id=? AND tree_version_id=? AND lifecycle='candidate'`)
        .run(input.now, input.ownerId, input.bookId, head.candidate_version_id);
      const nextRevision = input.expectedRevision + 1;
      const updated = this.database.prepare(`UPDATE v7_planning_tree_heads
        SET revision=?,candidate_version_id=NULL,confirmed_version_id=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND tree_kind=? AND scope_id=? AND revision=?`).run(
        nextRevision, head.candidate_version_id, input.now, input.ownerId, input.bookId,
        input.treeKind, input.scopeId, input.expectedRevision
      );
      if (updated.changes !== 1) {
        this.database.exec('ROLLBACK');
        return null;
      }
      this.saveAction({
        actionId: input.actionId, ownerId: input.ownerId, bookId: input.bookId, treeKind: input.treeKind,
        scopeId: input.scopeId, actionKind: 'confirm_candidate', idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash, result: { revision: nextRevision, versionId: head.candidate_version_id }, now: input.now
      });
      this.database.exec('COMMIT');
      return { revision: nextRevision, versionId: head.candidate_version_id };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public saveActual(input: {
    actionId: string;
    actualId: string;
    ownerId: string;
    bookId: string;
    treeKind: PlanningTreeKind;
    scopeId: string;
    actual: PlanningNodeActual;
    idempotencyKey: string;
    requestHash: string;
  }): PlanningNodeActual {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const revision = Number((this.database.prepare(`SELECT COALESCE(MAX(revision),0)+1 AS revision
        FROM v7_planning_node_actuals WHERE owner_id=? AND book_id=? AND tree_kind=? AND scope_id=? AND node_key=?`)
        .get(input.ownerId, input.bookId, input.treeKind, input.scopeId, input.actual.nodeKey) as { revision: number }).revision);
      this.database.prepare(`INSERT INTO v7_planning_node_actuals
        (actual_id,owner_id,book_id,tree_kind,scope_id,node_key,revision,state,summary,emotion_result,
         experience_result,outcome,source_kind,source_version_id,evidence_refs_json,recorded_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.actualId, input.ownerId, input.bookId, input.treeKind, input.scopeId, input.actual.nodeKey,
        revision, input.actual.state, input.actual.summary, input.actual.emotionResult, input.actual.experienceResult,
        input.actual.outcome, input.actual.sourceKind, input.actual.sourceVersionId,
        JSON.stringify(input.actual.evidenceRefs), input.actual.recordedAt
      );
      this.saveAction({
        actionId: input.actionId, ownerId: input.ownerId, bookId: input.bookId, treeKind: input.treeKind,
        scopeId: input.scopeId, actionKind: 'record_actual', idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash, result: input.actual, now: input.actual.recordedAt
      });
      this.database.exec('COMMIT');
      return input.actual;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private saveAction(input: {
    actionId: string;
    ownerId: string;
    bookId: string;
    treeKind: PlanningTreeKind;
    scopeId: string;
    actionKind: 'create_candidate' | 'revise_candidate' | 'confirm_candidate' | 'record_actual';
    idempotencyKey: string;
    requestHash: string;
    result: unknown;
    now: string;
  }): void {
    this.database.prepare(`INSERT INTO v7_planning_tree_actions
      (action_id,owner_id,book_id,tree_kind,scope_id,action_kind,idempotency_key,request_hash,result_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      input.actionId, input.ownerId, input.bookId, input.treeKind, input.scopeId, input.actionKind,
      input.idempotencyKey, input.requestHash, JSON.stringify(input.result), input.now
    );
  }
}
