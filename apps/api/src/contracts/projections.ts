export type ProjectionType = 'fts' | 'vector' | 'wiki' | 'relation' | 'summary';
export type SnapshotStatus = 'building' | 'validated' | 'ready' | 'failed' | 'stale' | 'superseded';

export interface ChunkPolicy {
  version: string;
  targetLeafCharacters: number;
  maximumLeafCharacters: number;
  maximumParentCharacters: number;
  normalizationVersion: string;
  embeddingTextPolicyVersion: string;
}

export interface StructuralChunk {
  ordinal: number;
  characterStart: number;
  characterEnd: number;
  byteStart: number;
  byteEnd: number;
  paragraphStart: number;
  paragraphEnd: number;
  content: string;
  parentOrdinal: number;
  previousOrdinal: number | null;
  nextOrdinal: number | null;
  narrativeMode: 'current' | 'dialogue_claim' | 'memory' | 'dream' | 'plan' | 'counterfactual' | 'unknown';
  boundaryConfidence: number;
}

export interface StructuralParentNode {
  ordinal: number;
  byteStart: number;
  byteEnd: number;
  childOrdinals: number[];
}

export interface StructuralChunkResult {
  policy: ChunkPolicy;
  sourceBytes: number;
  chunks: StructuralChunk[];
  parents: StructuralParentNode[];
  excludedSeparatorRanges: Array<{ byteStart: number; byteEnd: number }>;
}

export interface ProjectionWatermark {
  projectionType: ProjectionType;
  activeSnapshotId: string | null;
  previousSnapshotId: string | null;
  canonRevision: number;
  status: 'pending' | 'building' | 'ready' | 'failed' | 'stale' | 'degraded';
}
