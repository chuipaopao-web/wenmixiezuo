-- 明确失败的人物资料任务允许人工重试；结果未知仍禁止重调。

ALTER TABLE v7_character_context_packs
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);

ALTER TABLE v7_character_maintenance_runs
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);
