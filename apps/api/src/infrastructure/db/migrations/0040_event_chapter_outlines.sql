CREATE TABLE event_chapter_sequences (
  event_chapter_sequence_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_version_id TEXT NOT NULL,
  volume_plan_version_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','completed','stale','archived')),
  active_version_id TEXT,
  generation_task_id TEXT,
  create_idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (event_id) REFERENCES story_events(event_id),
  FOREIGN KEY (event_version_id) REFERENCES story_event_versions(story_event_version_id),
  FOREIGN KEY (volume_plan_version_id) REFERENCES volume_plan_versions(volume_plan_version_id),
  FOREIGN KEY (generation_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id,book_id,event_id),
  UNIQUE(owner_id,book_id,create_idempotency_key)
) STRICT;

CREATE TABLE event_chapter_sequence_versions (
  event_chapter_sequence_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  event_chapter_sequence_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  parent_version_id TEXT,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','active','superseded','stale','archived')),
  event_version_id TEXT NOT NULL,
  volume_plan_version_id TEXT NOT NULL,
  dependencies_json TEXT NOT NULL CHECK (json_valid(dependencies_json)),
  author_input_refs_json TEXT NOT NULL CHECK (json_valid(author_input_refs_json)),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  source_task_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (event_chapter_sequence_id) REFERENCES event_chapter_sequences(event_chapter_sequence_id),
  FOREIGN KEY (parent_version_id) REFERENCES event_chapter_sequence_versions(event_chapter_sequence_version_id),
  FOREIGN KEY (event_version_id) REFERENCES story_event_versions(story_event_version_id),
  FOREIGN KEY (volume_plan_version_id) REFERENCES volume_plan_versions(volume_plan_version_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(event_chapter_sequence_id,version),
  UNIQUE(owner_id,book_id,idempotency_key)
) STRICT;

CREATE INDEX event_chapter_sequence_versions_scope_idx
  ON event_chapter_sequence_versions(owner_id,book_id,event_chapter_sequence_id,status,version);

CREATE TABLE event_chapter_outlines (
  event_chapter_outline_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  event_chapter_sequence_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL CHECK (chapter_number > 0),
  sequence_order INTEGER NOT NULL CHECK (sequence_order > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','candidate','frozen','settled','stale','archived')),
  active_version_id TEXT,
  planned_content_json TEXT NOT NULL CHECK (json_valid(planned_content_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (event_chapter_sequence_id) REFERENCES event_chapter_sequences(event_chapter_sequence_id),
  FOREIGN KEY (event_id) REFERENCES story_events(event_id),
  UNIQUE(owner_id,book_id,chapter_number),
  UNIQUE(event_chapter_sequence_id,sequence_order)
) STRICT;

CREATE INDEX event_chapter_outlines_event_idx
  ON event_chapter_outlines(owner_id,book_id,event_id,sequence_order,status);

CREATE TABLE event_chapter_outline_versions (
  event_chapter_outline_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  event_chapter_outline_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  parent_version_id TEXT,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','frozen','superseded','stale','archived')),
  sequence_version_id TEXT NOT NULL,
  event_version_id TEXT NOT NULL,
  volume_plan_version_id TEXT NOT NULL,
  dependencies_json TEXT NOT NULL CHECK (json_valid(dependencies_json)),
  author_input_refs_json TEXT NOT NULL CHECK (json_valid(author_input_refs_json)),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  artifact_version_id TEXT,
  source_task_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  frozen_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (event_chapter_outline_id) REFERENCES event_chapter_outlines(event_chapter_outline_id),
  FOREIGN KEY (parent_version_id) REFERENCES event_chapter_outline_versions(event_chapter_outline_version_id),
  FOREIGN KEY (sequence_version_id) REFERENCES event_chapter_sequence_versions(event_chapter_sequence_version_id),
  FOREIGN KEY (event_version_id) REFERENCES story_event_versions(story_event_version_id),
  FOREIGN KEY (volume_plan_version_id) REFERENCES volume_plan_versions(volume_plan_version_id),
  FOREIGN KEY (artifact_version_id) REFERENCES artifact_versions(artifact_version_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(event_chapter_outline_id,version),
  UNIQUE(owner_id,book_id,idempotency_key)
) STRICT;

CREATE INDEX event_chapter_outline_versions_scope_idx
  ON event_chapter_outline_versions(owner_id,book_id,event_chapter_outline_id,status,version);
