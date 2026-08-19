CREATE TABLE chapter_challenger_reviews (
  review_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'working'
    CHECK (status IN ('working', 'succeeded', 'failed', 'cancelled')),
  report_json TEXT,
  report_hash TEXT,
  agent_id TEXT,
  model_snapshot_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX chapter_challenger_reviews_chapter_idx
  ON chapter_challenger_reviews(owner_id, book_id, chapter_id, created_at);
