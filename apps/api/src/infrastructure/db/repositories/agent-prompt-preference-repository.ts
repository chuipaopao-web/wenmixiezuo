import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export interface AgentPromptPreferenceRow {
  prompt_preference_id: string;
  agent_id: string;
  version: number;
  content: string;
  created_at: string;
}

export class AgentPromptPreferenceRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public listAgentIds(scope: BookScope): string[] {
    const rows = this.database.prepare(`
      SELECT agent_id FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND enabled = 1
        AND (role_template_version = 2 OR NOT EXISTS (
          SELECT 1 FROM agent_instances current_team
          WHERE current_team.owner_id = agent_instances.owner_id
            AND current_team.book_id = agent_instances.book_id
            AND current_team.role_template_version = 2 AND current_team.enabled = 1
        ))
      ORDER BY created_at, agent_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string }>;
    return rows.map((row) => row.agent_id);
  }

  public agentExists(scope: BookScope, agentId: string): boolean {
    return this.database.prepare(`
      SELECT 1 FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND enabled = 1
    `).get(scope.ownerId, scope.bookId, agentId) !== undefined;
  }

  public active(scope: BookScope, agentId: string): AgentPromptPreferenceRow | null {
    return this.database.prepare(`
      SELECT prompt_preference_id, agent_id, version, content, created_at
      FROM agent_prompt_preferences
      WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND status = 'active'
      ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, agentId) as AgentPromptPreferenceRow | undefined ?? null;
  }

  public insertRevision(scope: BookScope, input: {
    id: string; agentId: string; version: number; content: string; now: string;
  }): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE agent_prompt_preferences SET status = 'superseded'
        WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND status = 'active'
      `).run(scope.ownerId, scope.bookId, input.agentId);
      this.database.prepare(`
        INSERT INTO agent_prompt_preferences (
          prompt_preference_id, owner_id, book_id, agent_id, version, content, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(input.id, scope.ownerId, scope.bookId, input.agentId, input.version, input.content, input.now);
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
