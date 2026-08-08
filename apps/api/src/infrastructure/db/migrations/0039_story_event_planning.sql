-- DEC-107 P8: story events are versioned planning objects under one confirmed volume plan.

CREATE TABLE event_sequences (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  volume_plan_version_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id, volume_plan_id),
  FOREIGN KEY (owner_id, book_id, volume_plan_id)
    REFERENCES volume_plans(owner_id, book_id, volume_plan_id),
  FOREIGN KEY (volume_plan_version_id) REFERENCES volume_plan_versions(volume_plan_version_id)
) STRICT;

CREATE TABLE story_events (
  event_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  sequence_order INTEGER NOT NULL CHECK (sequence_order > 0),
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'settled', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  active_version_id TEXT,
  previous_event_id TEXT,
  previous_settlement_id TEXT,
  create_idempotency_key TEXT NOT NULL CHECK (length(trim(create_idempotency_key)) > 0),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id, volume_plan_id)
    REFERENCES volume_plans(owner_id, book_id, volume_plan_id),
  FOREIGN KEY (previous_event_id) REFERENCES story_events(event_id),
  FOREIGN KEY (previous_settlement_id) REFERENCES stage_settlements(stage_settlement_id),
  UNIQUE(owner_id, book_id, event_id),
  UNIQUE(owner_id, book_id, volume_plan_id, create_idempotency_key)
) STRICT;

CREATE INDEX story_events_sequence_idx
  ON story_events(owner_id, book_id, volume_plan_id, sequence_order, event_id);
CREATE INDEX story_events_status_idx
  ON story_events(owner_id, book_id, volume_plan_id, status);

CREATE TABLE story_event_versions (
  story_event_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  parent_version_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'superseded', 'archived')),
  candidate_kind TEXT NOT NULL
    CHECK (candidate_kind IN ('candidate_a', 'candidate_b', 'author_edit', 'fusion', 'volume_seed')),
  volume_plan_version_id TEXT NOT NULL,
  previous_settlement_id TEXT,
  dependencies_json TEXT NOT NULL CHECK (json_valid(dependencies_json)),
  template_json TEXT NOT NULL CHECK (json_valid(template_json)),
  author_input_refs_json TEXT NOT NULL CHECK (json_valid(author_input_refs_json)),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  source_task_id TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id, book_id, event_id)
    REFERENCES story_events(owner_id, book_id, event_id),
  FOREIGN KEY (parent_version_id) REFERENCES story_event_versions(story_event_version_id),
  FOREIGN KEY (volume_plan_version_id) REFERENCES volume_plan_versions(volume_plan_version_id),
  FOREIGN KEY (previous_settlement_id) REFERENCES stage_settlements(stage_settlement_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id, book_id, event_id, version),
  UNIQUE(owner_id, book_id, idempotency_key)
) STRICT;

CREATE UNIQUE INDEX story_event_versions_active_idx
  ON story_event_versions(owner_id, book_id, event_id)
  WHERE status = 'active';
CREATE INDEX story_event_versions_history_idx
  ON story_event_versions(owner_id, book_id, event_id, version DESC);

CREATE TABLE event_sequence_operations (
  event_sequence_operation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('insert', 'reorder', 'split', 'merge')),
  expected_sequence_revision INTEGER NOT NULL CHECK (expected_sequence_revision > 0),
  result_sequence_revision INTEGER,
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  impact_json TEXT NOT NULL CHECK (json_valid(impact_json)),
  status TEXT NOT NULL CHECK (status IN ('previewed', 'applied', 'cancelled')),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (owner_id, book_id, volume_plan_id)
    REFERENCES event_sequences(owner_id, book_id, volume_plan_id),
  UNIQUE(owner_id, book_id, idempotency_key)
) STRICT;

CREATE INDEX event_sequence_operations_history_idx
  ON event_sequence_operations(owner_id, book_id, volume_plan_id, created_at DESC);