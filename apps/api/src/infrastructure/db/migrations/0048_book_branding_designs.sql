CREATE TABLE book_branding_designs (
  design_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('title', 'synopsis')),
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'working'
    CHECK (status IN ('working', 'succeeded', 'failed', 'cancelled')),
  options_json TEXT NOT NULL DEFAULT '[]',
  source_fingerprint TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX book_branding_designs_book_idx
  ON book_branding_designs(owner_id, book_id, kind, created_at);
