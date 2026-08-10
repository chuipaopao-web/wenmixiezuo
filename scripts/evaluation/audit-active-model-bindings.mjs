import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const databasePath = resolve(process.env.WENMI_DATA_DIR ?? resolve(projectRoot, 'data'), 'database', 'wenmi.sqlite');
const database = new DatabaseSync(databasePath, { readOnly: true });

try {
  const books = database.prepare(`
    SELECT book_id AS bookId, title, status
    FROM books
    ORDER BY created_at
  `).all();
  const currentAgents = database.prepare(`
    SELECT a.book_id AS bookId, r.role_key AS roleKey, a.display_name AS memberName,
           m.provider, m.model_id AS modelId
    FROM agent_instances a
    JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
    JOIN role_templates r
      ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
    WHERE a.enabled = 1
    ORDER BY a.book_id, r.role_key
  `).all();
  const activeBindings = database.prepare(`
    SELECT b.book_id AS bookId, b.role_key AS roleKey, b.provider,
           b.model_id AS modelId, rv.version
    FROM agent_model_bindings b
    JOIN agent_model_binding_revisions rv
      ON rv.agent_model_binding_revision_id = b.agent_model_binding_revision_id
    WHERE b.status = 'active' AND rv.status = 'active'
    ORDER BY b.book_id, b.role_key
  `).all();
  const modelSnapshotCounts = database.prepare(`
    SELECT model_id AS modelId, COUNT(*) AS snapshotCount
    FROM model_config_snapshots
    GROUP BY model_id
    ORDER BY model_id
  `).all();

  console.log(JSON.stringify({ books, currentAgents, activeBindings, modelSnapshotCounts }, null, 2));
} finally {
  database.close();
}
