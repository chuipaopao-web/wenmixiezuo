-- 067bbc24收尾决定：一次性墙钟补充持久化（原started_at与原60分钟记录不改，重启不能重新计时，不能循环延长）。
CREATE TABLE tm2_eval_budget_ext(
  batch_id TEXT NOT NULL PRIMARY KEY,
  extension_started_at TEXT NOT NULL,
  extension_ms INTEGER NOT NULL CHECK(extension_ms>0),
  reason TEXT NOT NULL
) STRICT;
