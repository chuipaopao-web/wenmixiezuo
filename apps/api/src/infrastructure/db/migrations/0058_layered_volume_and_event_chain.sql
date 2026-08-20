-- DR-20260820-layered-creation-v1：卷方向、故事总线、事件链和作者选择正式拆分。
-- 旧 volume_plan_versions/event_sequences 只保留兼容读取；本迁移只增不删。

CREATE TABLE volume_direction_versions (
  volume_direction_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  legacy_volume_plan_version_id TEXT UNIQUE,
  version INTEGER NOT NULL CHECK (version > 0),
  proposal_id TEXT NOT NULL CHECK (length(trim(proposal_id)) > 0),
  candidate_kind TEXT NOT NULL CHECK (candidate_kind IN ('candidate_a','candidate_b','author_edit','fusion','legacy_projection')),
  status TEXT NOT NULL CHECK (status IN ('candidate','active','superseded','archived')),
  parent_version_id TEXT,
  source_task_id TEXT,
  source_version_ids_json TEXT NOT NULL CHECK (json_valid(source_version_ids_json)),
  author_input_refs_json TEXT NOT NULL CHECK (json_valid(author_input_refs_json)),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id,book_id,volume_plan_id) REFERENCES volume_plans(owner_id,book_id,volume_plan_id),
  FOREIGN KEY (legacy_volume_plan_version_id) REFERENCES volume_plan_versions(volume_plan_version_id),
  FOREIGN KEY (parent_version_id) REFERENCES volume_direction_versions(volume_direction_version_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id,book_id,volume_plan_id,version),
  UNIQUE(owner_id,book_id,volume_plan_id,proposal_id),
  UNIQUE(owner_id,book_id,idempotency_key)
) STRICT;
CREATE UNIQUE INDEX volume_direction_active_idx
  ON volume_direction_versions(owner_id,book_id,volume_plan_id) WHERE status='active';
CREATE INDEX volume_direction_history_idx
  ON volume_direction_versions(owner_id,book_id,volume_plan_id,version DESC);

CREATE TABLE book_story_spine_versions (
  book_story_spine_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  source_first_volume_direction_version_id TEXT NOT NULL,
  source_version_ids_json TEXT NOT NULL CHECK (json_valid(source_version_ids_json)),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  status TEXT NOT NULL CHECK (status IN ('candidate','active','superseded','archived')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (source_first_volume_direction_version_id)
    REFERENCES volume_direction_versions(volume_direction_version_id),
  UNIQUE(owner_id,book_id,version)
) STRICT;
CREATE UNIQUE INDEX book_story_spine_active_idx
  ON book_story_spine_versions(owner_id,book_id) WHERE status='active';

CREATE TABLE volume_route_selections (
  volume_route_selection_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  selection_mode TEXT NOT NULL CHECK (selection_mode IN ('whole','fragments')),
  selected_proposal_id TEXT,
  selected_version_id TEXT,
  fragments_json TEXT NOT NULL CHECK (json_valid(fragments_json)),
  author_notes TEXT,
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id,volume_plan_id) REFERENCES volume_plans(owner_id,book_id,volume_plan_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id,book_id,volume_plan_id,idempotency_key)
) STRICT;
CREATE INDEX volume_route_selection_history_idx
  ON volume_route_selections(owner_id,book_id,volume_plan_id,created_at DESC);

CREATE TABLE internal_structure_method_versions (
  internal_structure_method_version_id TEXT PRIMARY KEY,
  method_key TEXT NOT NULL,
  version TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('macro','character_arc','causal_principle','serial_rhythm','narration')),
  content_fingerprint TEXT NOT NULL CHECK (length(content_fingerprint)=64),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at TEXT NOT NULL,
  UNIQUE(method_key,version),
  UNIQUE(method_key,content_fingerprint)
) STRICT;

CREATE TABLE volume_route_method_audits (
  volume_route_method_audit_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  candidate_kind TEXT NOT NULL CHECK (candidate_kind IN ('candidate_a','candidate_b')),
  method_version_ids_json TEXT NOT NULL CHECK (json_valid(method_version_ids_json)),
  selection_reason TEXT NOT NULL CHECK (length(trim(selection_reason)) > 0),
  call_evidence_json TEXT NOT NULL CHECK (json_valid(call_evidence_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id,volume_plan_id) REFERENCES volume_plans(owner_id,book_id,volume_plan_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id,book_id,source_task_id,proposal_id)
) STRICT;

CREATE TABLE event_chain_versions (
  event_chain_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  volume_direction_version_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('candidate','active','superseded','archived')),
  parent_version_id TEXT,
  source_task_id TEXT,
  source_version_ids_json TEXT NOT NULL CHECK (json_valid(source_version_ids_json)),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id,book_id,volume_plan_id) REFERENCES volume_plans(owner_id,book_id,volume_plan_id),
  FOREIGN KEY (volume_direction_version_id) REFERENCES volume_direction_versions(volume_direction_version_id),
  FOREIGN KEY (parent_version_id) REFERENCES event_chain_versions(event_chain_version_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id,book_id,volume_plan_id,version),
  UNIQUE(owner_id,book_id,idempotency_key)
) STRICT;
CREATE UNIQUE INDEX event_chain_active_idx
  ON event_chain_versions(owner_id,book_id,volume_plan_id) WHERE status='active';
CREATE INDEX event_chain_history_idx
  ON event_chain_versions(owner_id,book_id,volume_plan_id,version DESC);
