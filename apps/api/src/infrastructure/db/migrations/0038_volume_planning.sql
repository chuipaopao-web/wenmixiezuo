-- DEC-108: volume planning is versioned independently from manuscript volume containers.

CREATE TABLE volume_plans (
  volume_plan_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  plan_number INTEGER NOT NULL CHECK (plan_number > 0),
  physical_volume_id TEXT,
  previous_volume_plan_id TEXT,
  previous_settlement_id TEXT,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'completed', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  active_version_id TEXT,
  create_idempotency_key TEXT NOT NULL CHECK (length(trim(create_idempotency_key)) > 0),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (physical_volume_id) REFERENCES volumes(volume_id),
  FOREIGN KEY (previous_volume_plan_id) REFERENCES volume_plans(volume_plan_id),
  FOREIGN KEY (previous_settlement_id) REFERENCES stage_settlements(stage_settlement_id),
  UNIQUE(owner_id, book_id, volume_plan_id),
  UNIQUE(owner_id, book_id, plan_number),
  UNIQUE(owner_id, book_id, create_idempotency_key)
) STRICT;

CREATE INDEX volume_plans_status_idx
  ON volume_plans(owner_id, book_id, status, plan_number);

CREATE TABLE volume_plan_versions (
  volume_plan_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  parent_version_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'superseded', 'archived')),
  candidate_kind TEXT NOT NULL
    CHECK (candidate_kind IN ('candidate_a', 'candidate_b', 'author_edit', 'fusion', 'legacy')),
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
  FOREIGN KEY (owner_id, book_id, volume_plan_id)
    REFERENCES volume_plans(owner_id, book_id, volume_plan_id),
  FOREIGN KEY (parent_version_id) REFERENCES volume_plan_versions(volume_plan_version_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id, book_id, volume_plan_id, version),
  UNIQUE(owner_id, book_id, idempotency_key)
) STRICT;

CREATE UNIQUE INDEX volume_plan_versions_active_idx
  ON volume_plan_versions(owner_id, book_id, volume_plan_id)
  WHERE status = 'active';

CREATE INDEX volume_plan_versions_history_idx
  ON volume_plan_versions(owner_id, book_id, volume_plan_id, version DESC);

CREATE TABLE planning_dependencies (
  planning_dependency_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  upstream_kind TEXT NOT NULL CHECK (length(trim(upstream_kind)) > 0),
  upstream_id TEXT NOT NULL CHECK (length(trim(upstream_id)) > 0),
  upstream_version INTEGER NOT NULL CHECK (upstream_version >= 0),
  upstream_hash TEXT NOT NULL CHECK (length(upstream_hash) = 64),
  downstream_kind TEXT NOT NULL CHECK (length(trim(downstream_kind)) > 0),
  downstream_id TEXT NOT NULL CHECK (length(trim(downstream_id)) > 0),
  downstream_version INTEGER NOT NULL CHECK (downstream_version > 0),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'invalidated')),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(
    owner_id, book_id, upstream_kind, upstream_id, upstream_version,
    downstream_kind, downstream_id, downstream_version
  )
) STRICT;

CREATE INDEX planning_dependencies_downstream_idx
  ON planning_dependencies(owner_id, book_id, downstream_kind, downstream_id, downstream_version, status);

CREATE INDEX planning_dependencies_upstream_idx
  ON planning_dependencies(owner_id, book_id, upstream_kind, upstream_id, upstream_version, status);

CREATE TABLE creation_workflow_states (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  planning_version INTEGER NOT NULL DEFAULT 1 CHECK (planning_version > 0),
  stage TEXT NOT NULL CHECK (stage IN (
    'book_profile_draft', 'book_profile_confirmed', 'setting_in_progress', 'setting_confirmed',
    'volume_plan_in_progress', 'volume_plan_confirmed', 'event_sequence_in_progress',
    'event_in_progress', 'event_confirmed', 'chapter_outlines_in_progress', 'next_chapters_ready',
    'manuscript_in_progress', 'waiting_for_author', 'chapter_settlement_in_progress',
    'event_settlement_in_progress', 'volume_settlement_in_progress', 'ready_for_next_volume'
  )),
  active_volume_plan_id TEXT,
  active_volume_plan_version_id TEXT,
  active_event_id TEXT,
  active_event_version_id TEXT,
  frozen_chapter_outline_refs_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(frozen_chapter_outline_refs_json)),
  waiting_task_id TEXT,
  blocking_reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (active_volume_plan_id) REFERENCES volume_plans(volume_plan_id),
  FOREIGN KEY (active_volume_plan_version_id) REFERENCES volume_plan_versions(volume_plan_version_id),
  FOREIGN KEY (waiting_task_id) REFERENCES tasks(task_id)
) STRICT;

INSERT INTO creation_workflow_states (
  owner_id, book_id, planning_version, stage, frozen_chapter_outline_refs_json, updated_at
)
SELECT
  b.owner_id,
  b.book_id,
  1,
  CASE
    WHEN s.setting_baseline_version_id IS NOT NULL THEN 'setting_confirmed'
    WHEN EXISTS (
      SELECT 1 FROM book_opening_blueprints o
      WHERE o.owner_id = b.owner_id AND o.book_id = b.book_id AND o.status = 'active'
    ) THEN 'setting_in_progress'
    ELSE 'book_profile_draft'
  END,
  '[]',
  b.updated_at
FROM books b
LEFT JOIN book_planning_states s ON s.owner_id = b.owner_id AND s.book_id = b.book_id;
