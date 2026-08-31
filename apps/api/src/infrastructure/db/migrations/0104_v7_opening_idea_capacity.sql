-- wenmi-migration: foreign-keys-off
-- design_review_id: DR-V7-AUTHOR-WORKFLOW-71
-- V7 作者端与 API 已经承诺开书想法最多 2000 字，但 0070 建表时仍保留
-- 800 字旧约束。这里仅前向重建任务父表，保留全部任务、检查点、成员快照、
-- 发布平台以及候选/模型调用对子表的引用，不改写任何历史迁移或作者内容。
CREATE TABLE v7_opening_agent_tasks_next (
  task_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  idea_text TEXT NOT NULL CHECK (length(idea_text) BETWEEN 4 AND 2000),
  idea_version INTEGER NOT NULL DEFAULT 1 CHECK (idea_version >= 1),
  idea_hash TEXT NOT NULL CHECK (length(idea_hash) = 64),
  selected_chief_member_key TEXT,
  selected_screenwriter_member_key TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'working', 'awaiting_author_confirmation', 'awaiting_author_decision', 'failed', 'interrupted'
  )),
  phase TEXT NOT NULL,
  state_json TEXT CHECK (state_json IS NULL OR json_valid(state_json)),
  lease_token TEXT,
  lease_expires_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  member_roster_json TEXT CHECK (member_roster_json IS NULL OR json_valid(member_roster_json)),
  publishing_platform TEXT NOT NULL DEFAULT 'fanqie'
    CHECK (publishing_platform IN ('fanqie', 'qidian', 'mainstream')),
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id),
  UNIQUE (owner_id, idempotency_key)
) STRICT;

INSERT INTO v7_opening_agent_tasks_next (
  task_id, owner_id, idempotency_key, request_hash, idea_text, idea_version, idea_hash,
  selected_chief_member_key, selected_screenwriter_member_key, status, phase, state_json,
  lease_token, lease_expires_at, error_code, error_message, created_at, updated_at,
  member_roster_json, publishing_platform
)
SELECT
  task_id, owner_id, idempotency_key, request_hash, idea_text, idea_version, idea_hash,
  selected_chief_member_key, selected_screenwriter_member_key, status, phase, state_json,
  lease_token, lease_expires_at, error_code, error_message, created_at, updated_at,
  member_roster_json, publishing_platform
FROM v7_opening_agent_tasks;

DROP TABLE v7_opening_agent_tasks;
ALTER TABLE v7_opening_agent_tasks_next RENAME TO v7_opening_agent_tasks;

CREATE INDEX v7_opening_agent_tasks_owner_status_idx
  ON v7_opening_agent_tasks(owner_id, status, updated_at);
