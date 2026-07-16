import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { RoleKey } from '../../domain/roles.js';
import type { RoleModelProfile } from '../../infrastructure/models/model-runtime-config.js';

interface AgentBindingRow {
  agent_id: string;
  owner_id: string;
  book_id: string;
  role_key: RoleKey;
  model_snapshot_id: string;
  provider: string;
  model_id: string;
  capabilities_json: string;
}

export interface ModelBindingResult {
  booksVisited: number;
  updatedAgents: number;
  supersededWriterSelections: number;
}

/**
 * Binds existing books to a new role/model policy without mutating historical
 * model snapshots. Existing calls and chapter runs therefore remain auditable.
 */
export class ModelBindingService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly roleProfiles: Record<RoleKey, RoleModelProfile>
  ) {}

  public bindAllBooks(): ModelBindingResult {
    const rows = this.database.prepare(`
      SELECT a.agent_id, a.owner_id, a.book_id, r.role_key,
             a.model_snapshot_id, m.provider, m.model_id, m.capabilities_json
      FROM agent_instances a
      JOIN books b ON b.owner_id = a.owner_id AND b.book_id = a.book_id
      JOIN role_templates r
        ON r.role_template_id = a.role_template_id
       AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE b.status IN ('draft', 'active', 'paused')
      ORDER BY a.owner_id, a.book_id, r.role_key
    `).all() as unknown as AgentBindingRow[];

    const books = new Set(rows.map((row) => `${row.owner_id}\n${row.book_id}`));
    let updatedAgents = 0;
    let supersededWriterSelections = 0;
    const now = this.clock.now().toISOString();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const profile = this.roleProfiles[row.role_key];
        if (row.provider === profile.provider && row.model_id === profile.modelId) continue;
        const snapshotId = this.ids.next();
        this.database.prepare(`
          INSERT INTO model_config_snapshots (
            model_snapshot_id, owner_id, book_id, provider, model_id,
            parameters_json, capabilities_json, validated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          snapshotId,
          row.owner_id,
          row.book_id,
          profile.provider,
          profile.modelId,
          JSON.stringify({
            plan: profile.plan,
            strictSubscriptionOnly: profile.plan !== 'deterministic',
            cashFallbackAllowed: false,
            cashCostCny: 0
          }),
          row.capabilities_json,
          now,
          now
        );
        this.database.prepare(`
          UPDATE agent_instances
          SET model_snapshot_id = ?, updated_at = ?
          WHERE agent_id = ? AND owner_id = ? AND book_id = ?
        `).run(snapshotId, now, row.agent_id, row.owner_id, row.book_id);
        updatedAgents += 1;

        if (row.role_key === 'writer') {
          const result = this.database.prepare(`
            UPDATE writer_selections
            SET status = 'superseded'
            WHERE owner_id = ? AND book_id = ? AND status = 'selected'
              AND selected_model_snapshot_id <> ?
          `).run(row.owner_id, row.book_id, snapshotId);
          supersededWriterSelections += Number(result.changes);
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return { booksVisited: books.size, updatedAgents, supersededWriterSelections };
  }
}
