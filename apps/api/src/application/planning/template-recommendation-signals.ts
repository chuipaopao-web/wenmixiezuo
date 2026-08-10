import type { VolumePlanContent } from '@wenmi/contracts';

export interface TemplateRecommendationBookProfile {
  category: string;
  subjects: readonly string[];
  mainTags: readonly string[];
  customTags: readonly string[];
}

export interface PlanningTemplateSignalInput {
  profile: TemplateRecommendationBookProfile | null;
  activeVolume: VolumePlanContent | null;
  latestVolumeSettlement: unknown;
}

/**
 * Only combines information already scoped to the current book. The public
 * template registry uses these strings for ranking; they never become hard
 * generation constraints and never mutate a confirmed template snapshot.
 */
export function buildPlanningTemplateSignals(input: PlanningTemplateSignalInput): string[] {
  const signals: string[] = [];
  if (input.profile !== null) {
    appendText(signals, input.profile.category);
    appendValues(signals, input.profile.subjects);
    appendValues(signals, input.profile.mainTags);
    appendValues(signals, input.profile.customTags);
  }
  if (input.activeVolume !== null) {
    appendValues(signals, [
      input.activeVolume.title,
      input.activeVolume.openingState,
      input.activeVolume.coreGoal,
      input.activeVolume.coreConflict,
      input.activeVolume.failureCost,
      input.activeVolume.endingState,
      input.activeVolume.nextVolumeTrigger,
      input.activeVolume.characterChanges,
      input.activeVolume.openThreads,
      input.activeVolume.boundaries
    ]);
  }
  appendSettlement(signals, input.latestVolumeSettlement, 0);
  return [...new Set(signals)].slice(0, 80);
}

function appendSettlement(target: string[], value: unknown, depth: number): void {
  if (depth > 4 || target.length >= 80 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    appendText(target, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 24)) appendSettlement(target, item, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:id|.*Id|.*Hash|createdAt|updatedAt|exclusions)$/u.test(key)) continue;
    appendSettlement(target, item, depth + 1);
  }
}

function appendValues(target: string[], values: readonly unknown[]): void {
  for (const value of values) appendSettlement(target, value, 0);
}

function appendText(target: string[], value: string): void {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length > 0) target.push(normalized.slice(0, 500));
}
