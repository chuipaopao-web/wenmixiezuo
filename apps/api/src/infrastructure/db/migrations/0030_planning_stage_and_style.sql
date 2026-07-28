CREATE TABLE book_style_versions (
  style_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('opening', 'owner', 'editor')),
  source_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'selected', 'superseded')),
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, book_id, version),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX idx_book_style_selected
  ON book_style_versions (owner_id, book_id)
  WHERE status = 'selected';

CREATE TABLE book_planning_states (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  stage TEXT NOT NULL CHECK (stage IN (
    'style_in_progress', 'style_ready', 'setting_in_progress', 'setting_ready',
    'master_outline_in_progress', 'master_outline_ready',
    'volume_outline_in_progress', 'volume_outline_ready',
    'chapter_outline_ready', 'writing_enabled'
  )),
  active_style_version_id TEXT,
  setting_baseline_version_id TEXT,
  master_outline_version_id TEXT,
  volume_outline_version_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id) ON DELETE CASCADE,
  FOREIGN KEY (active_style_version_id) REFERENCES book_style_versions(style_version_id)
) STRICT;

INSERT INTO book_planning_states (owner_id, book_id, version, stage, updated_at)
SELECT owner_id, book_id, 1, 'style_in_progress', updated_at
FROM books
WHERE NOT EXISTS (
  SELECT 1 FROM book_planning_states s
  WHERE s.owner_id = books.owner_id AND s.book_id = books.book_id
);

CREATE INDEX idx_book_planning_stage
  ON book_planning_states (owner_id, stage, updated_at);
