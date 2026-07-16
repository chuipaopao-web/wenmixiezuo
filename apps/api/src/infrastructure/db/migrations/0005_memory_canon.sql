CREATE TABLE volumes (
  volume_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_number INTEGER NOT NULL CHECK (volume_number >= 1),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'completed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, volume_number)
) STRICT;

CREATE TABLE chapters (
  chapter_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  volume_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL CHECK (chapter_number >= 1),
  title TEXT NOT NULL,
  plan_status TEXT NOT NULL CHECK (plan_status IN ('planned', 'ready', 'invalidated')),
  generation_status TEXT NOT NULL CHECK (generation_status IN ('not_started', 'working', 'paused', 'failed', 'completed')),
  settlement_status TEXT NOT NULL CHECK (settlement_status IN ('unsettled', 'awaiting_confirmation', 'settled')),
  current_manuscript_version_id TEXT,
  canon_manuscript_version_id TEXT,
  chapter_end_state_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (volume_id) REFERENCES volumes(volume_id),
  UNIQUE(owner_id, book_id, chapter_number)
) STRICT;

CREATE TABLE manuscript_versions (
  manuscript_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  parent_version_id TEXT,
  author_agent_id TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  word_count INTEGER NOT NULL CHECK (word_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'candidate', 'under_review', 'approved', 'canon', 'rejected')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (parent_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  FOREIGN KEY (author_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (file_id) REFERENCES file_registry(file_id),
  UNIQUE(owner_id, book_id, chapter_id, content_hash)
) STRICT;

CREATE TABLE entities (
  entity_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('character', 'location', 'organization', 'item', 'resource', 'skill', 'stat_panel', 'world_rule', 'event', 'foreshadowing', 'hook')),
  canonical_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL CHECK (json_valid(aliases_json)),
  schema_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('active', 'merged', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, entity_type, canonical_name)
) STRICT;

CREATE TABLE fact_assertions (
  fact_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  subject_entity_id TEXT NOT NULL,
  relation_key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  story_time_start TEXT,
  story_time_end TEXT,
  source_chapter_id TEXT,
  source_manuscript_version_id TEXT,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  grade TEXT NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D')),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'awaiting_editor', 'awaiting_boss', 'approved', 'active', 'rejected', 'superseded', 'withdrawn')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (subject_entity_id) REFERENCES entities(entity_id),
  FOREIGN KEY (source_chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (source_manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id)
) STRICT;

CREATE INDEX fact_assertions_lookup_idx ON fact_assertions(owner_id, book_id, subject_entity_id, relation_key, status);

CREATE TABLE canon_revisions (
  canon_revision_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  parent_revision_id TEXT,
  reason TEXT NOT NULL,
  source_chapter_id TEXT,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (parent_revision_id) REFERENCES canon_revisions(canon_revision_id),
  FOREIGN KEY (source_chapter_id) REFERENCES chapters(chapter_id),
  UNIQUE(owner_id, book_id, revision)
) STRICT;

CREATE TABLE canon_bindings (
  canon_revision_id TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  bound_at TEXT NOT NULL,
  PRIMARY KEY (canon_revision_id, fact_id),
  FOREIGN KEY (canon_revision_id) REFERENCES canon_revisions(canon_revision_id),
  FOREIGN KEY (fact_id) REFERENCES fact_assertions(fact_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE canon_revisions_log (
  canon_change_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('settlement', 'correction', 'withdrawal', 'conflict_resolution')),
  affected_fact_ids_json TEXT NOT NULL CHECK (json_valid(affected_fact_ids_json)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE confirmations (
  confirmation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  old_value_json TEXT NOT NULL CHECK (json_valid(old_value_json)),
  new_value_json TEXT NOT NULL CHECK (json_valid(new_value_json)),
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  impact_json TEXT NOT NULL CHECK (json_valid(impact_json)),
  expected_canon_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE conflicts (
  conflict_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('blocker', 'major', 'minor', 'observation')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  impact_json TEXT NOT NULL CHECK (json_valid(impact_json)),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'accepted_risk')),
  resolution_json TEXT CHECK (resolution_json IS NULL OR json_valid(resolution_json)),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE memories (
  memory_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  agent_id TEXT,
  memory_layer TEXT NOT NULL CHECK (memory_layer IN ('system_rules', 'story_bible', 'canon_fact', 'chapter_end', 'manuscript_index', 'book_working', 'agent_private', 'task_temporary')),
  content TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  fact_status TEXT,
  story_time_start TEXT,
  story_time_end TEXT,
  chapter_start INTEGER,
  chapter_end INTEGER,
  canon_revision INTEGER NOT NULL,
  positioning_version INTEGER NOT NULL,
  importance INTEGER NOT NULL CHECK (importance BETWEEN 0 AND 100),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'invalidated', 'archived')),
  invalidation_reason TEXT,
  created_at TEXT NOT NULL,
  invalidated_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id)
) STRICT;

CREATE INDEX memories_scope_layer_idx ON memories(owner_id, book_id, memory_layer, status, canon_revision);

CREATE VIRTUAL TABLE content_fts USING fts5(
  owner_id UNINDEXED,
  book_id UNINDEXED,
  source_type UNINDEXED,
  source_id UNINDEXED,
  content,
  tokenize = 'unicode61'
);

CREATE TABLE retrieval_records (
  retrieval_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_id TEXT,
  query_text TEXT NOT NULL,
  filters_json TEXT NOT NULL CHECK (json_valid(filters_json)),
  results_json TEXT NOT NULL CHECK (json_valid(results_json)),
  adopted_source_ids_json TEXT NOT NULL CHECK (json_valid(adopted_source_ids_json)),
  canon_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id)
) STRICT;

CREATE TABLE context_packs (
  context_pack_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  chapter_id TEXT,
  canon_revision INTEGER NOT NULL,
  positioning_version INTEGER NOT NULL,
  outline_version_id TEXT,
  writing_contract_version_id TEXT,
  token_budget INTEGER NOT NULL CHECK (token_budget >= 0),
  total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
  source_manifest_json TEXT NOT NULL CHECK (json_valid(source_manifest_json)),
  excluded_sources_json TEXT NOT NULL CHECK (json_valid(excluded_sources_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('active', 'invalidated')),
  created_at TEXT NOT NULL,
  invalidated_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (outline_version_id) REFERENCES artifact_versions(artifact_version_id),
  FOREIGN KEY (writing_contract_version_id) REFERENCES artifact_versions(artifact_version_id)
) STRICT;

CREATE TABLE chapter_end_states (
  chapter_end_state_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  canon_revision INTEGER NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  UNIQUE(owner_id, book_id, chapter_id, canon_revision)
) STRICT;

CREATE TABLE character_state_projection (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  canon_revision INTEGER NOT NULL,
  entity_id TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  rebuilt_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, book_id, canon_revision, entity_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
) STRICT;

CREATE TABLE timeline_projection (
  timeline_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  canon_revision INTEGER NOT NULL,
  entity_id TEXT NOT NULL,
  story_time TEXT NOT NULL,
  event_json TEXT NOT NULL CHECK (json_valid(event_json)),
  source_fact_id TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (entity_id) REFERENCES entities(entity_id),
  FOREIGN KEY (source_fact_id) REFERENCES fact_assertions(fact_id)
) STRICT;

CREATE TABLE relationship_projection (
  relationship_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  canon_revision INTEGER NOT NULL,
  from_entity_id TEXT NOT NULL,
  relation_key TEXT NOT NULL,
  to_value_json TEXT NOT NULL CHECK (json_valid(to_value_json)),
  source_fact_id TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (from_entity_id) REFERENCES entities(entity_id),
  FOREIGN KEY (source_fact_id) REFERENCES fact_assertions(fact_id)
) STRICT;

