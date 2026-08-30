-- V7成员的模型、套餐与岗位能力仍由受测试保护的代码登记表定义；
-- 数据库只保存可运营的上岗、默认与备用顺序，避免后台成为任意模型注入入口。
CREATE TABLE v7_opening_agent_role_settings (
  role_key TEXT PRIMARY KEY CHECK (role_key IN ('chief_editor', 'screenwriter')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES user_accounts(user_id)
) STRICT;

CREATE TABLE v7_opening_agent_member_settings (
  member_key TEXT PRIMARY KEY,
  role_key TEXT NOT NULL CHECK (role_key IN ('chief_editor', 'screenwriter')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  default_for_role INTEGER NOT NULL CHECK (default_for_role IN (0, 1)),
  fallback_priority INTEGER NOT NULL CHECK (fallback_priority BETWEEN 1 AND 99),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (role_key) REFERENCES v7_opening_agent_role_settings(role_key),
  UNIQUE (role_key, fallback_priority)
) STRICT;

CREATE INDEX v7_opening_agent_member_settings_role_idx
  ON v7_opening_agent_member_settings(role_key, enabled DESC, fallback_priority);

CREATE TABLE v7_opening_agent_member_setting_events (
  event_id TEXT PRIMARY KEY,
  role_key TEXT NOT NULL CHECK (role_key IN ('chief_editor', 'screenwriter')),
  member_key TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  previous_role_json TEXT NOT NULL CHECK (json_valid(previous_role_json)),
  next_role_json TEXT NOT NULL CHECK (json_valid(next_role_json)),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES user_accounts(user_id),
  FOREIGN KEY (member_key) REFERENCES v7_opening_agent_member_settings(member_key)
) STRICT;

CREATE INDEX v7_opening_agent_member_events_role_created_idx
  ON v7_opening_agent_member_setting_events(role_key, created_at DESC);

INSERT INTO v7_opening_agent_role_settings (role_key, revision, created_at, updated_at) VALUES
  ('chief_editor', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('screenwriter', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO v7_opening_agent_member_settings (
  member_key, role_key, enabled, default_for_role, fallback_priority, created_at, updated_at
) VALUES
  ('chief-deepseek-v4-pro', 'chief_editor', 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('chief-glm-5-3', 'chief_editor', 1, 0, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('chief-kimi-k3', 'chief_editor', 1, 0, 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('screenwriter-deepseek-v4-pro', 'screenwriter', 1, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('screenwriter-doubao-seed-2-1-turbo', 'screenwriter', 1, 0, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('screenwriter-kimi-k3', 'screenwriter', 1, 0, 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- 任务快照只在创建时写入。后续成员上下岗不会改变运行中任务的模型和故障转移链。
ALTER TABLE v7_opening_agent_tasks
  ADD COLUMN member_roster_json TEXT CHECK (member_roster_json IS NULL OR json_valid(member_roster_json));
