import { describe, expect, it } from 'vitest';

import { discussionOutputTokenLimit } from '../../apps/api/src/application/discussions/discussion-pipeline-service.js';

describe('discussion panel output budgets', () => {
  it('reserves enough output space for complete author-visible concept candidates', () => {
    expect(discussionOutputTokenLimit(
      'lead_screenwriter',
      false,
      'independent',
      'opening reception',
      'creative_concept_panel'
    )).toBeGreaterThanOrEqual(3_000);
  });

  it('reserves enough output space for each independently selected setting screenwriter', () => {
    expect(discussionOutputTokenLimit(
      'lead_screenwriter',
      false,
      'independent',
      'setting item',
      'setting_proposal_panel'
    )).toBeGreaterThanOrEqual(3_000);
  });
});