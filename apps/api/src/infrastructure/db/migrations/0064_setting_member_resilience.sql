-- 设定协作 V3：每个编剧席位拥有独立运行状态，单席失败不再拖垮整轮。

ALTER TABLE discussion_participants ADD COLUMN run_status TEXT NOT NULL DEFAULT 'preparing'
  CHECK (run_status IN ('preparing','working','completed','failed','unavailable','paused'));
ALTER TABLE discussion_participants ADD COLUMN error_summary TEXT;
ALTER TABLE discussion_participants ADD COLUMN last_attempted_at TEXT;

UPDATE discussion_participants
SET run_status = CASE WHEN responded = 1 THEN 'completed' ELSE 'preparing' END;

CREATE INDEX discussion_participants_run_status_idx
  ON discussion_participants(owner_id, book_id, discussion_id, run_status);
