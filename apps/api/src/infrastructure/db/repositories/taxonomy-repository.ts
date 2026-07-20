import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export class TaxonomyRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public createTag(scope: BookScope, input: {
    tagId: string; namespace: string; name: string; description: string; appliesToJson: string;
    color?: string | null; icon?: string | null; createdSource: 'system' | 'chief_editor' | 'boss';
    status: 'proposed' | 'active'; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO tag_definitions (
        tag_definition_id, owner_id, book_id, namespace, name, description,
        applies_to_json, color, icon, created_source, version, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      input.tagId, scope.ownerId, scope.bookId, input.namespace, input.name, input.description,
      input.appliesToJson, input.color ?? null, input.icon ?? null, input.createdSource,
      input.status, input.now, input.now
    );
  }

  public nextEntitySchemaVersion(scope: BookScope, entityTypeKey: string): number {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) AS version FROM entity_schemas
      WHERE owner_id = ? AND book_id = ? AND entity_type_key = ?
    `).get(scope.ownerId, scope.bookId, entityTypeKey) as { version: number };
    return row.version + 1;
  }

  public createEntitySchema(scope: BookScope, input: {
    schemaId: string; entityTypeKey: string; displayName: string; version: number;
    fieldsJson: string; applicabilityJson: string; createdSource: string;
    status: 'proposed' | 'active'; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO entity_schemas (
        entity_schema_id, owner_id, book_id, entity_type_key, display_name,
        version, fields_json, applicability_json, created_source, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.schemaId, scope.ownerId, scope.bookId, input.entityTypeKey, input.displayName,
      input.version, input.fieldsJson, input.applicabilityJson, input.createdSource,
      input.status, input.now, input.now
    );
  }

  public requireTag(scope: BookScope, tagId: string): { tagId: string; status: string } {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT tag_definition_id, status FROM tag_definitions
      WHERE owner_id = ? AND book_id = ? AND tag_definition_id = ?
    `).get(scope.ownerId, scope.bookId, tagId) as { tag_definition_id: string; status: string } | undefined;
    if (row === undefined) throw new Error('标签不存在或越权');
    return { tagId: row.tag_definition_id, status: row.status };
  }

  public addAlias(scope: BookScope, input: { aliasId: string; tagId: string; alias: string; aliasType: string; now: string }): void {
    assertBookScope(scope);
    this.requireTag(scope, input.tagId);
    this.database.prepare(`
      INSERT INTO tag_aliases (
        tag_alias_id, owner_id, book_id, tag_definition_id, alias, alias_type, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(input.aliasId, scope.ownerId, scope.bookId, input.tagId, input.alias, input.aliasType, input.now);
  }

  public assign(scope: BookScope, input: {
    assignmentId: string; tagId: string; targetType: string; targetId: string;
    authorityLayer: string; sourceType: string; sourceId: string; now: string;
  }): void {
    assertBookScope(scope);
    this.requireTag(scope, input.tagId);
    this.database.prepare(`
      INSERT INTO tag_assignments (
        tag_assignment_id, owner_id, book_id, tag_definition_id, target_type,
        target_id, authority_layer, source_type, source_id, version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)
    `).run(
      input.assignmentId, scope.ownerId, scope.bookId, input.tagId, input.targetType,
      input.targetId, input.authorityLayer, input.sourceType, input.sourceId, input.now
    );
  }

  public annotate(scope: BookScope, input: {
    annotationId: string; targetType: string; targetId: string; annotationType: string;
    valueJson: string; confidence?: number | null; authorityLayer: string;
    sourceType: string; sourceId: string; status: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO semantic_annotations (
        semantic_annotation_id, owner_id, book_id, target_type, target_id,
        annotation_type, value_json, confidence, authority_layer, source_type,
        source_id, version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      input.annotationId, scope.ownerId, scope.bookId, input.targetType, input.targetId,
      input.annotationType, input.valueJson, input.confidence ?? null, input.authorityLayer,
      input.sourceType, input.sourceId, input.status, input.now
    );
  }

  public listAssignments(scope: BookScope, targetType: string, targetId: string): Array<Record<string, unknown>> {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT a.tag_assignment_id, a.authority_layer, a.source_type, a.source_id,
             d.tag_definition_id, d.namespace, d.name, d.description, d.color, d.icon
      FROM tag_assignments a JOIN tag_definitions d ON d.tag_definition_id = a.tag_definition_id
        AND d.owner_id = a.owner_id AND d.book_id = a.book_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.target_type = ? AND a.target_id = ?
        AND a.status = 'active' AND d.status = 'active'
      ORDER BY d.namespace, d.name
    `).all(scope.ownerId, scope.bookId, targetType, targetId) as unknown as Array<Record<string, unknown>>;
  }

  public createGap(scope: BookScope, input: {
    gapId: string; targetType: string; targetId?: string | null; narrativeGoal?: string | null;
    gapType: string; diagnosis: string; severity: 'blocking' | 'important' | 'optional' | 'observation';
    intentionalUnknown: boolean; sourceTaskId?: string | null; status: 'open' | 'accepted_unknown'; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO knowledge_gap_findings (
        knowledge_gap_id, owner_id, book_id, target_type, target_id, narrative_goal,
        gap_type, diagnosis, severity, intentional_unknown, source_task_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.gapId, scope.ownerId, scope.bookId, input.targetType, input.targetId ?? null,
      input.narrativeGoal ?? null, input.gapType, input.diagnosis, input.severity,
      input.intentionalUnknown ? 1 : 0, input.sourceTaskId ?? null, input.status, input.now
    );
  }

  public hasOpenGap(scope: BookScope, targetType: string, targetId: string, gapType: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(`SELECT 1 FROM knowledge_gap_findings
      WHERE owner_id = ? AND book_id = ? AND target_type = ? AND target_id = ? AND gap_type = ?
        AND status IN ('open', 'accepted_unknown') LIMIT 1`)
      .get(scope.ownerId, scope.bookId, targetType, targetId, gapType) !== undefined;
  }

  public resolveGaps(scope: BookScope, targetType: string, targetId: string, now: string): number {
    assertBookScope(scope);
    return Number(this.database.prepare(`UPDATE knowledge_gap_findings SET status = 'resolved', resolved_at = ?
      WHERE owner_id = ? AND book_id = ? AND target_type = ? AND target_id = ?
        AND status IN ('open', 'accepted_unknown')`)
      .run(now, scope.ownerId, scope.bookId, targetType, targetId).changes);
  }

  public listOpenGaps(scope: BookScope): Array<Record<string, unknown>> {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT knowledge_gap_id, target_type, target_id, narrative_goal, gap_type,
             diagnosis, severity, intentional_unknown, status, created_at
      FROM knowledge_gap_findings WHERE owner_id = ? AND book_id = ?
        AND status IN ('open', 'accepted_unknown')
      ORDER BY CASE severity WHEN 'blocking' THEN 0 WHEN 'important' THEN 1 WHEN 'optional' THEN 2 ELSE 3 END, created_at
    `).all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, unknown>>;
  }
}
