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
  run_status: 'preparing' | 'working' | 'completed' | 'failed' | 'unavailable' | 'paused';
  error_summary: string | null;
  last_attempted_at: string | null;
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

export interface SettingAgentModelProfileRow {
  agent_id: string;
  provider: string;
  model_id: string;
  plan_type: string | null;
}

export interface SettingProposalFragmentRow {
  fragment_id: string;
  item_key: string;
  discussion_id: string;
  proposal_id: string;
  member_name: string;
  role_key: string | null;
  fragment_no: number;
  fragment_text: string;
  implicit: number;
  created_at: string;
}

export interface SettingFusionDraftRow {
  item_key: string;
  task_id: string;
  selected_fragment_ids_json: string;
  segments_json: string;
  content_text: string;
  created_at: string;
}

export class SettingCollaborationRepository {
  public constructor(private readonly database: DatabaseSync) {}
  public discussionScopeText(scope: BookScope, discussionId: string): string | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(
      'SELECT scope_text FROM discussions WHERE owner_id = ? AND book_id = ? AND discussion_id = ?'
    ).get(scope.ownerId, scope.bookId, discussionId) as { scope_text: string } | undefined;
    return row?.scope_text;
  }


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

  public latestProposalsByRole(scope: BookScope, itemKey: string): SettingProposalRow[] {
    assertBookScope(scope);
    return this.database.prepare(
      "WITH ranked AS (SELECT o.opinion_id AS proposal_id, o.agent_id AS sender_agent_id, a.display_name AS member_name, r.role_key, m.provider AS model_provider, m.model_id, CAST(json_extract(o.content_json, '$.recommendation') AS TEXT) AS content, (SELECT d.decision_id FROM discussion_decisions d WHERE d.owner_id = o.owner_id AND d.book_id = o.book_id AND d.discussion_id = o.discussion_id ORDER BY d.created_at DESC, d.decision_id DESC LIMIT 1) AS decision_id, o.created_at, ROW_NUMBER() OVER (PARTITION BY r.role_key ORDER BY o.created_at DESC, o.opinion_id DESC) AS proposal_rank, MIN(o.created_at) OVER (PARTITION BY r.role_key) AS first_created_at, MIN(o.opinion_id) OVER (PARTITION BY r.role_key) AS first_proposal_id FROM tasks t JOIN discussion_opinions o ON o.discussion_id = json_extract(t.task_brief_json, '$.discussionId') AND o.owner_id = t.owner_id AND o.book_id = t.book_id JOIN agent_instances a ON a.agent_id = o.agent_id AND a.owner_id = o.owner_id AND a.book_id = o.book_id JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version JOIN model_config_snapshots m ON m.model_snapshot_id = o.model_snapshot_id WHERE t.owner_id = ? AND t.book_id = ? AND t.task_type = 'discussion' AND json_extract(t.task_brief_json, '$.purpose') = 'setting_proposal_panel' AND json_extract(t.task_brief_json, '$.settingItemKey') = ? AND o.phase = 'independent') SELECT proposal_id, sender_agent_id, member_name, role_key, model_provider, model_id, content, decision_id, created_at FROM ranked WHERE proposal_rank = 1 ORDER BY first_created_at, first_proposal_id"
    ).all(scope.ownerId, scope.bookId, itemKey) as unknown as SettingProposalRow[];
  }

  public panelMembers(scope: BookScope, discussionId: string): SettingPanelMemberRow[] {
    assertBookScope(scope);
    return this.database.prepare(
      "SELECT p.agent_id, a.display_name AS member_name, r.role_key, m.provider AS model_provider, m.model_id, p.responded, p.run_status, p.error_summary, p.last_attempted_at FROM discussion_participants p JOIN agent_instances a ON a.agent_id = p.agent_id AND a.owner_id = p.owner_id AND a.book_id = p.book_id JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version JOIN model_config_snapshots m ON m.model_snapshot_id = COALESCE(p.model_snapshot_id, a.model_snapshot_id) WHERE p.owner_id = ? AND p.book_id = ? AND p.discussion_id = ? ORDER BY CASE r.role_key WHEN 'chief_editor' THEN 0 WHEN 'lead_screenwriter' THEN 1 WHEN 'second_screenwriter' THEN 2 WHEN 'third_screenwriter' THEN 3 WHEN 'senior_screenwriter' THEN 4 ELSE 9 END, p.agent_id"
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

  public authorInputText(scope: BookScope, itemKey: string, authorInputId: string): { text: string; intent: string } | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(
      "SELECT original_text, intent_strength FROM author_planning_inputs WHERE owner_id = ? AND book_id = ? AND author_input_id = ? AND surface = 'setting' AND subject_type = 'setting_module' AND subject_id = ? AND status NOT IN ('withdrawn', 'superseded')"
    ).get(scope.ownerId, scope.bookId, authorInputId, itemKey) as { original_text: string; intent_strength: string } | undefined;
    return row === undefined ? undefined : { text: row.original_text, intent: row.intent_strength };
  }

  public agentModelProfiles(scope: BookScope, agentIds: string[]): SettingAgentModelProfileRow[] {
    assertBookScope(scope);
    const statement = this.database.prepare(
      'SELECT a.agent_id, m.provider, m.model_id, m.parameters_json FROM agent_instances a JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id WHERE a.owner_id = ? AND a.book_id = ? AND a.agent_id = ? AND a.enabled = 1'
    );
    return agentIds.map((agentId) => {
      const row = statement.get(scope.ownerId, scope.bookId, agentId) as {
        agent_id: string; provider: string; model_id: string; parameters_json: string;
      } | undefined;
      if (row === undefined) return undefined;
      const parameters = JSON.parse(row.parameters_json) as { plan?: unknown };
      return { agent_id: row.agent_id, provider: row.provider, model_id: row.model_id,
        plan_type: typeof parameters.plan === 'string' ? parameters.plan : null };
    }).filter((profile): profile is SettingAgentModelProfileRow => profile !== undefined);
  }

  public roleAgentId(scope: BookScope, roleKey: string): string | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(
      'SELECT a.agent_id FROM agent_instances a JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND r.role_key = ? LIMIT 1'
    ).get(scope.ownerId, scope.bookId, roleKey) as { agent_id: string } | undefined;
    return row?.agent_id;
  }

  public proposalPanelAgentIds(scope: BookScope, roleKeys: string[] = [
    'lead_screenwriter', 'second_screenwriter', 'third_screenwriter', 'senior_screenwriter'
  ]): Array<{ agentId: string; roleKey: string }> {
    assertBookScope(scope);
    const rows = this.database.prepare(
      "SELECT a.agent_id, r.role_key FROM agent_instances a JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND a.activation_state IN ('idle','standby') AND r.role_key IN ('lead_screenwriter', 'second_screenwriter', 'third_screenwriter', 'senior_screenwriter') ORDER BY CASE r.role_key WHEN 'lead_screenwriter' THEN 0 WHEN 'second_screenwriter' THEN 1 WHEN 'third_screenwriter' THEN 2 ELSE 3 END, a.agent_id"
    ).all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; role_key: string }>;
    const selected = new Set(roleKeys);
    return rows.filter((row) => selected.has(row.role_key))
      .map((row) => ({ agentId: row.agent_id, roleKey: row.role_key }));
  }

  public screenwriterOptions(scope: BookScope): SettingScreenwriterOptionRow[] {
    assertBookScope(scope);
    return this.database.prepare(
      "SELECT a.agent_id, a.display_name AS member_name, r.role_key, m.provider, m.model_id, json_extract(m.parameters_json, '$.plan') AS plan_type, a.enabled, a.activation_state FROM agent_instances a JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('lead_screenwriter', 'second_screenwriter', 'third_screenwriter', 'senior_screenwriter') ORDER BY CASE r.role_key WHEN 'lead_screenwriter' THEN 0 WHEN 'second_screenwriter' THEN 1 WHEN 'third_screenwriter' THEN 2 ELSE 3 END, a.agent_id"
    ).all(scope.ownerId, scope.bookId) as unknown as SettingScreenwriterOptionRow[];
  }

  public resetPanelMemberForRetry(scope: BookScope, discussionId: string, agentId: string, now: string): boolean {
    assertBookScope(scope);
    return this.database.prepare(
      "UPDATE discussion_participants SET run_status = 'preparing', error_summary = NULL, last_attempted_at = ? WHERE owner_id = ? AND book_id = ? AND discussion_id = ? AND agent_id = ? AND run_status IN ('failed','unavailable')"
    ).run(now, scope.ownerId, scope.bookId, discussionId, agentId).changes === 1;
  }

  public saveProposalFragments(scope: BookScope, rows: Array<{
    fragmentId: string; itemKey: string; discussionId: string; proposalId: string;
    memberName: string; roleKey: string | null; fragmentNo: number; text: string;
    implicit: boolean; now: string;
  }>): void {
    assertBookScope(scope);
    const statement = this.database.prepare(
      'INSERT OR IGNORE INTO setting_proposal_fragments (fragment_id, owner_id, book_id, item_key, discussion_id, proposal_id, member_name, role_key, fragment_no, fragment_text, implicit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const row of rows) {
      statement.run(row.fragmentId, scope.ownerId, scope.bookId, row.itemKey, row.discussionId,
        row.proposalId, row.memberName, row.roleKey, row.fragmentNo, row.text, row.implicit ? 1 : 0, row.now);
    }
  }

  public fragmentsByDiscussion(scope: BookScope, discussionId: string): SettingProposalFragmentRow[] {
    assertBookScope(scope);
    return this.database.prepare(
      'SELECT fragment_id, item_key, discussion_id, proposal_id, member_name, role_key, fragment_no, fragment_text, implicit, created_at FROM setting_proposal_fragments WHERE owner_id = ? AND book_id = ? AND discussion_id = ? ORDER BY proposal_id, fragment_no'
    ).all(scope.ownerId, scope.bookId, discussionId) as unknown as SettingProposalFragmentRow[];
  }

  public fragmentsByProposalIds(scope: BookScope, proposalIds: string[]): SettingProposalFragmentRow[] {
    assertBookScope(scope);
    if (proposalIds.length === 0) return [];
    const marks = proposalIds.map(() => '?').join(',');
    return this.database.prepare(
      'SELECT fragment_id, item_key, discussion_id, proposal_id, member_name, role_key, fragment_no, fragment_text, implicit, created_at FROM setting_proposal_fragments WHERE owner_id = ? AND book_id = ? AND proposal_id IN (' + marks + ') ORDER BY proposal_id, fragment_no'
    ).all(scope.ownerId, scope.bookId, ...proposalIds) as unknown as SettingProposalFragmentRow[];
  }

  public fragmentsByIds(scope: BookScope, fragmentIds: string[]): SettingProposalFragmentRow[] {
    assertBookScope(scope);
    if (fragmentIds.length === 0) return [];
    const marks = fragmentIds.map(() => '?').join(',');
    return this.database.prepare(
      'SELECT fragment_id, item_key, discussion_id, proposal_id, member_name, role_key, fragment_no, fragment_text, implicit, created_at FROM setting_proposal_fragments WHERE owner_id = ? AND book_id = ? AND fragment_id IN (' + marks + ') ORDER BY proposal_id, fragment_no'
    ).all(scope.ownerId, scope.bookId, ...fragmentIds) as unknown as SettingProposalFragmentRow[];
  }

  public saveFusionDraft(scope: BookScope, input: {
    itemKey: string; taskId: string; selectedFragmentIds: string[];
    segmentsJson: string; contentText: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(
      'INSERT INTO setting_fusion_drafts (owner_id, book_id, item_key, task_id, selected_fragment_ids_json, segments_json, content_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(scope.ownerId, scope.bookId, input.itemKey, input.taskId,
      JSON.stringify(input.selectedFragmentIds), input.segmentsJson, input.contentText, input.now);
  }

  public latestFusionDraft(scope: BookScope, itemKey: string): SettingFusionDraftRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(
      'SELECT item_key, task_id, selected_fragment_ids_json, segments_json, content_text, created_at FROM setting_fusion_drafts WHERE owner_id = ? AND book_id = ? AND item_key = ? ORDER BY created_at DESC, task_id DESC LIMIT 1'
    ).get(scope.ownerId, scope.bookId, itemKey) as SettingFusionDraftRow | undefined;
  }

  public chiefEditorAgentId(scope: BookScope): string | undefined {
    assertBookScope(scope);
    const row = this.database.prepare(
      'SELECT a.agent_id FROM agent_instances a JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND r.role_key = ? LIMIT 1'
    ).get(scope.ownerId, scope.bookId, 'chief_editor') as { agent_id: string } | undefined;
    return row?.agent_id;
  }
}

export interface SettingScreenwriterOptionRow {
  agent_id: string;
  member_name: string;
  role_key: string;
  provider: string;
  model_id: string;
  plan_type: string | null;
  enabled: number;
  activation_state: string;
}
