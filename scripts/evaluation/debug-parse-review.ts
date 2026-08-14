import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseProductionReview, type ReviewerRole } from '../../apps/api/src/contracts/production-review.js';
import { groundProductionReviewEvidence } from '../../apps/api/src/application/creation/production-review-service.js';

const [taskId, reviewerRole = 'fact'] = process.argv.slice(2) as [string | undefined, ReviewerRole | undefined];
if (!taskId || !['fact', 'literary', 'experience'].includes(reviewerRole)) {
  throw new Error('usage: debug-parse-review.ts <taskId> <fact|literary|experience>');
}

const database = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
try {
  const task = database.prepare('SELECT owner_id, book_id FROM tasks WHERE task_id = ?').get(taskId) as
    | { owner_id: string; book_id: string }
    | undefined;
  if (!task) throw new Error(`task not found: ${taskId}`);
  const run = database.prepare(`SELECT chapter_id, current_manuscript_version_id, review_panel_id
    FROM chapter_pipeline_runs WHERE task_id = ?`).get(taskId) as
    | { chapter_id: string; current_manuscript_version_id: string; review_panel_id: string }
    | undefined;
  if (!run) throw new Error(`chapter pipeline run not found: ${taskId}`);
  const row = database.prepare(`
    SELECT c.phase_key, c.model_snapshot_id, r.output_text
    FROM model_calls c
    JOIN model_call_results r ON r.request_id = c.request_id
    WHERE c.task_id = ? AND c.phase_key LIKE ?
    ORDER BY c.created_at DESC LIMIT 1
  `).get(taskId, `%${reviewerRole}%`) as
    | { phase_key: string; model_snapshot_id: string; output_text: string }
    | undefined;
  if (!row) throw new Error(`review output not found for ${reviewerRole}`);
  const manuscript = database.prepare(`SELECT f.relative_path
    FROM manuscript_versions m JOIN file_registry f ON f.file_id = m.file_id
    WHERE m.owner_id = ? AND m.book_id = ? AND m.manuscript_version_id = ?`).get(
      task.owner_id,
      task.book_id,
      run.current_manuscript_version_id
    ) as { relative_path: string } | undefined;
  if (!manuscript) throw new Error(`manuscript not found: ${run.current_manuscript_version_id}`);
  try {
    const parsed = parseProductionReview(row.output_text, {
      reviewerRole,
      manuscriptVersionId: run.current_manuscript_version_id,
      modelSnapshotId: row.model_snapshot_id
    }, {
      allowDroppingInvalidFactCandidates: true,
      normalizeLocalBlockers: true,
      normalizeAiStyleEvidence: true,
      normalizeRepairedVerdict: true,
      normalizeMalformedJsonStrings: true,
      normalizeRiskArrays: true,
      normalizeScoreArray: true,
      normalizeIssueLocations: true,
      normalizeIssueLimit: true,
      normalizeRepairedSeverity: true,
      normalizeIssueFieldAliases: true,
      normalizeFrozenBindings: true,
      normalizeProvisionalDraftBlockers: true,
      normalizeFactOmissionMajor: true
    });
    const content = readFileSync(resolve('data', manuscript.relative_path), 'utf8');
    const grounded = groundProductionReviewEvidence(parsed, content, {
      allowDroppingUngroundedFactCandidates: true,
      allowGroundedEvidenceExcerptRecovery: true,
      allowDroppingUngroundedAiStyleEvidence: true,
      allowDroppingUngroundedIssues: true
    });
    process.stdout.write(`${JSON.stringify({ ok: true, phaseKey: row.phase_key, verdict: grounded.verdict,
      issues: grounded.issues.length, facts: grounded.factCandidates?.length ?? null }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, phaseKey: row.phase_key,
      error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
  }
} finally {
  database.close();
}
