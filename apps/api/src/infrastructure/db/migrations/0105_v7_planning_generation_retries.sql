-- V7 规划路线和规划树的已知失败可以在原任务上续跑；每次续跑使用新的技术尝试编号。

ALTER TABLE v7_planning_recipe_runs
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);

ALTER TABLE v7_planning_generation_runs
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);
