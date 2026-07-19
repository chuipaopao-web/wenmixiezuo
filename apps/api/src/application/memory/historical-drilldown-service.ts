export interface DrilldownRequest {
  trigger: 'entity_recurrence' | 'open_thread' | 'rule' | 'causal_history' | 'summary_conflict' | 'boss_review';
  currentLevel: 0 | 1 | 2 | 3;
  cycle: 0 | 1;
  candidatesSoFar: number;
  evidenceClosed: boolean;
}

export class HistoricalDrilldownService {
  public next(request: DrilldownRequest): { action: 'stop' | 'drill'; nextLevel: 1 | 2 | 3 | null; reason: string } {
    if (request.evidenceClosed) return { action: 'stop', nextLevel: null, reason: 'evidence_closed' };
    if (request.cycle >= 1 && request.currentLevel >= 3) return { action: 'stop', nextLevel: null, reason: 'bounded_supplement_exhausted' };
    if (request.candidatesSoFar >= 96) return { action: 'stop', nextLevel: null, reason: 'candidate_budget_exhausted' };
    if (request.currentLevel >= 3) return { action: 'stop', nextLevel: null, reason: 'original_evidence_level_reached' };
    return { action: 'drill', nextLevel: (request.currentLevel + 1) as 1 | 2 | 3, reason: request.trigger };
  }
}
