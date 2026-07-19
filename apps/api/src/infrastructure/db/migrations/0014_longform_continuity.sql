CREATE TABLE narrative_commitments (
  narrative_commitment_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  commitment_type TEXT NOT NULL CHECK (commitment_type IN ('promise', 'foreshadowing', 'mystery', 'threat', 'rule_debt', 'relationship_debt', 'causal_debt')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  entity_ids_json TEXT NOT NULL CHECK (json_valid(entity_ids_json)),
  opened_chapter INTEGER NOT NULL CHECK (opened_chapter >= 1),
  earliest_due_chapter INTEGER,
  latest_due_chapter INTEGER,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  source_locator_json TEXT NOT NULL CHECK (json_valid(source_locator_json)),
  authority_grade TEXT NOT NULL CHECK (authority_grade IN ('A', 'B', 'C', 'D')),
  status TEXT NOT NULL CHECK (status IN ('open', 'due', 'fulfilled', 'violated', 'retired')),
  resolution_source_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE INDEX narrative_commitments_due_idx ON narrative_commitments(owner_id, book_id, status, earliest_due_chapter, latest_due_chapter);

CREATE TABLE continuity_nodes (
  continuity_node_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  node_level TEXT NOT NULL CHECK (node_level IN ('scene', 'chapter', 'story_arc', 'volume', 'book_spine')),
  scope_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  chapter_start INTEGER NOT NULL CHECK (chapter_start >= 1),
  chapter_end INTEGER NOT NULL CHECK (chapter_end >= chapter_start),
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
  anchors_json TEXT NOT NULL CHECK (json_valid(anchors_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded', 'stale')),
  created_at TEXT NOT NULL,
  activated_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, node_level, scope_key, version)
) STRICT;

CREATE UNIQUE INDEX continuity_nodes_active_idx ON continuity_nodes(owner_id, book_id, node_level, scope_key) WHERE status = 'active';

CREATE TABLE continuity_node_sources (
  continuity_node_source_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  continuity_node_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version TEXT,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  source_locator_json TEXT NOT NULL CHECK (json_valid(source_locator_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (continuity_node_id) REFERENCES continuity_nodes(continuity_node_id)
) STRICT;

CREATE TABLE stage_settlements (
  stage_settlement_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  stage_type TEXT NOT NULL CHECK (stage_type IN ('chapter', 'story_arc', 'volume', 'book')),
  stage_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  chapter_start INTEGER NOT NULL CHECK (chapter_start >= 1),
  chapter_end INTEGER NOT NULL CHECK (chapter_end >= chapter_start),
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  irreversible_results_json TEXT NOT NULL CHECK (json_valid(irreversible_results_json)),
  entity_states_json TEXT NOT NULL CHECK (json_valid(entity_states_json)),
  closed_threads_json TEXT NOT NULL CHECK (json_valid(closed_threads_json)),
  open_threads_json TEXT NOT NULL CHECK (json_valid(open_threads_json)),
  relationship_changes_json TEXT NOT NULL CHECK (json_valid(relationship_changes_json)),
  knowledge_changes_json TEXT NOT NULL CHECK (json_valid(knowledge_changes_json)),
  resource_changes_json TEXT NOT NULL CHECK (json_valid(resource_changes_json)),
  rule_changes_json TEXT NOT NULL CHECK (json_valid(rule_changes_json)),
  exclusions_json TEXT NOT NULL CHECK (json_valid(exclusions_json)),
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded')),
  created_at TEXT NOT NULL,
  activated_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, stage_type, stage_key, version)
) STRICT;

CREATE UNIQUE INDEX stage_settlements_active_idx ON stage_settlements(owner_id, book_id, stage_type, stage_key) WHERE status = 'active';

CREATE TABLE stage_settlement_sources (
  stage_settlement_source_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  stage_settlement_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  source_locator_json TEXT NOT NULL CHECK (json_valid(source_locator_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (stage_settlement_id) REFERENCES stage_settlements(stage_settlement_id)
) STRICT;

CREATE TABLE stage_settlement_probes (
  stage_settlement_probe_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  stage_settlement_id TEXT NOT NULL,
  probe_type TEXT NOT NULL CHECK (probe_type IN ('fact', 'state', 'commitment', 'causality', 'source', 'negative')),
  expected_json TEXT NOT NULL CHECK (json_valid(expected_json)),
  actual_json TEXT NOT NULL CHECK (json_valid(actual_json)),
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (stage_settlement_id) REFERENCES stage_settlements(stage_settlement_id)
) STRICT;

CREATE TABLE rolling_plan_windows (
  rolling_plan_window_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  current_chapter INTEGER NOT NULL CHECK (current_chapter >= 1),
  detailed_start INTEGER NOT NULL CHECK (detailed_start >= 1),
  detailed_end INTEGER NOT NULL CHECK (detailed_end >= detailed_start),
  outlined_end INTEGER NOT NULL CHECK (outlined_end >= detailed_end),
  source_span_estimate_id TEXT,
  plan_json TEXT NOT NULL CHECK (json_valid(plan_json)),
  invalidation_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'invalidated', 'superseded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, version)
) STRICT;

CREATE UNIQUE INDEX rolling_plan_windows_active_idx ON rolling_plan_windows(owner_id, book_id) WHERE status = 'active';

CREATE TABLE plot_span_estimates (
  plot_span_estimate_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  round INTEGER NOT NULL CHECK (round >= 1),
  screenwriter_agent_id TEXT NOT NULL,
  model_snapshot_id TEXT NOT NULL,
  minimum_chapters INTEGER NOT NULL CHECK (minimum_chapters >= 1),
  recommended_chapters INTEGER NOT NULL CHECK (recommended_chapters >= minimum_chapters),
  maximum_chapters INTEGER NOT NULL CHECK (maximum_chapters >= recommended_chapters),
  units_json TEXT NOT NULL CHECK (json_valid(units_json)),
  assumptions_json TEXT NOT NULL CHECK (json_valid(assumptions_json)),
  uncertainty_json TEXT NOT NULL CHECK (json_valid(uncertainty_json)),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  independence_attested INTEGER NOT NULL CHECK (independence_attested IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'superseded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (screenwriter_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  UNIQUE(owner_id, book_id, discussion_id, round, screenwriter_agent_id)
) STRICT;

CREATE TABLE quality_windows (
  quality_window_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  window_size INTEGER NOT NULL CHECK (window_size IN (10, 20, 30, 50, 80, 100, 150, 200)),
  chapter_end INTEGER NOT NULL CHECK (chapter_end >= window_size),
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
  defects_json TEXT NOT NULL CHECK (json_valid(defects_json)),
  status TEXT NOT NULL CHECK (status IN ('observed', 'action_required', 'resolved')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE retrieval_activity_projections (
  retrieval_activity_projection_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  current_chapter INTEGER NOT NULL CHECK (current_chapter >= 1),
  current_volume_key TEXT,
  current_arc_key TEXT,
  active_commitment_ids_json TEXT NOT NULL CHECK (json_valid(active_commitment_ids_json)),
  recent_entity_ids_json TEXT NOT NULL CHECK (json_valid(recent_entity_ids_json)),
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'stale')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;
