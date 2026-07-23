import type { OpeningChannel, ProtagonistRole } from './opening-blueprint.js';

export interface OpeningSynopsisAnalysisInput {
  synopsis: string;
}

export interface OpeningSynopsisProtagonistSuggestion {
  role: ProtagonistRole;
  name: string;
  age: string | null;
  background: string | null;
  personalities: string[];
}

export interface OpeningSynopsisSuggestions {
  title: string | null;
  channel: OpeningChannel | null;
  categoryKey: string | null;
  protagonist: OpeningSynopsisProtagonistSuggestion | null;
  worldBackground: string | null;
  openingBackground: string | null;
  stageOne: {
    start: string | null;
    development: string | null;
    end: string | null;
  };
  fullBookOutline: string;
  initialMap: string | null;
  mainTags: string[];
  auxiliaryTags: string[];
  storyTraits: string[];
  mustFollow: string[];
}

export interface OpeningSynopsisAnalysisResult {
  schemaVersion: 'opening-synopsis-suggestions-v1';
  analysisMode: 'local-deterministic';
  taxonomyVersion: string;
  synopsisLength: number;
  suggestions: OpeningSynopsisSuggestions;
  recognizedFields: string[];
  unresolvedFields: string[];
  evidence: Array<{ field: string; excerpt: string }>;
}
