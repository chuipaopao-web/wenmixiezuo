import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface SettingPanelTaskRow {
  task_id: string;
  discussion_id: string;
  task_status: string;
  discussion_status: string;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingProposalRow {
  proposal_id: string;
  sender_agent_id: string | null;
  member_name: string | null;
  role_key: string | null;
  model_provider: string | null;
  model_id: string | null;
  content: string;
  decision_id: string | null;
  created_at: string;
}

export interface SettingPanelMemberRow {
  agent_id: string;
  member_name: string;
  role_key: string;
  model_provider: string;
  model_id: string;
  responded: number;
}

export interface SettingRevisionTaskRow {
  task_id: string;
  status: string;
  error_code: string | null;
  updated_at: string;
}

export interface SettingCommandTaskRow {
  task_id: string;
  status: string;
  task_brief_json: string;
}

export interface SettingEditorLeaseRow {
  agent_id: string;
  editor_epoch: number;
}

export class SettingCollaborationRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public latestPanel(scope: BookScope, itemKey: string): SettingPanelTaskRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(
      "SELECT t.task_id, json_extract(t.task_brief_json, '$.discussionId') AS discussion_id, t.status AS task_status, d.status AS discussion_status, t.error_code, t.created_at, t.updated_at FROM tasks t JOIN discussions d ON d.discussion_id = json_extract(t.task_brief_json, '$.discussionId') AND d.owner_id = t.owner_id AND d.book_id = t.book_id WHERE t.owner_id = ? AND t.book_id = ? AND t.task_type = 'discussion' AND json_extract(t.task_brief_json, '$.purpose') IN ('creative_concept_panel', 'setting_proposal_panel') AND (json_extract(t.task_brief_json, '$.settingItemKey') = ? OR (? = 'creative-concept' AND json_extract(t.task_brief_json, '$.purpose') = 'creative_concept_panel' AND json_extract(t.task_brief_json, '$.settingItemKey') IS NULL)) ORDER BY t.created_at DESC, t.task_id DESC LIMIT 1"
    ).get(scope.ownerId, scope.bookId, itemKey, itemKey) as SettingPanelTaskRow | undefined;
  }

  public proposals(scope: BookScope, discussionId: string): SettingProposalRow[] {
    assertBookScope(scope);
    return this.database.prepare(
      "SELECT o.opinion_id AS proposal_id, o.agent_id AS sender_agent_id, a.display_name AS member_name, r.role_key, m.provider AS model_provider, m.model_id, CAST(json_extract(o.content_json, '$.recommendation') AS TEXT) AS content, (SELECT d.decision_id FROM discussion_decisions d WHERE d.owner_id = o.owner_id AND d.book_id = o.book_id AND d.discussion_id = o.discussion_id ORDER BY d.created_at DESC, d.decision_id DESC LIMIT 1) AS decision_id, o.created_at FROM discussion_opinions o JOIN agent_instances a ON a.agent_id = o.agent_id AND a.owner_id = o.owner_id AND a.book_id = o.book_id JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version JOIN model_config_snapshots m ON m.model_snapshot_id = o.model_snapshot_id WHERE o.owner_id = ? AND o.book_id = ? AND o.discussion_id = ? AND o.phase = 'independent' ORDER BY o.created_at, o.opinion_id"
    ).all(scope.ownerId, scope.bookId, discussionId) as unknown as SettingProposalRow[];
  }

  public panelMembers(scope: BookScope, discussionId: string): SettingPanelMemberRow[] {
    assertBookScope(scope);
    return this.database.prepare(
      "SELECT p.agent_id, a.display_name AS member_name, r.role_key, m.provider AS model_provider, m.model_id, p.responded FROM discussion_participants p JOIN agent_instances a ON a.agent_id = p.agent_id AND a.owner_id = p.owner_id AND a.book_id = p.book_id JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version JOIN model_config_snapshots m ON m.model_snapshot_id = COALESCE(p.model_snapshot_id, a.model_snapshot_id) WHERE p.owner_id = ? AND p.book_id = ? AND p.discussion_id = ? ORDER BY CASE r.role_key WHEN 'chief_editor' THEN 0 WHEN 'lead_screenwriter' THEN 1 WHEN 'second_screenwriter' THEN 2 ELSE 9 END, p.agent_id"
    ).all(scope.ownerId, scope.bookId, discussionId) as unknown as SettingPanelMemberRow[];
  }

  public latestRevisionTask(scope: BookScope, itemKey: string): SettingRevisionTaskRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(
      "SELECT task_id, status, error_code, updated_at FROM tasks WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion' AND json_extract(task_brief_json, '$.purpose') = 'setting_synthesis' AND json_extract(task_brief_json, '$.settingItemKey') = ? ORDER BY created_at DESC, task_id DESC LIMIT 1"
    ).get(scope.ownerId, scope.bookId, itemKey) as SettingRevisionTaskRow | undefined;
  }

  public panelCount(scope: BookScope, itemKey: string): number {
    assertBookScope(scope);
    const row = this.database.prepare(
      "SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion' AND json_extract(task_brief_json, '$.purpose') IN ('creative_concept_panel', 'setting_proposal_panel') AND (json_extract(task_brief_json, '$.settingItemKey') = ? OR (? = 'creative-concept' AND json_extract(task_brief_json, '$.purpose') = 'creative_concept_panel' AND json_extract(task_brief_json, '$.settingItemKey') IS NULL))"
    ).get(scope.ownerId, scope.bookId, itemKey, itemKey) as { count: number };
    return row.count;
  }
  public taskByIdempotencyKey(scope: BookScope, idempotencyKey: string): SettingCommandTaskRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(
      'SELECT task_id, status, task_brief_json FROM tasks WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?'
    ).get(scope.ownerId, scope.bookId, idempotencyKey) as SettingCommandTaskRow | undefined;
  }

  public activeBudgetId(scope: BookScope): string | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(
      "SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1"
    ).get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
    return row?.budget_id;
  }

  public editorLease(scope: BookScope): SettingEditorLeaseRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(
      'SELECT active_editor_agent_id AS agent_id, editor_epoch FROM editor_leases WHERE owner_id = ? AND book_id = ?'
    ).get(scope.ownerId, scope.bookId) as SettingEditorLeaseRow | undefined;
  }

  public screenwriterAgentIds(scope: BookScope): string[] {
    assertBookScope(scope);
    const rows = this.database.prepare(
      "SELECT a.agent_id FROM agent_instances a JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND r.role_key IN ('lead_screenwriter', 'second_screenwriter') ORDER BY CASE r.role_key WHEN 'lead_screenwriter' THEN 0 ELSE 1 END, a.agent_id LIMIT 2"
    ).all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string }>;
    return rows.map((row) => row.agent_id);
  }

  public authorInputText(scope: BookScope, itemKey: string, authorInputId: string): string | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(
      "SELECT original_text FROM author_planning_inputs WHERE owner_id = ? AND book_id = ? AND author_input_id = ? AND surface = 'setting' AND subject_type = 'setting_module' AND subject_id = ? AND status NOT IN ('withdrawn', 'superseded')"
    ).get(scope.ownerId, scope.bookId, authorInputId, itemKey) as { original_text: string } | undefined;
    return row?.original_text;
  }
}
