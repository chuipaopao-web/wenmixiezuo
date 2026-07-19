import { describe, expect, it } from 'vitest';
import { HistoricalDrilldownService } from '../../../apps/api/src/application/memory/historical-drilldown-service.js';

describe('阶段摘要触发的有界正史下钻', () => {
  it('最多下钻到原文证据级，且只允许一次补充周期', () => {
    const service = new HistoricalDrilldownService();
    expect(service.next({ trigger: 'entity_recurrence', currentLevel: 0, cycle: 0, candidatesSoFar: 8, evidenceClosed: false })).toEqual({ action: 'drill', nextLevel: 1, reason: 'entity_recurrence' });
    expect(service.next({ trigger: 'open_thread', currentLevel: 2, cycle: 0, candidatesSoFar: 20, evidenceClosed: false })).toEqual({ action: 'drill', nextLevel: 3, reason: 'open_thread' });
    expect(service.next({ trigger: 'rule', currentLevel: 3, cycle: 1, candidatesSoFar: 30, evidenceClosed: false })).toMatchObject({ action: 'stop', reason: 'bounded_supplement_exhausted' });
    expect(service.next({ trigger: 'rule', currentLevel: 1, cycle: 0, candidatesSoFar: 96, evidenceClosed: false })).toMatchObject({ action: 'stop', reason: 'candidate_budget_exhausted' });
  });
});
