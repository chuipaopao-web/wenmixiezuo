-- V7创作成员偏好收口到全局固定岗位。
-- 只做增量迁移：保留旧表和旧快照，新任务写入固定岗位偏好表。

CREATE TABLE v7_creation_fixed_member_preferences (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK (role_key IN (
    'context_editor','chief_editor','planning_writer',
    'lead_writer','independent_reviewer','settlement_editor'
  )),
  member_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id,book_id,workflow_id,role_key),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id)
) STRICT;

INSERT OR IGNORE INTO v7_creation_fixed_member_preferences(
  owner_id,book_id,workflow_id,role_key,member_key,created_at,updated_at
)
SELECT owner_id,book_id,workflow_id,
  CASE role_key WHEN 'outline_writer' THEN 'planning_writer' ELSE role_key END,
  member_key,created_at,updated_at
FROM v7_creation_member_preferences
WHERE role_key IN (
  'context_editor','chief_editor','outline_writer',
  'lead_writer','independent_reviewer','settlement_editor'
);

INSERT OR IGNORE INTO v7_creation_option_member_preferences(
  owner_id,book_id,workflow_id,option_seat_key,member_key,created_at,updated_at
)
SELECT owner_id,book_id,workflow_id,
  CASE role_key
    WHEN 'structure_writer' THEN 'option_1'
    WHEN 'commercial_writer' THEN 'option_2'
    WHEN 'character_writer' THEN 'option_3'
  END,
  member_key,created_at,updated_at
FROM v7_creation_member_preferences
WHERE role_key IN ('structure_writer','commercial_writer','character_writer');
