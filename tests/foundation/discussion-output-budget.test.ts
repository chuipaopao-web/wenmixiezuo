import { describe, expect, it } from 'vitest';

import {
  discussionContextTokenBudget,
  discussionOutputTokenLimit
} from '../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { compactProposalForSynthesis } from '../../apps/api/src/application/knowledge/setting-collaboration-command-service.js';

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

  it('reserves enough output space for complete setting candidates', () => {
    expect(discussionOutputTokenLimit(
      'chief_editor',
      true,
      'independent',
      'setting item',
      'setting_proposal_panel'
    )).toBeGreaterThanOrEqual(3_000);
  });

  it('reserves reasoning headroom for a complete setting synthesis', () => {
    expect(discussionOutputTokenLimit(
      'chief_editor',
      true,
      'independent',
      '【设定成组讨论资料包】\n本批设定项JSON：[{itemKey:must-follow}]',
      'setting_synthesis'
    )).toBe(8_000);
  });

  it('keeps a bounded setting pack large enough for full opening data and selected proposal cores', () => {
    expect(discussionContextTokenBudget(true, '【设定成组讨论资料包】')).toBe(16_000);
    expect(discussionContextTokenBudget(true, '普通讨论')).toBe(7_200);
    expect(discussionContextTokenBudget(false, '【设定成组讨论资料包】')).toBe(8_000);
  });

  it('keeps proposal rules while excluding repeated rationale and alternatives from synthesis input', () => {
    const compact = compactProposalForSynthesis([
      '力量先消耗灵石，再承受经脉反噬。失败会损坏阵眼并伤及主持者。',
      '为什么这样安排：这段是很长的解释。'.repeat(100),
      '还可以这样写：另一套未选方案。'.repeat(100)
    ].join('\n'));
    expect(compact).toContain('力量先消耗灵石');
    expect(compact).not.toContain('很长的解释');
    expect(compact).not.toContain('另一套未选方案');
  });
});
