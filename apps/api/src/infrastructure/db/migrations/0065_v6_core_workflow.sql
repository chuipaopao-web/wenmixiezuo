-- V6 核心工作流：故事线、角色安排、计划/实际总账、草稿冲突与重开影响。
-- DR: V6-CWF-20260822-DR-02。只向前追加；不改写任何既有正式版本、正文、结算或历史任务。

CREATE TABLE book_storyline_topology_versions (
  topology_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  topology_type TEXT NOT NULL CHECK (topology_type IN ('core_with_branches','dual_core','multi_core','unit_stories')),
  status TEXT NOT NULL CHECK (status IN ('candidate','active','superseded','archived')),
  parent_version_id TEXT,
  source_task_id TEXT,
  source_version_ids_json TEXT NOT NULL CHECK (json_valid(source_version_ids_json)),
  author_input_refs_json TEXT NOT NULL CHECK (json_valid(author_input_refs_json)),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (parent_version_id) REFERENCES book_storyline_topology_versions(topology_version_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id,book_id,version)
) STRICT;
CREATE UNIQUE INDEX book_storyline_topology_active_idx
  ON book_storyline_topology_versions(owner_id,book_id) WHERE status='active';

CREATE TABLE storylines (
  storyline_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('ideation','active','paused','completed','abandoned')),
  active_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  UNIQUE(owner_id,book_id,storyline_id),
  UNIQUE(owner_id,book_id,sort_order)
) STRICT;
CREATE INDEX storylines_scope_status_idx ON storylines(owner_id,book_id,lifecycle_status,sort_order);

CREATE TABLE storyline_versions (
  storyline_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  storyline_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('candidate','active','superseded','archived')),
  base_version INTEGER NOT NULL CHECK (base_version >= 0),
  parent_version_id TEXT,
  source_task_id TEXT,
  source_version_ids_json TEXT NOT NULL CHECK (json_valid(source_version_ids_json)),
  author_input_refs_json TEXT NOT NULL CHECK (json_valid(author_input_refs_json)),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id,book_id,storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  FOREIGN KEY (parent_version_id) REFERENCES storyline_versions(storyline_version_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id,book_id,storyline_id,version)
) STRICT;
CREATE UNIQUE INDEX storyline_versions_active_idx
  ON storyline_versions(owner_id,book_id,storyline_id) WHERE status='active';
CREATE INDEX storyline_versions_history_idx
  ON storyline_versions(owner_id,book_id,storyline_id,version DESC);

CREATE TABLE storyline_relations (
  storyline_relation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  from_storyline_id TEXT NOT NULL,
  to_storyline_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('serves','constrains','mirrors','intersects')),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (from_storyline_id <> to_storyline_id),
  FOREIGN KEY (owner_id,book_id,from_storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  FOREIGN KEY (owner_id,book_id,to_storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  UNIQUE(owner_id,book_id,from_storyline_id,to_storyline_id,relation_type)
) STRICT;

CREATE TABLE storyline_volume_participations (
  storyline_volume_participation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  storyline_id TEXT NOT NULL,
  volume_plan_id TEXT NOT NULL,
  participation_status TEXT NOT NULL CHECK (participation_status IN ('leading','important','foreshadow','paused','unrelated')),
  responsibility TEXT,
  source_storyline_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id,storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  FOREIGN KEY (owner_id,book_id,volume_plan_id) REFERENCES volume_plans(owner_id,book_id,volume_plan_id),
  FOREIGN KEY (source_storyline_version_id) REFERENCES storyline_versions(storyline_version_id),
  UNIQUE(owner_id,book_id,storyline_id,volume_plan_id)
) STRICT;
CREATE INDEX storyline_volume_scope_idx
  ON storyline_volume_participations(owner_id,book_id,volume_plan_id,participation_status,status);

CREATE TABLE character_cards (
  character_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  character_kind TEXT NOT NULL CHECK (character_kind IN ('protagonist','existing','volume_new','temporary')),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('draft','active','retired','archived')),
  active_version_id TEXT,
  promoted_from_character_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (promoted_from_character_id) REFERENCES character_cards(character_id),
  UNIQUE(owner_id,book_id,character_id)
) STRICT;

CREATE TABLE character_card_versions (
  character_card_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('candidate','active','superseded','archived')),
  base_version INTEGER NOT NULL CHECK (base_version >= 0),
  parent_version_id TEXT,
  source_task_id TEXT,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id,book_id,character_id) REFERENCES character_cards(owner_id,book_id,character_id),
  FOREIGN KEY (parent_version_id) REFERENCES character_card_versions(character_card_version_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(owner_id,book_id,character_id,version)
) STRICT;
CREATE UNIQUE INDEX character_card_versions_active_idx
  ON character_card_versions(owner_id,book_id,character_id) WHERE status='active';

