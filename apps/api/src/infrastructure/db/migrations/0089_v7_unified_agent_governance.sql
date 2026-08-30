-- design_review_id: DR-V7-UNIFIED-AGENT-GOVERNANCE-20260827-42
-- V7统一岗位、成员、模型与温度治理。仅新增V7配置和任务快照字段，不改写V6数据。

CREATE TABLE v7_agent_governance_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO v7_agent_governance_meta(singleton,revision,updated_by,updated_at)
VALUES(1,1,'system',CURRENT_TIMESTAMP);

CREATE TABLE v7_agent_governance_member_settings (
  member_key TEXT PRIMARY KEY,
  fixed_role_key TEXT NOT NULL CHECK (fixed_role_key IN (
    'chief_editor','deputy_editor','planning_writer','lead_writer',
    'independent_reviewer','continuity_editor','visual_planner','visual_renderer'
  )),
  model_profile_key TEXT NOT NULL CHECK (length(trim(model_profile_key)) > 0),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  default_for_role INTEGER NOT NULL CHECK (default_for_role IN (0,1)),
  fallback_priority INTEGER NOT NULL CHECK (fallback_priority BETWEEN 1 AND 100),
  temperature_adjustment REAL NOT NULL DEFAULT 0 CHECK (temperature_adjustment BETWEEN -0.20 AND 0.20),
  prompt_instruction TEXT NOT NULL DEFAULT '' CHECK (length(prompt_instruction) <= 4000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX v7_agent_governance_one_default_per_role_idx
  ON v7_agent_governance_member_settings(fixed_role_key)
  WHERE enabled=1 AND default_for_role=1;

CREATE TABLE v7_agent_governance_task_policies (
  task_kind TEXT PRIMARY KEY,
  default_temperature REAL NOT NULL CHECK (default_temperature BETWEEN 0 AND 1),
  minimum_temperature REAL NOT NULL CHECK (minimum_temperature BETWEEN 0 AND 1),
  maximum_temperature REAL NOT NULL CHECK (maximum_temperature BETWEEN 0 AND 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (minimum_temperature <= default_temperature AND default_temperature <= maximum_temperature)
) STRICT;

CREATE TABLE v7_agent_governance_events (
  event_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('member','task_policy')),
  target_key TEXT NOT NULL,
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX v7_agent_governance_events_target_idx
  ON v7_agent_governance_events(target_kind,target_key,created_at DESC);

ALTER TABLE v7_opening_agent_model_calls ADD COLUMN governance_revision INTEGER NOT NULL DEFAULT 1 CHECK (governance_revision >= 1);
ALTER TABLE v7_opening_agent_model_calls ADD COLUMN temperature REAL CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 1);
ALTER TABLE v7_setting_model_calls ADD COLUMN governance_revision INTEGER NOT NULL DEFAULT 1 CHECK (governance_revision >= 1);
ALTER TABLE v7_setting_model_calls ADD COLUMN temperature REAL CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 1);
ALTER TABLE v7_planning_model_calls ADD COLUMN governance_revision INTEGER NOT NULL DEFAULT 1 CHECK (governance_revision >= 1);
ALTER TABLE v7_planning_model_calls ADD COLUMN temperature REAL CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 1);
ALTER TABLE v7_character_model_calls ADD COLUMN governance_revision INTEGER NOT NULL DEFAULT 1 CHECK (governance_revision >= 1);
ALTER TABLE v7_character_model_calls ADD COLUMN temperature REAL CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 1);
ALTER TABLE v7_creation_model_calls ADD COLUMN governance_revision INTEGER NOT NULL DEFAULT 1 CHECK (governance_revision >= 1);
ALTER TABLE v7_creation_model_calls ADD COLUMN temperature REAL CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 1);
ALTER TABLE v7_book_title_design_calls ADD COLUMN governance_revision INTEGER NOT NULL DEFAULT 1 CHECK (governance_revision >= 1);
ALTER TABLE v7_book_title_design_calls ADD COLUMN temperature REAL CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 1);
ALTER TABLE v7_book_cover_designs ADD COLUMN governance_revision INTEGER NOT NULL DEFAULT 1 CHECK (governance_revision >= 1);
ALTER TABLE v7_book_cover_designs ADD COLUMN chief_temperature REAL CHECK (chief_temperature IS NULL OR chief_temperature BETWEEN 0 AND 1);
ALTER TABLE v7_book_cover_designs ADD COLUMN visual_temperature REAL CHECK (visual_temperature IS NULL OR visual_temperature BETWEEN 0 AND 1);
