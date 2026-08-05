import { DatabaseSync } from 'node:sqlite';

const taskId = process.argv[2];
if (!taskId) throw new Error('usage: node scripts/evaluation/inspect-task-summary.mjs <task-id>');

const db = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
try {
  const task = db.prepare(`
    SELECT task_id, book_id, task_type, status, current_phase, attempt_count,
      error_code, task_brief_json, checkpoint_json, created_at, updated_at
    FROM tasks WHERE task_id = ?
  `).get(taskId);
  const calls = db.prepare(`
    SELECT m.request_id, m.phase_key, m.provider, m.model_id, m.state,
      m.error_class, m.input_tokens, m.output_tokens, m.duration_ms,
      length(r.output_text) AS outputLength,
      substr(r.output_text, 1, 2_000) AS outputHead,
      substr(r.output_text, -2_000) AS outputTail
    FROM model_calls m
    LEFT JOIN model_call_results r ON r.request_id = m.request_id
    WHERE m.task_id = ?
    ORDER BY m.rowid
  `).all(taskId);
  const eventTables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND (name LIKE '%event%' OR name LIKE '%log%')
    ORDER BY name
  `).all();
  console.log(JSON.stringify({ task, calls, eventTables }, null, 2));
} finally {
  db.close();
}
