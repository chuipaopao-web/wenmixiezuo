import { describe, expect, it } from 'vitest';
// The release validator is an executable ESM script helper rather than product TypeScript.
// @ts-expect-error no declaration file is required for this test-only helper
import { assertReleaseReviewIsAcceptable, latestCompleteReleaseReview } from '../../scripts/evaluation/lib/release-review-gate.mjs';

function detail({ verdicts = ['pass', 'pass', 'pass'], severities = ['minor', 'observation', 'minor'], version = 'mv-1' } = {}) {
  return {
    production: {
      reviewPanels: [
        { review_panel_id: 'panel-old', manuscript_version_id: version, status: 'complete', created_at: '2026-08-13T00:00:00Z' },
        { review_panel_id: 'panel-new', manuscript_version_id: version, status: 'complete', created_at: '2026-08-13T01:00:00Z' }
      ],
      reviewReports: verdicts.map((verdict, index) => ({
        review_panel_id: 'panel-new',
        report_json: JSON.stringify({ verdict, issues: [{ severity: severities[index] }] })
      })).concat([{ review_panel_id: 'panel-old', report_json: JSON.stringify({ verdict: 'rewrite', issues: [{ severity: 'major' }] }) }])
    }
  };
}

describe('发布级三席放行门禁', () => {
  it('最新完整三席只有轻微观察且全部通过时允许进入作者确认', () => {
    expect(() => assertReleaseReviewIsAcceptable(detail(), 'mv-1', 2)).not.toThrow();
    const latest = latestCompleteReleaseReview(detail(), 'mv-1');
    expect(latest?.panel.review_panel_id).toBe('panel-new');
    expect(latest?.reports).toHaveLength(3);
  });

  it('任一重大问题都会停止自动放行', () => {
    expect(() => assertReleaseReviewIsAcceptable(detail({ severities: ['minor', 'major', 'minor'] }), 'mv-1', 2))
      .toThrow('1 major/blocker issues');
  });

  it('即使问题被错误标轻，rewrite结论仍会停止自动放行', () => {
    expect(() => assertReleaseReviewIsAcceptable(detail({ verdicts: ['pass', 'rewrite', 'pass'] }), 'mv-1', 2))
      .toThrow('1 rewrite/blocked reports');
  });

  it('非发布级E2流程不启用发布放行判断', () => {
    expect(() => assertReleaseReviewIsAcceptable({ production: {} }, 'mv-missing', 2, false)).not.toThrow();
  });
});
