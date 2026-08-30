-- V7卷/链三方案任务席位成员偏好。
-- 固定岗位统一为 planning_writer；席位只表示本轮方案一、二、三，不是岗位或人设。

CREATE TABLE v7_creation_option_member_preferences (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  option_seat_key TEXT NOT NULL CHECK (option_seat_key IN ('option_1','option_2','option_3')),
  member_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id,book_id,workflow_id,option_seat_key),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (workflow_id) REFERENCES v7_creation_workflows(workflow_id)
) STRICT;

