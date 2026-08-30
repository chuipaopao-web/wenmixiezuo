CREATE TABLE v7_book_title_design_calls (
  design_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  member_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('working', 'succeeded', 'failed')),
  prompt_hash TEXT NOT NULL CHECK (length(prompt_hash) = 64),
  provider TEXT,
  model_id TEXT,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cash_micros INTEGER CHECK (cash_micros IS NULL OR cash_micros >= 0),
  options_json TEXT NOT NULL DEFAULT '[]',
  failure_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;

CREATE INDEX v7_book_title_design_calls_book_idx
  ON v7_book_title_design_calls(owner_id, book_id, created_at DESC);
