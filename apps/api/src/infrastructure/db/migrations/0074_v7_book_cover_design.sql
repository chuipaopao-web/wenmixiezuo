CREATE TABLE v7_book_cover_designs (
  design_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  chief_member_key TEXT NOT NULL,
  visual_member_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('working', 'succeeded', 'failed')),
  work_order_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(work_order_json)),
  prompt_hash TEXT,
  provider TEXT,
  model_id TEXT,
  image_mime_type TEXT,
  image_content_hash TEXT CHECK (image_content_hash IS NULL OR length(image_content_hash) = 64),
  image_size_bytes INTEGER CHECK (image_size_bytes IS NULL OR image_size_bytes > 0),
  image_relative_path TEXT,
  adopted INTEGER NOT NULL DEFAULT 0 CHECK (adopted IN (0, 1)),
  failure_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  adopted_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, idempotency_key),
  UNIQUE (image_relative_path)
) STRICT;

CREATE INDEX v7_book_cover_designs_book_idx
  ON v7_book_cover_designs(owner_id, book_id, created_at DESC);

CREATE INDEX v7_book_cover_designs_adopted_idx
  ON v7_book_cover_designs(owner_id, book_id, adopted, updated_at DESC);

