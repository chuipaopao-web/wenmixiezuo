-- DEC-077: import an existing manuscript as an auditable, resumable prehistory.

CREATE TABLE continuation_imports (
  continuation_import_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_relative_path TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  parser_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('parsed', 'importing', 'ready', 'failed', 'cancelled')),
  source_character_count INTEGER NOT NULL CHECK (source_character_count >= 1),
  included_chapter_count INTEGER NOT NULL DEFAULT 0 CHECK (included_chapter_count >= 0),
  imported_chapter_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_chapter_count >= 0),
  last_completed_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (last_completed_ordinal >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings_json)),
  active_task_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (active_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id, book_id, source_hash)
) STRICT;

CREATE INDEX continuation_imports_scope_idx
  ON continuation_imports(owner_id, book_id, status, updated_at);

CREATE TABLE continuation_import_chapters (
  continuation_import_chapter_id TEXT PRIMARY KEY,
  continuation_import_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  detected_title TEXT NOT NULL,
  edited_title TEXT NOT NULL,
  content_start INTEGER NOT NULL CHECK (content_start >= 0),
  content_end INTEGER NOT NULL CHECK (content_end >= content_start),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  character_count INTEGER NOT NULL CHECK (character_count >= 0),
  included INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'excluded', 'chapter_created', 'manuscript_registered', 'imported')),
  target_chapter_number INTEGER CHECK (target_chapter_number IS NULL OR target_chapter_number >= 1),
  target_chapter_id TEXT,
  target_manuscript_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (continuation_import_id) REFERENCES continuation_imports(continuation_import_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (target_chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (target_manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  UNIQUE(owner_id, book_id, continuation_import_id, ordinal)
) STRICT;

CREATE INDEX continuation_import_chapters_scope_idx
  ON continuation_import_chapters(owner_id, book_id, continuation_import_id, ordinal);