CREATE TABLE character_storyline_links (
  character_storyline_link_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  storyline_id TEXT NOT NULL,
  influence TEXT NOT NULL CHECK (length(trim(influence)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id,character_id) REFERENCES character_cards(owner_id,book_id,character_id),
  FOREIGN KEY (owner_id,book_id,storyline_id) REFERENCES storylines(owner_id,book_id,storyline_id),
  UNIQUE(owner_id,book_id,character_id,storyline_id)
) STRICT;

CREATE TABLE event_role_assignments (
  event_role_assignment_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  event_chain_version_id TEXT NOT NULL,
  event_node_id TEXT NOT NULL,
  role_function_key TEXT NOT NULL,
  role_function_label TEXT NOT NULL,
  requirement_json TEXT NOT NULL CHECK (json_valid(requirement_json)),
  assigned_character_id TEXT,
  assignment_status TEXT NOT NULL CHECK (assignment_status IN ('placeholder','assigned','needs_review')),
  source_character_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_chain_version_id) REFERENCES event_chain_versions(event_chain_version_id),
  FOREIGN KEY (assigned_character_id) REFERENCES character_cards(character_id),
  FOREIGN KEY (source_character_version_id) REFERENCES character_card_versions(character_card_version_id),
  UNIQUE(owner_id,book_id,event_chain_version_id,event_node_id,role_function_key)
) STRICT;
CREATE INDEX event_role_assignments_scope_idx
  ON event_role_assignments(owner_id,book_id,event_chain_version_id,event_node_id,assignment_status);

CREATE TABLE creative_ledger_entries (
  ledger_entry_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  ledger_type TEXT NOT NULL CHECK (ledger_type IN ('storyline','relationship','world_state','causality','foreshadow','settlement')),
  truth_status TEXT NOT NULL CHECK (truth_status IN ('planned','actual')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('book','volume','event','chapter')),
  scope_id TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  entry_status TEXT NOT NULL CHECK (entry_status IN ('planned','active','advanced','resolved','abandoned','superseded')),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('topology','storyline','volume_plan','event_plan','chapter_outline','manuscript','chapter_settlement','event_settlement','volume_settlement')),
  source_version_id TEXT NOT NULL,
  source_locator_json TEXT CHECK (source_locator_json IS NULL OR json_valid(source_locator_json)),
  supersedes_entry_id TEXT,
  created_at TEXT NOT NULL,
  CHECK (truth_status <> 'actual' OR source_kind IN ('manuscript','chapter_settlement','event_settlement','volume_settlement')),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (supersedes_entry_id) REFERENCES creative_ledger_entries(ledger_entry_id),
  UNIQUE(owner_id,book_id,ledger_entry_id)
) STRICT;
CREATE INDEX creative_ledger_projection_idx
  ON creative_ledger_entries(owner_id,book_id,ledger_type,truth_status,scope_type,scope_id,created_at DESC);

CREATE TABLE author_object_drafts (
  author_object_draft_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('topology','storyline','volume_direction','expression','event_chain','event','character','chapter_sequence','chapter_outline','manuscript')),
  object_id TEXT NOT NULL,
  base_version INTEGER NOT NULL CHECK (base_version >= 0),
  draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
  draft_json TEXT NOT NULL CHECK (json_valid(draft_json)),
  author_input_version INTEGER NOT NULL DEFAULT 0 CHECK (author_input_version >= 0),
  status TEXT NOT NULL CHECK (status IN ('active','confirmed','superseded','conflicted','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  UNIQUE(owner_id,book_id,author_object_draft_id)
) STRICT;
CREATE UNIQUE INDEX author_object_drafts_active_idx
  ON author_object_drafts(owner_id,book_id,object_type,object_id) WHERE status='active';

CREATE TABLE workflow_invalidations_v6 (
  invalidation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  upstream_object_type TEXT NOT NULL,
  upstream_object_id TEXT NOT NULL,
  upstream_version_id TEXT NOT NULL,
  downstream_object_type TEXT NOT NULL,
  downstream_object_id TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('stale','recompile_required','review_required','resolved','not_affected')),
  impact_json TEXT NOT NULL CHECK (json_valid(impact_json)),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  UNIQUE(owner_id,book_id,invalidation_id)
) STRICT;
CREATE INDEX workflow_invalidations_active_idx
  ON workflow_invalidations_v6(owner_id,book_id,resolution,created_at DESC);

CREATE TABLE object_reopen_records (
  reopen_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  from_version_id TEXT NOT NULL,
  new_draft_id TEXT NOT NULL,
  impact_preview_json TEXT NOT NULL CHECK (json_valid(impact_preview_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id,new_draft_id) REFERENCES author_object_drafts(owner_id,book_id,author_object_draft_id),
  UNIQUE(owner_id,book_id,reopen_id)
) STRICT;

CREATE TABLE core_workflow_states_v6 (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  active_stage TEXT NOT NULL CHECK (active_stage IN ('setting','storyline','volume','event','chapter')),
  active_object_id TEXT,
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version > 0),
  blocking_reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id,book_id),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;

CREATE TABLE internal_structure_method_scopes (
  internal_structure_method_version_id TEXT PRIMARY KEY,
  primary_scope TEXT NOT NULL CHECK (primary_scope IN ('book_topology','storyline_rhythm','volume_rhythm','event_rhythm','content_type')),
  applicable_scopes_json TEXT NOT NULL CHECK (json_valid(applicable_scopes_json)),
  public_mapping_json TEXT NOT NULL CHECK (json_valid(public_mapping_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (internal_structure_method_version_id) REFERENCES internal_structure_method_versions(internal_structure_method_version_id)
) STRICT;