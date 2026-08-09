import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export interface IdeationRoundRow {
  discussion_id: string;
  task_id: string;
  task_status: string;
  current_phase: string;
  error_code: string | null;
  scope_text: string;
  created_at: string;
  updated_at: string;
}

export interface IdeationOpinionRow {
  opinion_id: string;
  agent_id: string;
  member_name: string;
  role_key: string;
  provider: string;
  model_id: string;
  content: string | null;
  created_at: string;
}

const roundProjection = `
  SELECT d.discussion_id, t.task_id, t.status AS task_status, t.current_phase,
         t.error_code, d.scope_text, d.created_at, t.updated_at
  FROM discussions d JOIN tasks t
    ON t.owner_id = d.owner_id AND t.book_id = d.book_id
   AND json_extract(t.task_brief_json, '$.discussionId') = d.discussion_id`;

const opinionProjection = `
  SELECT o.opinion_id, o.agent_id, a.display_name AS member_name, r.role_key,
         m.provider, m.model_id,
         CAST(json_extract(o.content_json, '$.recommendation') AS TEXT) AS content,
         o.created_at
  FROM discussion_opinions o
  JOIN agent_instances a ON a.agent_id = o.agent_id AND a.owner_id = o.owner_id AND a.book_id = o.book_id
  JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
  JOIN model_config_snapshots m ON m.model_snapshot_id = o.model_snapshot_id`;

export class IdeationRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public activeEditor(scope: BookScope): { agent_id: string | null; epoch: number } | null {
    const row = this.database.prepare(`
      SELECT active_editor_agent_id, editor_epoch FROM books
      WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { active_editor_agent_id: string | null; editor_epoch: number } | undefined;
    return row === undefined ? null : { agent_id: row.active_editor_agent_id, epoch: row.editor_epoch };
  }

  public bookTitle(scope: BookScope): string | null {
    const row = this.database.prepare('SELECT title FROM books WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId) as { title: string } | undefined;
    return row?.title ?? null;
  }

  public latestBudgetId(scope: BookScope): string | null {
    const row = this.database.prepare(`
      SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
    return row?.budget_id ?? null;
  }

  public listRounds(scope: BookScope, markerPrefix: string): IdeationRoundRow[] {
    return this.database.prepare(`${roundProjection}
      WHERE d.owner_id = ? AND d.book_id = ? AND d.scope_text LIKE ?
      ORDER BY d.created_at, d.discussion_id
    `).all(scope.ownerId, scope.bookId, markerPrefix) as unknown as IdeationRoundRow[];
  }

  public findRoundByTaskIdempotency(scope: BookScope, idempotencyKey: string, markerPrefix: string): IdeationRoundRow | null {
    const row = this.database.prepare(`${roundProjection}
      WHERE t.owner_id = ? AND t.book_id = ? AND t.idempotency_key = ? AND d.scope_text LIKE ?
    `).get(scope.ownerId, scope.bookId, idempotencyKey, markerPrefix) as IdeationRoundRow | undefined;
    return row ?? null;
  }

  public requireRound(scope: BookScope, roundId: string, markerPrefix: string): IdeationRoundRow | null {
    const row = this.database.prepare(`${roundProjection}
      WHERE d.owner_id = ? AND d.book_id = ? AND d.discussion_id = ? AND d.scope_text LIKE ?
    `).get(scope.ownerId, scope.bookId, roundId, markerPrefix) as IdeationRoundRow | undefined;
    return row ?? null;
  }

  public opinions(scope: BookScope, discussionId: string): IdeationOpinionRow[] {
    return this.database.prepare(`${opinionProjection}
      WHERE o.owner_id = ? AND o.book_id = ? AND o.discussion_id = ? AND o.phase = 'independent'
      ORDER BY o.created_at, o.opinion_id
    `).all(scope.ownerId, scope.bookId, discussionId) as unknown as IdeationOpinionRow[];
  }

  public opinion(scope: BookScope, discussionId: string, opinionId: string): IdeationOpinionRow | null {
    const row = this.database.prepare(`${opinionProjection}
      WHERE o.owner_id = ? AND o.book_id = ? AND o.discussion_id = ? AND o.opinion_id = ?
    `).get(scope.ownerId, scope.bookId, discussionId, opinionId) as IdeationOpinionRow | undefined;
    return row ?? null;
  }

  public isIdeationDiscussion(scope: BookScope, discussionId: string, markerPrefix: string): boolean {
    return this.database.prepare(`
      SELECT 1 FROM discussions WHERE owner_id = ? AND book_id = ?
        AND discussion_id = ? AND scope_text LIKE ?
    `).get(scope.ownerId, scope.bookId, discussionId, markerPrefix) !== undefined;
  }
}
