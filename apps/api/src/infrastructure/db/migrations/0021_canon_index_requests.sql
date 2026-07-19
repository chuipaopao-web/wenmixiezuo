CREATE TABLE canon_index_requests (
  canon_index_request_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  canon_revision INTEGER NOT NULL CHECK (canon_revision > 0),
  source_chapter_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'superseded')),
  worker_id TEXT,
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL,
  chunk_snapshot_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (source_chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (chunk_snapshot_id) REFERENCES chunk_snapshots(chunk_snapshot_id),
  UNIQUE(owner_id, book_id, canon_revision)
) STRICT;

CREATE INDEX canon_index_requests_queue_idx ON canon_index_requests(status, available_at, created_at);
CREATE INDEX canon_index_requests_claim_idx ON canon_index_requests(status, claimed_at);
