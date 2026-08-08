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

export interface SettingProposalMessageRow {
  message_id: string;
  sender_agent_id: string | null;
  member_name: string | null;
  role_key: string | null;
  model_provider: string | null;
  model_id: string | null;
  content: string;
  proposal_number: number | null;
  decision_id: string | null;
  created_at: string;
}

export interface SettingRevisionTaskRow {
  task_id: string;
  status: string;
  error_code: string | null;
  updated_at: string;
}

export class SettingCollaborationRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public latestPanel(scope: BookScope, itemKey: string): SettingPanelTaskRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT t.task_id,
        json_extract(t.task_brief_json, '$.discussionId') AS discussion_id,
        t.status AS task_status, d.status AS discussion_status,
        t.error_code, t.created_at, t.updated_at
      FROM tasks t
      JOIN discussions d
        ON d.discussion_id = json_extract(t.task_brief_json, '$.discussionId')
        AND d.owner_id = t.owner_id AND d.book_id = t.book_id
      WHERE t.owner_id = ? AND t.book_id = ? AND t.task_type = 'discussion'
        AND json_extract(t.task_brief_json, '$.purpose') IN ('creative_concept_panel', 'setting_proposal_panel')
        AND (
          json_extract(t.task_brief_json, '$.settingItemKey') = ?
          OR (? = 'creative-concept'
            AND json_extract(t.task_brief_json, '$.purpose') = 'creative_concept_panel'
            AND json_extract(t.task_brief_json, '$.settingItemKey') IS NULL)
        )
      ORDER BY t.created_at DESC, t.task_id DESC
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, itemKey, itemKey) as SettingPanelTaskRow | undefined;
  }

  public proposals(scope: BookScope, discussionId: string): SettingProposalMessageRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT m.message_id, m.sender_agent_id, a.display_name AS member_name,
        m.role_key, m.model_provider, m.model_id, m.content,
        CAST(json_extract(reference.value, '$.proposalNumber') AS INTEGER) AS proposal_number,
        json_extract(reference.value, '$.decisionId') AS decision_id,
        m.created_at
      FROM messages m
      JOIN json_each(m.references_json) AS reference
      LEFT JOIN agent_instances a
        ON a.agent_id = m.sender_agent_id
        AND a.owner_id = m.owner_id AND a.book_id = m.book_id
      WHERE m.owner_id = ? AND m.book_id = ?
        AND m.message_type = 'setting_proposal'
        AND json_extract(reference.value, '$.discussionId') = ?
        AND COALESCE(json_extract(reference.value, '$.proposalKind'), 'setting_item_independent') = 'setting_item_independent'
      ORDER BY proposal_number, m.created_at, m.message_id
    `).all(scope.ownerId, scope.bookId, discussionId) as unknown as SettingProposalMessageRow[];
  }

  public latestRevisionTask(scope: BookScope, itemKey: string): SettingRevisionTaskRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT task_id, status, error_code, updated_at
      FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'conversation_reply'
        AND json_extract(task_brief_json, '$.settingGuidance.itemKey') = ?
      ORDER BY created_at DESC, task_id DESC
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, itemKey) as SettingRevisionTaskRow | undefined;
  }

  public panelCount(scope: BookScope, itemKey: string): number {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') IN ('creative_concept_panel', 'setting_proposal_panel')
        AND (
          json_extract(task_brief_json, '$.settingItemKey') = ?
          OR (? = 'creative-concept'
            AND json_extract(task_brief_json, '$.purpose') = 'creative_concept_panel'
            AND json_extract(task_brief_json, '$.settingItemKey') IS NULL)
        )
    `).get(scope.ownerId, scope.bookId, itemKey, itemKey) as { count: number };
    return row.count;
  }
}
