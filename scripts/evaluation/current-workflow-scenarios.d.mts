import type { OpeningBlueprintInput } from '../../apps/api/src/contracts/opening-blueprint.js';

export interface WorkflowScenarioEvent extends Record<string, unknown> {
  readonly estimatedChapterRange: {
    readonly minimum: number;
    readonly likely: number;
    readonly maximum: number;
  };
}

export interface WorkflowScenario {
  readonly key: string;
  readonly displayName: string;
  readonly bookTitle: string;
  readonly volumeTitle: string;
  readonly events: readonly WorkflowScenarioEvent[];
  readonly expressionProfile: Readonly<Record<string, string>>;
  readonly requiredNames: readonly string[];
  readonly requiredTerms: readonly string[];
  readonly forbiddenTerms: readonly string[];
  openingBlueprint(taxonomyVersion: string): OpeningBlueprintInput;
  answerFor(item: Record<string, unknown>, attempt: number): string;
  volumeContent(firstVolume: boolean): Record<string, unknown>;
  volumeIdeaFor(volumeNumber: number): string;
  eventIdea(eventIndex: number): string;
}

export const workflowScenarios: Readonly<Record<string, WorkflowScenario>>;

export function requireWorkflowScenario(key: string): WorkflowScenario;
