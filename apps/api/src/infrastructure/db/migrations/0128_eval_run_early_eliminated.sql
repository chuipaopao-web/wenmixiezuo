-- MODEL-NODE-EVAL执行补充（2026-09-16老板六点补充第3条）：run终态增加early-eliminated。
-- 某模型在固定样本数下已不可能达到资格门槛（一次技术交付>=90%）时，停止该节点剩余资格测试并如实标记；
-- 按节点×模型判定，不跨节点一概淘汰。SQLite不能改CHECK，按原列定义重建表，已有评测数据全量保留。

CREATE TABLE tm2_eval_run_new(
  id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  length_band TEXT NOT NULL CHECK(length_band IN ('short','medium','long','all')),
  member_role TEXT NOT NULL,
  model_profile_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_plan TEXT NOT NULL,
  config_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('screen','validation')),
  status TEXT NOT NULL CHECK(status IN ('queued','working','succeeded','failed','stopped','budget-stopped','early-eliminated')),
  sample_set_id TEXT NOT NULL,
  planned_cases INTEGER NOT NULL CHECK(planned_cases>=0),
  done_cases INTEGER NOT NULL DEFAULT 0 CHECK(done_cases>=0),
  reserved_requests INTEGER NOT NULL DEFAULT 0 CHECK(reserved_requests>=0),
  actual_requests INTEGER NOT NULL DEFAULT 0 CHECK(actual_requests>=0),
  unknown_requests INTEGER NOT NULL DEFAULT 0 CHECK(unknown_requests>=0),
  reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
  actual_tokens INTEGER NOT NULL DEFAULT 0 CHECK(actual_tokens>=0),
  unknown_tokens INTEGER NOT NULL DEFAULT 0 CHECK(unknown_tokens>=0),
  stop_reason TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  PRIMARY KEY(id)
) STRICT;
INSERT INTO tm2_eval_run_new SELECT * FROM tm2_eval_run;
DROP TABLE tm2_eval_run;
ALTER TABLE tm2_eval_run_new RENAME TO tm2_eval_run;
CREATE INDEX tm2_eval_run_node ON tm2_eval_run(node_key,length_band,config_version,phase);
CREATE INDEX tm2_eval_run_batch ON tm2_eval_run(batch_id);
