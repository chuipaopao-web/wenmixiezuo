-- MODEL-NODE-EVAL（2026-09-16老板授权）：节点×模型评测记录、排名版本与节点派工策略。
-- 纯增量，不改旧数据。密钥与思维链不入库；评测一律用合成资料，不引用真实作品内容。
-- 评测数据是全站运营数据（非作者作品），按owner='_system'单行/多行存储，不引入作者书维度。

-- 评测批次/执行：一次"节点×模型×配置版本"的评测过程。预算预留/实耗/未知分开持久化，进程重启不归零。
CREATE TABLE tm2_eval_run(
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
  status TEXT NOT NULL CHECK(status IN ('queued','working','succeeded','failed','stopped','budget-stopped')),
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
CREATE INDEX tm2_eval_run_node ON tm2_eval_run(node_key,length_band,config_version,phase);
CREATE INDEX tm2_eval_run_batch ON tm2_eval_run(batch_id);

-- 单样本结果：一行一次真实调用（含评审调用单独成行）。断点续传按(run_id,sample_hash,attempt_seq)幂等。
CREATE TABLE tm2_eval_case(
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  model_profile_key TEXT NOT NULL,
  sample_hash TEXT NOT NULL,
  attempt_seq INTEGER NOT NULL DEFAULT 1 CHECK(attempt_seq>=1),
  genre TEXT NOT NULL,
  length_band TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  sample_kind TEXT NOT NULL CHECK(sample_kind IN ('positive','negative')),
  input_hash TEXT NOT NULL,
  config_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  http_status INTEGER,
  outcome TEXT NOT NULL CHECK(outcome IN ('ok','truncated','timeout','http_error','auth_error','parse_error','contract_error','unknown','rate_limited')),
  technical_ok INTEGER NOT NULL CHECK(technical_ok IN (0,1)),
  contract_ok INTEGER CHECK(contract_ok IN (0,1)),
  quality_pass INTEGER CHECK(quality_pass IN (0,1)),
  quality_note TEXT,
  judge_source TEXT,
  judge_model_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  usage_known INTEGER NOT NULL CHECK(usage_known IN (0,1)),
  reserved_tokens INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  queue_ms INTEGER,
  duration_ms INTEGER,
  error_code TEXT,
  artifact_path TEXT,
  provider_model_version TEXT,
  PRIMARY KEY(id),
  UNIQUE(run_id,sample_hash,attempt_seq)
) STRICT;
CREATE INDEX tm2_eval_case_run ON tm2_eval_case(run_id);
CREATE INDEX tm2_eval_case_node ON tm2_eval_case(node_key,model_profile_key,config_version);

-- 批次级预算账本：预留+实耗+未知分开持久化，重启不归零；硬停判断以本表为准。
CREATE TABLE tm2_eval_budget(
  batch_id TEXT NOT NULL,
  reserved_requests INTEGER NOT NULL DEFAULT 0 CHECK(reserved_requests>=0),
  actual_requests INTEGER NOT NULL DEFAULT 0 CHECK(actual_requests>=0),
  unknown_requests INTEGER NOT NULL DEFAULT 0 CHECK(unknown_requests>=0),
  reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
  actual_tokens INTEGER NOT NULL DEFAULT 0 CHECK(actual_tokens>=0),
  unknown_tokens INTEGER NOT NULL DEFAULT 0 CHECK(unknown_tokens>=0),
  limit_requests INTEGER NOT NULL,
  limit_tokens INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(batch_id)
) STRICT;

-- 排名版本：node_key+length_band+config_version维度的可审查排名，应用/回滚只影响新任务快照。
CREATE TABLE tm2_eval_ranking(
  id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  length_band TEXT NOT NULL,
  config_version TEXT NOT NULL,
  ranking_revision INTEGER NOT NULL CHECK(ranking_revision>0),
  status TEXT NOT NULL CHECK(status IN ('draft','applied','rolled_back','superseded')),
  entries_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  rolled_back_at TEXT,
  PRIMARY KEY(id),
  UNIQUE(node_key,length_band,config_version,ranking_revision)
) STRICT;

-- 节点派工策略：某模型在某节点的状态（在岗/暂停待复测）。应用排名时写入，运行时装配读取。
CREATE TABLE tm2_eval_node_policy(
  node_key TEXT NOT NULL,
  model_profile_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','suspended','pending_retest')),
  reason TEXT NOT NULL,
  ranking_revision INTEGER,
  policy_version INTEGER NOT NULL CHECK(policy_version>0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(node_key,model_profile_key)
) STRICT;
