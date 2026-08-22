-- V6 AI 编辑部：岗位池、三层 Skill、节点作者输入、公平资料包批次和可恢复成员结果。
-- 只引用既有 agent/model/task/context_pack 权威表，不保存 API Key，不复制 ContextPack 内容。

CREATE TABLE agent_role_pools_v6 (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK (role_key IN ('chief_editor','deputy_editor','screenwriter','writer','fact_reviewer','literary_reviewer','experience_reviewer')),
  desired_count INTEGER NOT NULL CHECK (desired_count BETWEEN 1 AND 20),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id,book_id,role_key),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;

CREATE TABLE agent_member_settings_v6 (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK (role_key IN ('chief_editor','deputy_editor','screenwriter','writer','fact_reviewer','literary_reviewer','experience_reviewer')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  supplier_company TEXT NOT NULL,
  base_cost_tier TEXT NOT NULL CHECK (base_cost_tier IN ('low','medium','high')),
  avatar_key TEXT NOT NULL,
  display_order INTEGER NOT NULL CHECK (display_order > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id,book_id,agent_id),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id)
) STRICT;
CREATE INDEX agent_member_settings_v6_pool_idx ON agent_member_settings_v6(owner_id,book_id,role_key,enabled,display_order);

CREATE TABLE agent_skill_versions_v6 (
  skill_version_id TEXT PRIMARY KEY,
  layer TEXT NOT NULL CHECK (layer IN ('core','role','node_protocol')),
  role_key TEXT,
  node_kind TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  status TEXT NOT NULL CHECK (status IN ('active','superseded','archived')),
  created_at TEXT NOT NULL,
  UNIQUE(layer,role_key,node_kind,version)
) STRICT;

CREATE TABLE ai_node_author_inputs_v6 (
  author_input_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  node_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash)=64),
  status TEXT NOT NULL CHECK (status IN ('active','superseded','archived')),
  created_at TEXT NOT NULL,
  UNIQUE(owner_id,book_id,node_kind,object_id,version),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;
CREATE UNIQUE INDEX ai_node_author_inputs_v6_active_idx ON ai_node_author_inputs_v6(owner_id,book_id,node_kind,object_id) WHERE status='active';

CREATE TABLE ai_node_batches_v6 (
  batch_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  node_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  batch_version INTEGER NOT NULL CHECK (batch_version > 0),
  role_key TEXT NOT NULL CHECK (role_key IN ('chief_editor','deputy_editor','screenwriter','writer','fact_reviewer','literary_reviewer','experience_reviewer')),
  task_id TEXT NOT NULL,
  context_pack_id TEXT NOT NULL,
  context_pack_hash TEXT NOT NULL CHECK (length(context_pack_hash)=64),
  author_input_id TEXT,
  author_input_version INTEGER NOT NULL DEFAULT 0 CHECK (author_input_version >= 0),
  core_skill_version_id TEXT NOT NULL,
  role_skill_version_id TEXT NOT NULL,
  node_protocol_version_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  source_version_ids_json TEXT NOT NULL CHECK (json_valid(source_version_ids_json)),
  estimated_cost_tier TEXT NOT NULL CHECK (estimated_cost_tier IN ('low','medium','high')),
  estimated_cost_units INTEGER NOT NULL CHECK (estimated_cost_units > 0),
  status TEXT NOT NULL CHECK (status IN ('queued','working','partial_success','completed','failed','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id),
  FOREIGN KEY (context_pack_id) REFERENCES context_packs(context_pack_id),
  FOREIGN KEY (author_input_id) REFERENCES ai_node_author_inputs_v6(author_input_id),
  FOREIGN KEY (core_skill_version_id) REFERENCES agent_skill_versions_v6(skill_version_id),
  FOREIGN KEY (role_skill_version_id) REFERENCES agent_skill_versions_v6(skill_version_id),
  FOREIGN KEY (node_protocol_version_id) REFERENCES agent_skill_versions_v6(skill_version_id),
  UNIQUE(owner_id,book_id,node_kind,object_id,batch_version)
) STRICT;
CREATE INDEX ai_node_batches_v6_scope_idx ON ai_node_batches_v6(owner_id,book_id,node_kind,object_id,created_at DESC);

CREATE TABLE ai_node_batch_members_v6 (
  batch_member_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model_snapshot_id TEXT NOT NULL,
  model_signature_hash TEXT NOT NULL CHECK (length(model_signature_hash)=64),
  context_pack_id TEXT NOT NULL,
  context_pack_hash TEXT NOT NULL CHECK (length(context_pack_hash)=64),
  status TEXT NOT NULL CHECK (status IN ('queued','working','completed','failed','unavailable','replaced')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_class TEXT,
  failure_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (batch_id) REFERENCES ai_node_batches_v6(batch_id),
  FOREIGN KEY (agent_id) REFERENCES agent_instances(agent_id),
  FOREIGN KEY (model_snapshot_id) REFERENCES model_config_snapshots(model_snapshot_id),
  FOREIGN KEY (context_pack_id) REFERENCES context_packs(context_pack_id),
  UNIQUE(batch_id,agent_id),
  UNIQUE(batch_id,model_signature_hash)
) STRICT;
CREATE INDEX ai_node_batch_members_v6_progress_idx ON ai_node_batch_members_v6(batch_id,status,created_at);

CREATE TABLE ai_node_results_v6 (
  result_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  batch_member_id TEXT NOT NULL,
  candidate_kind TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  result_hash TEXT NOT NULL CHECK (length(result_hash)=64),
  author_summary_json TEXT NOT NULL CHECK (json_valid(author_summary_json)),
  status TEXT NOT NULL CHECK (status IN ('candidate','selected','archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (batch_id) REFERENCES ai_node_batches_v6(batch_id),
  FOREIGN KEY (batch_member_id) REFERENCES ai_node_batch_members_v6(batch_member_id),
  UNIQUE(batch_member_id,result_hash)
) STRICT;
