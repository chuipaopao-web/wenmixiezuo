-- 批3：结算后续任务产物表。
-- 事件或卷结算完成后，团队接着做两件事：
--   主编（貂蝉）出节奏体检报告（pacing_report_json）；
--   副编（西施）把结算结果写成作者能直接看的大白话摘要（summary_text）。
-- 每个结算对象只保留一份最新后续产物，任务级幂等由 task_id 唯一约束保证。

CREATE TABLE settlement_follow_ups (
  follow_up_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  stage_kind TEXT NOT NULL CHECK (stage_kind IN ('event', 'volume')),
  stage_object_id TEXT NOT NULL,
  settlement_id TEXT NOT NULL,
  task_id TEXT NOT NULL UNIQUE,
  pacing_report_json TEXT CHECK (pacing_report_json IS NULL OR json_valid(pacing_report_json)),
  summary_text TEXT,
  pacing_agent_id TEXT,
  pacing_model_snapshot_id TEXT,
  summary_agent_id TEXT,
  summary_model_snapshot_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  UNIQUE (owner_id, book_id, stage_kind, stage_object_id)
) STRICT;

CREATE INDEX settlement_follow_ups_book_idx
  ON settlement_follow_ups(owner_id, book_id, stage_kind);
