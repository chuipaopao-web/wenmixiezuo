import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';
import { assertBookScope } from '../../../domain/scope.js';

export interface TeamAgentRow {
  agentId: string; roleKey: string; roleTemplateId: string; memberName: string; shortTitle: string;
  provider: string; modelId: string; modelSnapshotId: string; activationState: string; plan?: string;
}

export class AgentGovernanceRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public seedRole(input: { roleTemplateId: string; roleKey: string; shortTitle: string; category: string; responsibilities: string[]; capabilities: string[]; activation: string; now: string }): void {
    this.database.prepare(`INSERT INTO role_templates (
      role_template_id, version, role_key, display_name, category, responsibilities_json,
      required_capabilities_json, default_activation, created_at
    ) VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(role_template_id, version) DO NOTHING`).run(
      input.roleTemplateId, input.roleKey, input.shortTitle, input.category, JSON.stringify(input.responsibilities),
      JSON.stringify(input.capabilities), input.activation, input.now
    );
  }

  public insertModelSnapshot(scope: BookScope, input: { id: string; provider: string; modelId: string; plan: string; capabilities: string[]; now: string }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO model_config_snapshots (
      model_snapshot_id, owner_id, book_id, provider, model_id, parameters_json, capabilities_json, validated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.id, scope.ownerId, scope.bookId, input.provider, input.modelId,
      JSON.stringify({ plan: input.plan, strictSubscriptionOnly: input.plan !== 'deterministic', cashFallbackAllowed: false, cashCostCny: 0 }),
      JSON.stringify(input.capabilities), input.now, input.now
    );
  }

  public insertAgent(scope: BookScope, input: { id: string; roleTemplateId: string; name: string; modelSnapshotId: string; activationState: string; now: string }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO agent_instances (
      agent_id, owner_id, book_id, role_template_id, role_template_version, display_name,
      model_snapshot_id, permissions_json, enabled, activation_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 2, ?, ?, ?, 1, ?, ?, ?)`).run(
      input.id, scope.ownerId, scope.bookId, input.roleTemplateId, input.name, input.modelSnapshotId,
      JSON.stringify({ bookScoped: true, tools: [], network: false, chainOfThought: false }), input.activationState, input.now, input.now
    );
  }

  public insertTeamSnapshot(scope: BookScope, input: { id: string; contractsJson: string; hash: string; now: string }): void {
    this.database.prepare(`INSERT INTO team_template_snapshots (
      team_template_snapshot_id, owner_id, book_id, version, member_contracts_json, content_hash, status, created_at
    ) VALUES (?, ?, ?, 1, ?, ?, 'active', ?)`).run(input.id, scope.ownerId, scope.bookId, input.contractsJson, input.hash, input.now);
  }

  public insertBindingRevision(scope: BookScope, input: { id: string; version: number; effectiveFrom: string; reason: string; now: string }): void {
    this.database.prepare(`UPDATE agent_model_binding_revisions SET status = 'superseded' WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .run(scope.ownerId, scope.bookId);
    this.database.prepare(`INSERT INTO agent_model_binding_revisions (
      agent_model_binding_revision_id, owner_id, book_id, version, effective_from, reason, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`).run(input.id, scope.ownerId, scope.bookId, input.version, input.effectiveFrom, input.reason, input.now);
  }

  public insertBinding(scope: BookScope, input: { id: string; revisionId: string; roleKey: string; agentId: string; snapshotId: string; provider: string; modelId: string; plan: string; purposes: string[]; now: string }): void {
    this.database.prepare(`INSERT INTO agent_model_bindings (
      agent_model_binding_id, owner_id, book_id, agent_model_binding_revision_id, role_key,
      agent_id, model_snapshot_id, provider, model_id, plan_type, purpose_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(
      input.id, scope.ownerId, scope.bookId, input.revisionId, input.roleKey, input.agentId, input.snapshotId,
      input.provider, input.modelId, input.plan, JSON.stringify(input.purposes), input.now
    );
  }

  public updateAgentModelSnapshot(scope: BookScope, agentId: string, snapshotId: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`UPDATE agent_instances SET model_snapshot_id = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND enabled = 1`)
      .run(snapshotId, now, scope.ownerId, scope.bookId, agentId);
    if (result.changes !== 1) throw new Error('模型绑定对应的创作成员不存在、已停用或不属于当前书籍');
  }

  public activeWriterSelectionCount(scope: BookScope): number {
    assertBookScope(scope);
    return (this.database.prepare(`SELECT COUNT(*) AS count FROM writer_selections
      WHERE owner_id = ? AND book_id = ? AND status = 'selected'`)
      .get(scope.ownerId, scope.bookId) as { count: number }).count;
  }

  public supersedeWriterSelections(scope: BookScope, selectedModelSnapshotId: string): number {
    assertBookScope(scope);
    return Number(this.database.prepare(`UPDATE writer_selections SET status = 'superseded'
      WHERE owner_id = ? AND book_id = ? AND status = 'selected' AND selected_model_snapshot_id <> ?`)
      .run(scope.ownerId, scope.bookId, selectedModelSnapshotId).changes);
  }

  public listTeam(scope: BookScope): TeamAgentRow[] {
    assertBookScope(scope);
    const rows = this.database.prepare(`SELECT a.agent_id, a.role_template_id, r.role_key, r.display_name AS short_title,
      a.display_name, a.activation_state, m.provider, m.model_id, m.model_snapshot_id,
      json_extract(m.parameters_json, '$.plan') AS plan_type
      FROM agent_instances a JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.role_template_version = 2 AND a.enabled = 1
      ORDER BY a.created_at, a.agent_id`)
      .all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, string>>;
    return rows.map((row) => ({
      agentId: row.agent_id!, roleKey: row.role_key!, roleTemplateId: row.role_template_id!, memberName: row.display_name!,
      shortTitle: row.short_title!, provider: row.provider!, modelId: row.model_id!, modelSnapshotId: row.model_snapshot_id!,
      activationState: row.activation_state!, plan: row.plan_type ?? 'deterministic'
    }));
  }

  public nextBindingVersion(scope: BookScope): number {
    const row = this.database.prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM agent_model_binding_revisions WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { version: number };
    return row.version + 1;
  }

  public activeBindings(scope: BookScope): TeamAgentRow[] {
    const rows = this.database.prepare(`SELECT b.agent_id, b.role_key, a.role_template_id, a.display_name,
      r.display_name AS short_title, b.provider, b.model_id, b.model_snapshot_id, b.plan_type, a.activation_state
      FROM agent_model_bindings b JOIN agent_model_binding_revisions v ON v.agent_model_binding_revision_id = b.agent_model_binding_revision_id
      JOIN agent_instances a ON a.agent_id = b.agent_id JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE b.owner_id = ? AND b.book_id = ? AND v.status = 'active' AND b.status = 'active'`)
      .all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, string>>;
    return rows.map((row) => ({ agentId: row.agent_id!, roleKey: row.role_key!, roleTemplateId: row.role_template_id!,
      memberName: row.display_name!, shortTitle: row.short_title!, provider: row.provider!, modelId: row.model_id!,
      modelSnapshotId: row.model_snapshot_id!, activationState: row.activation_state!, plan: row.plan_type! }));
  }

  public revisionBindings(scope: BookScope, revisionId: string): TeamAgentRow[] {
    assertBookScope(scope);
    const rows = this.database.prepare(`SELECT b.agent_id, b.role_key, a.role_template_id, a.display_name,
      r.display_name AS short_title, b.provider, b.model_id, b.model_snapshot_id, b.plan_type, a.activation_state
      FROM agent_model_bindings b
      JOIN agent_model_binding_revisions v ON v.agent_model_binding_revision_id = b.agent_model_binding_revision_id
        AND v.owner_id = b.owner_id AND v.book_id = b.book_id
      JOIN agent_instances a ON a.agent_id = b.agent_id AND a.owner_id = b.owner_id AND a.book_id = b.book_id
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE b.owner_id = ? AND b.book_id = ? AND b.agent_model_binding_revision_id = ? AND b.status = 'active'
      ORDER BY b.role_key`)
      .all(scope.ownerId, scope.bookId, revisionId) as unknown as Array<Record<string, string>>;
    return rows.map((row) => ({ agentId: row.agent_id!, roleKey: row.role_key!, roleTemplateId: row.role_template_id!,
      memberName: row.display_name!, shortTitle: row.short_title!, provider: row.provider!, modelId: row.model_id!,
      modelSnapshotId: row.model_snapshot_id!, activationState: row.activation_state!, plan: row.plan_type! }));
  }
}
