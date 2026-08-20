-- DR-20260820-layered-creation-v1：约束分层、缺口裁决、故事线程、首卷追踪和稳定组合包。

CREATE TABLE setting_clauses (
  setting_clause_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  statement TEXT NOT NULL CHECK (length(trim(statement)) > 0),
  strength TEXT NOT NULL CHECK (strength IN ('hard_fact','current_task','soft_reference','open_space')),
  truth_status TEXT NOT NULL CHECK (truth_status IN ('planned','confirmed','actual')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('book','volume','event','chapter','scene')),
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  source_version_id TEXT NOT NULL CHECK (length(trim(source_version_id)) > 0),
  dependency_version_ids_json TEXT NOT NULL CHECK (json_valid(dependency_version_ids_json)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  UNIQUE(owner_id,book_id,setting_clause_id)
) STRICT;
CREATE INDEX setting_clauses_compile_idx
  ON setting_clauses(owner_id,book_id,scope_type,scope_id,strength,truth_status,status);

CREATE TABLE setting_gap_decisions (
  setting_gap_decision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  discovered_scope_type TEXT NOT NULL CHECK (discovered_scope_type IN ('volume','event','chapter')),
  discovered_scope_id TEXT NOT NULL CHECK (length(trim(discovered_scope_id)) > 0),
  question TEXT NOT NULL CHECK (length(trim(question)) > 0),
  why_needed TEXT NOT NULL CHECK (length(trim(why_needed)) > 0),
  affected_objects_json TEXT NOT NULL CHECK (json_valid(affected_objects_json)),
  decision TEXT NOT NULL CHECK (decision IN ('design_now','not_used_this_volume','keep_unknown')),
  resolved_setting_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  UNIQUE(owner_id,book_id,setting_gap_decision_id)
) STRICT;
CREATE INDEX setting_gap_scope_idx
  ON setting_gap_decisions(owner_id,book_id,discovered_scope_type,discovered_scope_id,updated_at DESC);

CREATE TABLE story_thread_records (
  story_thread_record_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  thread_type TEXT NOT NULL CHECK (thread_type IN (
    'promise','foreshadowing','question','relationship','inner_change','conflict','identity_resource_emotion'
  )),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('book','volume','event')),
  scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
  status TEXT NOT NULL CHECK (status IN ('planned','planted','advanced','due','resolved','abandoned_by_author')),
  planned_window_json TEXT CHECK (planned_window_json IS NULL OR json_valid(planned_window_json)),
  source_version_ids_json TEXT NOT NULL CHECK (json_valid(source_version_ids_json)),
  actual_evidence_version_ids_json TEXT NOT NULL CHECK (json_valid(actual_evidence_version_ids_json)),
  abandonment_reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  UNIQUE(owner_id,book_id,story_thread_record_id)
) STRICT;
CREATE INDEX story_thread_task_idx
  ON story_thread_records(owner_id,book_id,scope_type,scope_id,status,updated_at DESC);

CREATE TABLE first_volume_launch_progress (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  launch_plan_direction_version_id TEXT NOT NULL,
  effective_character_count INTEGER NOT NULL DEFAULT 0 CHECK (effective_character_count >= 0),
  climax_event_node_id TEXT,
  climax_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (climax_status IN ('planned','setup_started','in_progress','completed','missed')),
  setup_responsibilities_json TEXT NOT NULL CHECK (json_valid(setup_responsibilities_json)),
  actual_fulfillment_json TEXT CHECK (actual_fulfillment_json IS NULL OR json_valid(actual_fulfillment_json)),
  forecast_effective_character_count INTEGER,
  exceeds_limit_risk INTEGER NOT NULL DEFAULT 0 CHECK (exceeds_limit_risk IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id,book_id,volume_plan_id),
  FOREIGN KEY (owner_id,book_id,volume_plan_id) REFERENCES volume_plans(owner_id,book_id,volume_plan_id),
  FOREIGN KEY (launch_plan_direction_version_id) REFERENCES volume_direction_versions(volume_direction_version_id)
) STRICT;

CREATE TABLE context_pack_components (
  context_pack_component_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  context_pack_id TEXT NOT NULL,
  component_kind TEXT NOT NULL CHECK (component_kind IN (
    'BookCorePack','SettingConstraintPack','BookStorySpinePack','VolumeResponsibilityPack',
    'EventResponsibilityPack','ChapterTaskPack','RecentActualStatePack','StoryThreadPack'
  )),
  compile_version INTEGER NOT NULL CHECK (compile_version > 0),
  source_version_ids_json TEXT NOT NULL CHECK (json_valid(source_version_ids_json)),
  included_reasons_json TEXT NOT NULL CHECK (json_valid(included_reasons_json)),
  excluded_reasons_json TEXT NOT NULL CHECK (json_valid(excluded_reasons_json)),
  token_budget INTEGER NOT NULL CHECK (token_budget >= 0),
  character_budget INTEGER NOT NULL CHECK (character_budget >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (context_pack_id) REFERENCES context_packs(context_pack_id),
  UNIQUE(owner_id,book_id,context_pack_id,component_kind,compile_version)
) STRICT;
