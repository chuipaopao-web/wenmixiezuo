-- 明确失败的规划维护任务可以在可靠事件重试时重新交接；结果未知仍禁止重复调用。

ALTER TABLE v7_planning_maintenance_runs
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);
