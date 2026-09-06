export type BookStatus = "active" | "archived";
export type BookEngine = "rebuild";
export type BookListStatusFilter = BookStatus | "all";

export interface BookRecord {
  readonly bookId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly status: BookStatus;
  readonly version: number;
  readonly engine: BookEngine;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PublicBookRecord {
  readonly bookId: string;
  readonly title: string;
  readonly status: BookStatus;
  readonly version: number;
  readonly updatedAt: string;
}

export interface BookListInput {
  readonly status?: BookListStatusFilter | undefined;
  readonly q?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface NormalizedBookListInput {
  readonly status: BookListStatusFilter;
  readonly q: string | null;
  readonly limit: number;
  readonly cursor: BookListCursor | null;
}

export interface BookListCursor {
  readonly ownerId: string;
  readonly status: BookListStatusFilter;
  readonly q: string | null;
  readonly createdAt: string;
  readonly bookId: string;
}

export interface BookListResult {
  readonly books: readonly PublicBookRecord[];
  readonly nextCursor: string | null;
}

export interface ManualBookSourceRecord {
  readonly sourceId: string;
  readonly ownerId: string;
  readonly bookId: string;
  readonly sourceVersion: 1;
  readonly sourceType: "manual_opening_package";
  readonly openingIdea: string | null;
  readonly openingPackage: unknown;
  readonly inputHash: string;
  readonly createdAt: Date;
}

export interface ManualBookChapterDirectoryRecord {
  readonly directoryId: string;
  readonly ownerId: string;
  readonly bookId: string;
  readonly directoryVersion: 1;
  readonly entryCount: 0;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ManualBookReadRecord {
  readonly book: PublicBookRecord;
  readonly source: {
    readonly sourceVersion: 1;
    readonly sourceType: "manual_opening_package";
    readonly openingIdea: string | null;
    readonly openingPackage: unknown;
    readonly createdAt: string;
  };
  readonly chapterDirectory: {
    readonly directoryVersion: 1;
    readonly entryCount: 0;
    readonly updatedAt: string;
  };
}
