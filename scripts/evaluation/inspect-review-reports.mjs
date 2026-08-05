import { DatabaseSync } from 'node:sqlite';

const [bookId, manuscriptVersionId] = process.argv.slice(2);
if (!bookId || !manuscriptVersionId) throw new Error('usage: inspect-review-reports.mjs <bookId> <manuscriptVersionId>');

const database = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
try {
  const rows = database.prepare(`
    SELECT p.review_panel_id, p.status, p.review_round, r.reviewer_role, r.report_json
    FROM review_panels p
    JOIN review_reports r ON r.review_panel_id = p.review_panel_id
    WHERE p.owner_id = ? AND p.book_id = ? AND p.manuscript_version_id = ?
    ORDER BY p.review_round, r.reviewer_role
  `).all('owner-local-boss', bookId, manuscriptVersionId);
  const compact = rows.map((row) => {
    const report = JSON.parse(row.report_json);
    return {
      reviewPanelId: row.review_panel_id,
      panelStatus: row.status,
      reviewRound: row.review_round,
      reviewerRole: row.reviewer_role,
      verdict: report.verdict,
      summary: report.summary,
      issues: Array.isArray(report.issues) ? report.issues.map((issue) => ({
        location: issue.location,
        issueType: issue.issueType,
        severity: issue.severity,
        evidence: issue.evidence,
        requiredAction: issue.requiredAction
      })) : report.issues,
      scores: report.scores,
      politicalRisk: report.politicalRisk,
      sexualContentRisk: report.sexualContentRisk,
      aiStyle: report.aiStyle,
      factCandidateCount: Array.isArray(report.factCandidates) ? report.factCandidates.length : null
    };
  });
  const syntheses = database.prepare(`
    SELECT review_panel_id, synthesis_json
    FROM editor_review_syntheses
    WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ?
    ORDER BY created_at
  `).all('owner-local-boss', bookId, manuscriptVersionId).map((row) => ({
    reviewPanelId: row.review_panel_id,
    ...JSON.parse(row.synthesis_json)
  }));
  const factCallOutputs = database.prepare(`
    SELECT c.phase_key, c.state, c.error_class, r.output_text
    FROM model_calls c
    LEFT JOIN model_call_results r ON r.request_id = c.request_id
    WHERE c.owner_id = ? AND c.book_id = ?
      AND c.phase_key LIKE '%fact%'
    ORDER BY c.created_at DESC
    LIMIT 4
  `).all('owner-local-boss', bookId).map((row) => ({
    phaseKey: row.phase_key,
    state: row.state,
    errorClass: row.error_class,
    outputLength: row.output_text?.length ?? 0,
    outputText: row.output_text?.slice(0, 20_000) ?? null
  }));
  process.stdout.write(`${JSON.stringify({ reports: compact, syntheses, factCallOutputs }, null, 2)}\n`);
} finally {
  database.close();
}
