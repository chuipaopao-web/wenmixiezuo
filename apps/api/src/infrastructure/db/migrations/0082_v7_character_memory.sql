-- V7人物管理只新增档案、任务资料包与语义维护审计。
-- 正文实际仍由entities/fact_assertions/canon_revisions及其投影负责。

CREATE TABLE v7_character_profiles (
  profile_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_protagonist_profile_id TEXT,
  display_name TEXT NOT NULL,
  narrative_tier TEXT NOT NULL CHECK (narrative_tier IN ('core','important','supporting','cameo','unknown')),
  status TEXT NOT NULL CHECK (status IN ('active','archived')),
  active_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (entity_id) REFERENCES entities(entity_id),
  FOREIGN KEY (source_protagonist_profile_id) REFERENCES protagonist_profiles(protagonist_profile_id),
  UNIQUE (owner_id, book_id, entity_id)
) STRICT;

CREATE INDEX v7_character_profiles_scope_idx
  ON v7_character_profiles(owner_id, book_id, status, narrative_tier, updated_at DESC);

CREATE TABLE v7_character_profile_versions (
  profile_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('candidate','active','superseded','archived')),
  authority_layer TEXT NOT NULL CHECK (authority_layer IN ('candidate','confirmed_reference','canon_derived')),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('opening','setting','owner','canon','import','agent')),
  source_id TEXT,
  source_canon_revision INTEGER NOT NULL DEFAULT 0 CHECK (source_canon_revision >= 0),
  based_on_version_id TEXT,
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('owner','agent','system')),
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (profile_id) REFERENCES v7_character_profiles(profile_id),
  FOREIGN KEY (based_on_version_id) REFERENCES v7_character_profile_versions(profile_version_id),
  UNIQUE (owner_id, book_id, profile_id, revision)
) STRICT;

CREATE UNIQUE INDEX v7_character_profile_versions_one_active_idx
  ON v7_character_profile_versions(owner_id, book_id, profile_id) WHERE lifecycle='active';
CREATE INDEX v7_character_profile_versions_history_idx
  ON v7_character_profile_versions(owner_id, book_id, profile_id, revision DESC);

CREATE TABLE v7_character_profile_actions (
  action_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_version_id TEXT,
  action_kind TEXT NOT NULL CHECK (action_kind IN ('create','revise','activate','rollback','archive','restore','candidate_decision')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner','agent','system')),
  actor_id TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (profile_id) REFERENCES v7_character_profiles(profile_id),
  FOREIGN KEY (profile_version_id) REFERENCES v7_character_profile_versions(profile_version_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;

CREATE TABLE v7_character_context_packs (
  context_pack_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_brief TEXT NOT NULL,
  source_canon_revision INTEGER NOT NULL CHECK (source_canon_revision >= 0),
  selection_member_key TEXT NOT NULL,
  member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  candidate_entity_ids_json TEXT NOT NULL CHECK (json_valid(candidate_entity_ids_json)),
  selected_entity_ids_json TEXT CHECK (selected_entity_ids_json IS NULL OR json_valid(selected_entity_ids_json)),
  selected_fields_json TEXT CHECK (selected_fields_json IS NULL OR json_valid(selected_fields_json)),
  selection_reasons_json TEXT CHECK (selection_reasons_json IS NULL OR json_valid(selection_reasons_json)),
  open_questions_json TEXT CHECK (open_questions_json IS NULL OR json_valid(open_questions_json)),
  content_json TEXT CHECK (content_json IS NULL OR json_valid(content_json)),
  estimated_tokens INTEGER CHECK (estimated_tokens IS NULL OR estimated_tokens >= 0),
  content_hash TEXT CHECK (content_hash IS NULL OR length(content_hash) = 64),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('queued','working','active','failed','unknown','invalidated')),
  request_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  invalidated_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, idempotency_key)
) STRICT;

CREATE INDEX v7_character_context_packs_task_idx
  ON v7_character_context_packs(owner_id, book_id, task_kind, task_id, created_at DESC);

CREATE TABLE v7_character_maintenance_runs (
  maintenance_run_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('chapter_settlement','event_settlement','volume_settlement')),
  source_version_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  source_canon_revision INTEGER NOT NULL CHECK (source_canon_revision >= 0),
  source_snapshot_json TEXT NOT NULL CHECK (json_valid(source_snapshot_json)),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  assigned_member_key TEXT NOT NULL,
  member_snapshot_json TEXT NOT NULL CHECK (json_valid(member_snapshot_json)),
  status TEXT NOT NULL CHECK (status IN ('queued','working','awaiting_review','completed','failed','unknown')),
  request_id TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, source_kind, source_version_id)
) STRICT;

CREATE INDEX v7_character_maintenance_runs_scope_idx
  ON v7_character_maintenance_runs(owner_id, book_id, updated_at DESC);

CREATE TABLE v7_character_change_candidates (
  candidate_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  maintenance_run_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  candidate_kind TEXT NOT NULL CHECK (candidate_kind IN ('profile_update','canon_gap')),
  field_path TEXT NOT NULL,
  proposed_value_json TEXT NOT NULL CHECK (json_valid(proposed_value_json)),
  public_summary TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  state TEXT NOT NULL CHECK (state IN ('pending','accepted','dismissed','superseded')),
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (maintenance_run_id) REFERENCES v7_character_maintenance_runs(maintenance_run_id),
  FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
) STRICT;

CREATE INDEX v7_character_change_candidates_pending_idx
  ON v7_character_change_candidates(owner_id, book_id, state, created_at DESC);

CREATE TABLE v7_character_review_issues (
  issue_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  maintenance_run_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  issue_kind TEXT NOT NULL CHECK (issue_kind IN ('hard_conflict','continuity_risk','creative_quality','open_question')),
  severity TEXT NOT NULL CHECK (severity IN ('blocking','important','advisory')),
  public_summary TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  suggested_action TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open','resolved','dismissed','superseded')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (maintenance_run_id) REFERENCES v7_character_maintenance_runs(maintenance_run_id),
  FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
) STRICT;

CREATE INDEX v7_character_review_issues_open_idx
  ON v7_character_review_issues(owner_id, book_id, state, severity, created_at DESC);

CREATE TABLE v7_character_model_calls (
  request_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('context_pack','maintenance')),
  member_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('coding','agent')),
  state TEXT NOT NULL CHECK (state IN ('working','succeeded','failed','unknown')),
  prompt_hash TEXT NOT NULL CHECK (length(prompt_hash) = 64),
  reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cash_micros INTEGER CHECK (cash_micros IS NULL OR cash_micros >= 0),
  output_text TEXT,
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE INDEX v7_character_model_calls_run_idx
  ON v7_character_model_calls(owner_id, book_id, run_id, state, started_at);
