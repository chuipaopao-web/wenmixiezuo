import { DatabaseSync } from 'node:sqlite';
import { parseProductionReview } from '../../apps/api/src/contracts/production-review.js';

const [bookId, manuscriptVersionId] = process.argv.slice(2);
if (!bookId || !manuscriptVersionId) throw new Error('usage: debug-parse-review.ts <bookId> <manuscriptVersionId>');

const database = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
try {
  const rows = database.prepare(`
    SELECT c.phase_key, r.output_text
    FROM model_calls c
    JOIN model_call_results r ON r.request_id = c.request_id
    WHERE c.owner_id = ? AND c.book_id = ?
      AND c.phase_key LIKE '%fact%'
    ORDER BY c.created_at DESC
    LIMIT 20
  `).all('owner-local-boss', bookId) as unknown as Array<{ phase_key: string; output_text: string }>;
  const panel = database.prepare(`SELECT review_panel_id FROM review_panels
    WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get('owner-local-boss', bookId, manuscriptVersionId) as { review_panel_id: string } | undefined;
  const row = panel ? rows.find((candidate) => candidate.phase_key.includes(`review-repair-1-fact-${panel.review_panel_id}`)) : undefined;
  if (!row) throw new Error(`repaired fact review output not found; phases=${rows.map((item) => item.phase_key).join(',')}`);
  const raw = JSON.parse(row.output_text) as { modelSnapshotId: string };
  try {
    const parsed = parseProductionReview(row.output_text, {
      reviewerRole: 'fact',
      manuscriptVersionId,
      modelSnapshotId: raw.modelSnapshotId
    }, {
      allowDroppingInvalidFactCandidates: true,
      normalizeLocalBlockers: true,
      normalizeAiStyleEvidence: true,
      normalizeRepairedVerdict: true,
      normalizeMalformedJsonStrings: true,
      normalizeRiskArrays: true,
      normalizeScoreArray: true,
      normalizeIssueLocations: true,
      normalizeRepairedSeverity: true,
      normalizeIssueFieldAliases: true
    });
    process.stdout.write(`${JSON.stringify({ ok: true, verdict: parsed.verdict, facts: parsed.factCandidates?.length }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      expectedManuscriptVersionId: manuscriptVersionId,
      actualManuscriptVersionId: (JSON.parse(row.output_text) as { manuscriptVersionId?: string }).manuscriptVersionId,
      expectedModelSnapshotId: raw.modelSnapshotId
    }, null, 2)}\n`);
  }
} finally {
  database.close();
}
