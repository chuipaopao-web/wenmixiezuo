export type LocalUtilityTask = 'intent_classification' | 'entity_candidates' | 'negation_detection' | 'compression_candidate';

export interface LocalUtilityRequest {
  task: LocalUtilityTask;
  text: string;
  allowedEntityNames?: string[];
}

export interface LocalUtilityCandidate {
  schemaVersion: 1;
  task: LocalUtilityTask;
  confidence: number;
  values: Record<string, unknown>;
  sourceTextHash: string;
  modelSnapshotId: string;
}

export interface LocalUtilityModel {
  readonly available: boolean;
  readonly modelSnapshotId: string;
  readonly degradationReason: string | null;
  infer(request: LocalUtilityRequest): Promise<LocalUtilityCandidate>;
}
