import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export class AgentContinuityRepository {
  public constructor(private readonly database: DatabaseSync) {}
  public appendJournal(scope: BookScope, input: { id: string; agentId: string; taskId?: string; entryType: string; content: unknown; sourceIds: string[]; canonRevision: number; now: string }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO agent_continuity_journals (
      agent_continuity_journal_id, owner_id, book_id, agent_id, task_id, entry_type, content_json,
      source_ids_json, canon_revision, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(input.id, scope.ownerId, scope.bookId, input.agentId,
      input.taskId ?? null, input.entryType, JSON.stringify(input.content), JSON.stringify(input.sourceIds), input.canonRevision, input.now);
  }
  public listJournal(scope: BookScope, agentId: string): Array<{ type: string; content: unknown; sourceIds: string[] }> {
    const rows = this.database.prepare(`SELECT entry_type, content_json, source_ids_json FROM agent_continuity_journals
      WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND status = 'active' ORDER BY created_at, agent_continuity_journal_id`)
      .all(scope.ownerId, scope.bookId, agentId) as unknown as Array<{ entry_type: string; content_json: string; source_ids_json: string }>;
    return rows.map((row) => ({ type: row.entry_type, content: JSON.parse(row.content_json) as unknown, sourceIds: JSON.parse(row.source_ids_json) as string[] }));
  }
  public nextFocusVersion(scope: BookScope, agentId: string): number {
    return (this.database.prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM agent_focus_snapshots WHERE owner_id = ? AND book_id = ? AND agent_id = ?`)
      .get(scope.ownerId, scope.bookId, agentId) as { version: number }).version + 1;
  }
  public activateFocus(scope: BookScope, input: { id: string; agentId: string; version: number; current: unknown; unresolved: unknown; lastContribution: unknown; canonRevision: number; now: string }): void {
    this.database.prepare(`UPDATE agent_focus_snapshots SET status = 'superseded' WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND status = 'active'`)
      .run(scope.ownerId, scope.bookId, input.agentId);
    this.database.prepare(`INSERT INTO agent_focus_snapshots (
      agent_focus_snapshot_id, owner_id, book_id, agent_id, version, current_focus_json, unresolved_json,
      last_contribution_json, canon_revision, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(input.id, scope.ownerId, scope.bookId, input.agentId,
      input.version, JSON.stringify(input.current), JSON.stringify(input.unresolved), JSON.stringify(input.lastContribution), input.canonRevision, input.now);
  }
}
