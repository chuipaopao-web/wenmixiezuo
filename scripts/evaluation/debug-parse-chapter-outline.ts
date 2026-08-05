import { DatabaseSync } from 'node:sqlite';
import { parsePlanningDepositOutput } from '../../apps/api/src/application/artifacts/planning-artifact-service.js';
import { chapterOutlineHardBoundaryFailure } from '../../apps/api/src/domain/chapter-outline-boundaries.js';

const taskId = process.argv[2];
if (!taskId) throw new Error('usage: pnpm exec tsx scripts/evaluation/debug-parse-chapter-outline.ts <task-id>');

const database = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
try {
  const task = database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?').get(taskId) as
    | { task_brief_json: string }
    | undefined;
  if (!task) throw new Error(`task not found: ${taskId}`);
  const brief = JSON.parse(task.task_brief_json) as { scopeText?: string };
  const rows = database.prepare(`
    SELECT c.phase_key, r.output_text
    FROM model_calls c
    JOIN model_call_results r ON r.request_id = c.request_id
    WHERE c.task_id = ? AND c.phase_key LIKE 'independent:%editor:%'
    ORDER BY c.rowid
  `).all(taskId) as unknown as Array<{ phase_key: string; output_text: string }>;
  const results = rows.map((row) => {
    try {
      const planning = parsePlanningDepositOutput(row.output_text);
      const boundaryFailures = planning?.chapters.map((chapter) =>
        chapterOutlineHardBoundaryFailure(brief.scopeText ?? '', chapter)) ?? [];
      return {
        phaseKey: row.phase_key,
        parsed: planning !== null,
        chapterCount: planning?.chapters.length ?? 0,
        boundaryFailures
      };
    } catch (error) {
      return {
        phaseKey: row.phase_key,
        parsed: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  console.log(JSON.stringify(results, null, 2));
} finally {
  database.close();
}
