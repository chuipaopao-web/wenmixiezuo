export type BookStatus = 'draft' | 'active' | 'paused' | 'archived' | 'restoring' | 'purging' | 'purged';

export interface BookRecord {
  bookId: string;
  ownerId: string;
  title: string;
  status: BookStatus;
  version: number;
  positioningVersion: number;
  canonRevision: number;
  editorEpoch: number;
  createdAt: string;
  updatedAt: string;
}

