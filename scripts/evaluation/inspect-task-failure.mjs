import { DatabaseSync } from 'node:sqlite';

const taskId = process.argv[2];
if (!taskId) throw new Error('usage: node scripts/evaluation/inspect-task-failure.mjs <task-id>');

const db = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
try {
  const tables = ['tasks', 'task_attempts', 'discussions', 'discussion_messages', 'model_calls'];
  const schemas = Object.fromEntries(tables.map((table) => [
    table,
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql ?? null
  ]));
  const task = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
  const attempts = db.prepare('SELECT * FROM task_attempts WHERE task_id = ? ORDER BY attempt_no').all(taskId);
  const calls = db.prepare(`
    SELECT m.*, r.output_text, r.output_hash
    FROM model_calls m
    LEFT JOIN model_call_results r ON r.request_id = m.request_id
    WHERE m.task_id = ?
    ORDER BY m.rowid
  `).all(taskId);
  const contextPacks = db.prepare(`
    SELECT context_pack_id, agent_id, total_tokens, source_manifest_json,
      excluded_sources_json, created_at
    FROM context_packs
    WHERE task_id = ?
    ORDER BY rowid
  `).all(taskId).map((pack) => ({
    ...pack,
    sources: JSON.parse(pack.source_manifest_json).map((source) => ({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      reason: source.reason,
      tokenCount: source.tokenCount,
      content: source.content
    })),
    excluded: JSON.parse(pack.excluded_sources_json),
    source_manifest_json: undefined,
    excluded_sources_json: undefined
  }));
  const brief = task ? JSON.parse(task.task_brief_json) : null;
  const discussionId = brief?.discussionId ?? null;
  const discussion = discussionId
    ? db.prepare('SELECT * FROM discussions WHERE discussion_id = ?').get(discussionId)
    : null;
  const opinions = discussionId
    ? db.prepare('SELECT * FROM discussion_opinions WHERE discussion_id = ? ORDER BY rowid').all(discussionId)
    : [];
  const planningState = task
    ? db.prepare('SELECT * FROM book_planning_states WHERE owner_id = ? AND book_id = ?')
        .get(task.owner_id, task.book_id)
    : null;
  const styleVersions = task
    ? db.prepare('SELECT style_version_id, version, status, created_at FROM book_style_versions WHERE owner_id = ? AND book_id = ? ORDER BY version')
        .all(task.owner_id, task.book_id)
    : [];
  const artifactCounts = task
    ? db.prepare('SELECT artifact_type, status, COUNT(*) AS count FROM artifacts WHERE owner_id = ? AND book_id = ? GROUP BY artifact_type, status ORDER BY artifact_type, status')
        .all(task.owner_id, task.book_id)
    : [];
  const pipelineRun = task
    ? db.prepare('SELECT * FROM chapter_pipeline_runs WHERE owner_id = ? AND book_id = ? AND task_id = ?')
        .get(task.owner_id, task.book_id, taskId)
    : null;
  console.log(JSON.stringify({
    schemas, task, attempts, calls, contextPacks, discussion, opinions,
    planningState, styleVersions, artifactCounts, pipelineRun
  }, null, 2));
} finally {
  db.close();
}
