ALTER TABLE context_packs
  ADD COLUMN policy_version TEXT NOT NULL DEFAULT 'legacy-context-v1';

ALTER TABLE context_packs
  ADD COLUMN source_fingerprint TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
  CHECK (length(source_fingerprint) = 64);

CREATE TABLE creative_sessions (
  creative_session_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'exploring', 'awaiting_direction', 'planning', 'awaiting_plan',
    'ready', 'paused', 'closed', 'superseded'
  )),
  mode TEXT NOT NULL CHECK (mode IN ('open_discussion', 'creative_forecast', 'trial_draft', 'formal_production')),
  active_topic TEXT NOT NULL,
  current_blackboard_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_blackboard_revision >= 0),
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  session_epoch INTEGER NOT NULL DEFAULT 1 CHECK (session_epoch >= 1),
  opened_by_message_id TEXT,
  locked_decision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id),
  FOREIGN KEY (opened_by_message_id) REFERENCES messages(message_id),
  FOREIGN KEY (locked_decision_id) REFERENCES discussion_decisions(decision_id)
) STRICT;

CREATE UNIQUE INDEX creative_sessions_one_active_per_book_idx
  ON creative_sessions(owner_id, book_id)
  WHERE status IN ('exploring', 'awaiting_direction', 'planning', 'awaiting_plan', 'ready', 'paused');

CREATE INDEX creative_sessions_conversation_idx
  ON creative_sessions(owner_id, book_id, conversation_id, updated_at);

CREATE TABLE creative_session_events (
  creative_session_event_id TEXT PRIMARY KEY,
  creative_session_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'owner_message', 'editor_reply', 'action', 'status_changed',
    'round_opened', 'round_completed', 'direction_locked', 'session_closed'
  )),
  source_message_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (creative_session_id) REFERENCES creative_sessions(creative_session_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (source_message_id) REFERENCES messages(message_id),
  UNIQUE(creative_session_id, sequence_no)
) STRICT;

CREATE INDEX creative_session_events_scope_idx
  ON creative_session_events(owner_id, book_id, creative_session_id, sequence_no);

CREATE TABLE creative_blackboard_revisions (
  creative_blackboard_revision_id TEXT PRIMARY KEY,
  creative_session_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  previous_revision INTEGER CHECK (previous_revision IS NULL OR previous_revision >= 1),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) = 64),
  created_by TEXT NOT NULL CHECK (created_by IN ('workflow', 'chief_editor', 'boss_action')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (creative_session_id) REFERENCES creative_sessions(creative_session_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(creative_session_id, revision)
) STRICT;

CREATE INDEX creative_blackboard_scope_idx
  ON creative_blackboard_revisions(owner_id, book_id, creative_session_id, revision);

CREATE TABLE creative_session_rounds (
  creative_session_round_id TEXT PRIMARY KEY,
  creative_session_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  round_kind TEXT NOT NULL CHECK (round_kind IN ('initial_exploration', 'major_redirect', 'locked_planning')),
  blackboard_revision INTEGER NOT NULL CHECK (blackboard_revision >= 1),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) = 64),
  status TEXT NOT NULL CHECK (status IN ('queued', 'working', 'awaiting_boss', 'completed', 'cancelled', 'failed', 'superseded')),
  created_at TEXT NOT NULL,
  completed_decision_id TEXT,
  completed_at TEXT,
  FOREIGN KEY (creative_session_id) REFERENCES creative_sessions(creative_session_id),
  FOREIGN KEY (discussion_id) REFERENCES discussions(discussion_id),
  FOREIGN KEY (completed_decision_id) REFERENCES discussion_decisions(decision_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE(creative_session_id, round_number)
) STRICT;

CREATE INDEX creative_session_rounds_scope_idx
  ON creative_session_rounds(owner_id, book_id, creative_session_id, round_number);

CREATE TABLE narrative_forecasts (
  narrative_forecast_id TEXT PRIMARY KEY,
  creative_session_id TEXT NOT NULL,
  discussion_id TEXT,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  canon_revision INTEGER NOT NULL CHECK (canon_revision >= 0),
  blackboard_revision INTEGER NOT NULL CHECK (blackboard_revision >= 1),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) = 64),
  status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'adopted', 'rejected', 'superseded')),
  stale_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (creative_session_id) REFERENCES creative_sessions(creative_session_id),
  FOREIGN KEY (discussion_id) REFERENCES discussions(discussion_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id)
) STRICT;

CREATE INDEX narrative_forecasts_scope_idx
  ON narrative_forecasts(owner_id, book_id, creative_session_id, created_at);

CREATE TABLE narrative_forecast_branches (
  narrative_forecast_branch_id TEXT PRIMARY KEY,
  narrative_forecast_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
  title TEXT NOT NULL,
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  source_agent_id TEXT,
  source_opinion_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (narrative_forecast_id) REFERENCES narrative_forecasts(narrative_forecast_id),
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (source_agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (source_opinion_id) REFERENCES discussion_opinions(opinion_id),
  UNIQUE(narrative_forecast_id, ordinal)
) STRICT;

CREATE INDEX narrative_forecast_branches_scope_idx
  ON narrative_forecast_branches(owner_id, book_id, narrative_forecast_id, ordinal);

CREATE TABLE manuscript_quality_snapshots (
  manuscript_quality_snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  manuscript_version_id TEXT NOT NULL,
  review_panel_id TEXT,
  parent_snapshot_id TEXT,
  dimensions_json TEXT NOT NULL CHECK (json_valid(dimensions_json)),
  hard_blocked INTEGER NOT NULL CHECK (hard_blocked IN (0, 1)),
  is_best INTEGER NOT NULL DEFAULT 0 CHECK (is_best IN (0, 1)),
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(chapter_id),
  FOREIGN KEY (manuscript_version_id) REFERENCES manuscript_versions(manuscript_version_id),
  FOREIGN KEY (review_panel_id) REFERENCES review_panels(review_panel_id),
  FOREIGN KEY (parent_snapshot_id) REFERENCES manuscript_quality_snapshots(manuscript_quality_snapshot_id),
  UNIQUE(owner_id, book_id, manuscript_version_id, review_panel_id)
) STRICT;

CREATE UNIQUE INDEX manuscript_quality_one_best_idx
  ON manuscript_quality_snapshots(owner_id, book_id, chapter_id)
  WHERE is_best = 1;
