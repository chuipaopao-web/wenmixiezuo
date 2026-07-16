CREATE TABLE positioning_drafts (
  draft_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  proposed_book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  input_text TEXT NOT NULL,
  fields_json TEXT NOT NULL CHECK (json_valid(fields_json)),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  status TEXT NOT NULL CHECK (status IN ('editing', 'confirmed', 'abandoned')),
  version INTEGER NOT NULL CHECK (version >= 1),
  confirmed_book_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES owners(owner_id),
  UNIQUE(owner_id, proposed_book_id)
) STRICT;

CREATE TABLE positioning_versions (
  positioning_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  fields_json TEXT NOT NULL CHECK (json_valid(fields_json)),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  source_draft_id TEXT,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (source_draft_id) REFERENCES positioning_drafts(draft_id),
  UNIQUE(owner_id, book_id, version)
) STRICT;

CREATE TABLE book_configs (
  config_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  positioning_version INTEGER NOT NULL,
  budget_mode TEXT NOT NULL CHECK (budget_mode IN ('saving', 'standard', 'detailed')),
  preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json)),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, version)
) STRICT;

CREATE TABLE classification_tags (
  tag_id TEXT PRIMARY KEY,
  tag_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  dynamic INTEGER NOT NULL CHECK (dynamic IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE positioning_tag_bindings (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  positioning_version INTEGER NOT NULL,
  tag_id TEXT NOT NULL,
  source_status TEXT NOT NULL CHECK (source_status IN ('explicit', 'inferred', 'unspecified', 'conflict')),
  PRIMARY KEY (owner_id, book_id, positioning_version, tag_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (tag_id) REFERENCES classification_tags(tag_id)
) STRICT;

CREATE TABLE adaptation_snapshots (
  adaptation_snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  positioning_version INTEGER NOT NULL,
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, version)
) STRICT;

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('creative_plan', 'story_bible', 'master_outline', 'volume_outline', 'chapter_outline', 'writing_contract')),
  title TEXT NOT NULL,
  active_version_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(owner_id, book_id, artifact_type, title)
) STRICT;

CREATE TABLE artifact_versions (
  artifact_version_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  parent_version_id TEXT,
  positioning_version INTEGER NOT NULL,
  adaptation_snapshot_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('draft', 'candidate', 'selected', 'superseded', 'invalidated')),
  source_task_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(artifact_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (parent_version_id) REFERENCES artifact_versions(artifact_version_id),
  FOREIGN KEY (adaptation_snapshot_id) REFERENCES adaptation_snapshots(adaptation_snapshot_id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(task_id),
  UNIQUE(artifact_id, version)
) STRICT;

CREATE INDEX artifact_versions_scope_idx ON artifact_versions(owner_id, book_id, status);

CREATE TABLE invalidations (
  invalidation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_positioning_version INTEGER,
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE INDEX invalidations_scope_idx ON invalidations(owner_id, book_id, resolved);

CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('boss', 'agent', 'system')),
  sender_agent_id TEXT,
  role_key TEXT,
  model_provider TEXT,
  model_id TEXT,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  references_json TEXT NOT NULL CHECK (json_valid(references_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (sender_agent_id) REFERENCES agent_instances(agent_id)
) STRICT;

CREATE TABLE discussions (
  discussion_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  discussion_type TEXT NOT NULL CHECK (discussion_type IN ('quick', 'collaborative', 'formal')),
  scope_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('collecting', 'cross_review', 'synthesizing', 'reviewing_draft', 'awaiting_boss', 'confirmed', 'rejected', 'abandoned', 'superseded')),
  discussion_epoch INTEGER NOT NULL DEFAULT 1,
  call_limit INTEGER NOT NULL CHECK (call_limit >= 0),
  token_limit INTEGER NOT NULL CHECK (token_limit >= 0),
  calls_used INTEGER NOT NULL DEFAULT 0 CHECK (calls_used >= 0),
  tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  created_by_agent_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (created_by_agent_id) REFERENCES agent_instances(agent_id)
) STRICT;

CREATE TABLE discussion_participants (
  discussion_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  invited_reason TEXT NOT NULL,
  responded INTEGER NOT NULL DEFAULT 0 CHECK (responded IN (0, 1)),
  PRIMARY KEY (discussion_id, agent_id),
  FOREIGN KEY (discussion_id) REFERENCES discussions(discussion_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id)
) STRICT;

CREATE TABLE discussion_opinions (
  opinion_id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model_snapshot_id TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  phase TEXT NOT NULL CHECK (phase IN ('independent', 'cross_review', 'supplement', 'objection')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (discussion_id) REFERENCES discussions(discussion_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id)
) STRICT;

CREATE TABLE discussion_decisions (
  decision_id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  recommendation_json TEXT NOT NULL CHECK (json_valid(recommendation_json)),
  alternatives_json TEXT NOT NULL CHECK (json_valid(alternatives_json)),
  disagreements_json TEXT NOT NULL CHECK (json_valid(disagreements_json)),
  impacts_json TEXT NOT NULL CHECK (json_valid(impacts_json)),
  boss_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (boss_confirmed IN (0, 1)),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (discussion_id) REFERENCES discussions(discussion_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

