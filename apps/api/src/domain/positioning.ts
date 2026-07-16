export type SourceStatus = 'explicit' | 'inferred' | 'unspecified' | 'conflict';

export interface PositioningField {
  key: string;
  label: string;
  value: string | string[] | null;
  sourceStatus: SourceStatus;
  evidence: string | null;
}

export interface PositioningTag {
  name: string;
  category: 'genre' | 'theme' | 'plot' | 'relationship' | 'tone' | 'style' | 'dynamic';
  sourceStatus: SourceStatus;
}

export interface PositioningDraft {
  draftId: string;
  proposedBookId: string;
  title: string;
  inputText: string;
  fields: PositioningField[];
  tags: PositioningTag[];
  status: 'editing' | 'confirmed' | 'abandoned';
  version: number;
  confirmedBookId: string | null;
}

