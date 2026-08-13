function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

export function latestCompleteReleaseReview(detail, manuscriptVersionId) {
  const panels = (detail.production?.reviewPanels ?? [])
    .filter((panel) => panel.manuscript_version_id === manuscriptVersionId && panel.status === 'complete')
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')));
  const latest = panels.at(-1);
  if (!latest) return null;
  return {
    panel: latest,
    reports: (detail.production?.reviewReports ?? [])
      .filter((report) => report.review_panel_id === latest.review_panel_id)
  };
}

export function assertReleaseReviewIsAcceptable(detail, manuscriptVersionId, chapterNumber, releaseMode = true) {
  if (!releaseMode) return;
  const latest = latestCompleteReleaseReview(detail, manuscriptVersionId);
  ensure(latest, `chapter ${chapterNumber} has no complete review panel for the pending manuscript`);
  const reports = latest.reports.map((report) => JSON.parse(report.report_json));
  ensure(reports.length === 3, `chapter ${chapterNumber} latest panel has ${reports.length} reports instead of three`);
  const hardIssues = reports.flatMap((report) => Array.isArray(report.issues)
    ? report.issues.filter((issue) => issue.severity === 'major' || issue.severity === 'blocker')
    : []);
  const unacceptableVerdicts = reports.filter((report) => report.verdict === 'rewrite' || report.verdict === 'blocked');
  ensure(hardIssues.length === 0 && unacceptableVerdicts.length === 0,
    `chapter ${chapterNumber} is not release-ready: ${hardIssues.length} major/blocker issues and ${unacceptableVerdicts.length} rewrite/blocked reports`);
}
