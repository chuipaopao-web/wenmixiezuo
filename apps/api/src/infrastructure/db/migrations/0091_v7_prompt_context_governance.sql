-- design_review_id: DR-V7-PROMPT-CONTEXT-GOVERNANCE-20260828-50
-- V7提示资产、任务合同、资料包与运行时提示快照治理。
-- 仅新增独立表；不删除或改写既有prompt_instruction和模型调用记录。

CREATE TABLE v7_prompt_governance_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO v7_prompt_governance_meta(singleton,revision,updated_by,updated_at)
VALUES(1,1,'system',CURRENT_TIMESTAMP);

CREATE TABLE v7_prompt_asset_versions (
  asset_id TEXT PRIMARY KEY,
  asset_key TEXT NOT NULL CHECK (length(trim(asset_key)) BETWEEN 3 AND 160),
  kind TEXT NOT NULL CHECK (kind IN ('role_prompt','workstation_prompt','genre_persona','skill')),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft','published','retired')),
  governance_revision INTEGER NOT NULL CHECK (governance_revision >= 1),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 1000),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  based_on_asset_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT,
  retired_by TEXT,
  retired_at TEXT,
  UNIQUE(asset_key,version),
  FOREIGN KEY (based_on_asset_id) REFERENCES v7_prompt_asset_versions(asset_id)
) STRICT;
CREATE UNIQUE INDEX v7_prompt_asset_one_published_idx
  ON v7_prompt_asset_versions(asset_key) WHERE status='published';
CREATE INDEX v7_prompt_asset_key_status_version_idx
  ON v7_prompt_asset_versions(asset_key,status,version DESC);
CREATE INDEX v7_prompt_asset_kind_status_idx
  ON v7_prompt_asset_versions(kind,status,asset_key);

CREATE TRIGGER v7_prompt_asset_versions_no_delete
BEFORE DELETE ON v7_prompt_asset_versions
BEGIN
  SELECT RAISE(ABORT,'V7 prompt asset history is immutable');
END;

CREATE TRIGGER v7_prompt_asset_versions_content_immutable
BEFORE UPDATE OF asset_id,asset_key,kind,version,governance_revision,title,summary,content_json,content_hash,based_on_asset_id,created_by,created_at
ON v7_prompt_asset_versions
BEGIN
  SELECT RAISE(ABORT,'V7 prompt asset snapshot is immutable');
END;

CREATE TRIGGER v7_prompt_asset_versions_status_transition
BEFORE UPDATE OF status ON v7_prompt_asset_versions
WHEN NOT (
  NEW.status = OLD.status OR
  (OLD.status='draft' AND NEW.status IN ('published','retired')) OR
  (OLD.status='published' AND NEW.status='retired')
)
BEGIN
  SELECT RAISE(ABORT,'V7 prompt asset status transition is invalid');
END;

CREATE TABLE v7_book_genre_profiles (
  profile_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('candidate','active','superseded')),
  primary_genre_key TEXT NOT NULL,
  supporting_genre_keys_json TEXT NOT NULL CHECK (json_valid(supporting_genre_keys_json)),
  source_asset_version_ids_json TEXT NOT NULL CHECK (json_valid(source_asset_version_ids_json)),
  source_book_version INTEGER NOT NULL CHECK (source_book_version >= 0),
  public_label TEXT NOT NULL,
  working_identity TEXT NOT NULL,
  primary_promise TEXT NOT NULL,
  supporting_functions_json TEXT NOT NULL CHECK (json_valid(supporting_functions_json)),
  writing_priorities_json TEXT NOT NULL CHECK (json_valid(writing_priorities_json)),
  authenticity_checks_json TEXT NOT NULL CHECK (json_valid(authenticity_checks_json)),
  avoid_patterns_json TEXT NOT NULL CHECK (json_valid(avoid_patterns_json)),
  conflict_resolutions_json TEXT NOT NULL CHECK (json_valid(conflict_resolutions_json)),
  compiled_by_task_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(owner_id,book_id,version),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;
CREATE UNIQUE INDEX v7_book_genre_profile_one_active_idx
  ON v7_book_genre_profiles(owner_id,book_id) WHERE status='active';
CREATE INDEX v7_book_genre_profile_scope_status_idx
  ON v7_book_genre_profiles(owner_id,book_id,status,version DESC);

CREATE TRIGGER v7_book_genre_profiles_no_delete
BEFORE DELETE ON v7_book_genre_profiles
BEGIN
  SELECT RAISE(ABORT,'V7 genre profile history is immutable');
END;

CREATE TRIGGER v7_book_genre_profiles_content_immutable
BEFORE UPDATE OF profile_id,owner_id,book_id,version,primary_genre_key,supporting_genre_keys_json,
  source_asset_version_ids_json,source_book_version,public_label,working_identity,primary_promise,
  supporting_functions_json,writing_priorities_json,authenticity_checks_json,avoid_patterns_json,
  conflict_resolutions_json,compiled_by_task_id,content_hash,created_at
ON v7_book_genre_profiles
BEGIN
  SELECT RAISE(ABORT,'V7 genre profile snapshot is immutable');
END;

CREATE TABLE v7_task_contracts (
  contract_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  workstation_key TEXT NOT NULL,
  operation_mode TEXT NOT NULL CHECK (operation_mode IN ('fresh','revise','fusion','repair','retry')),
  objective TEXT NOT NULL CHECK (length(trim(objective)) > 0),
  must_preserve_json TEXT NOT NULL CHECK (json_valid(must_preserve_json)),
  allowed_changes_json TEXT NOT NULL CHECK (json_valid(allowed_changes_json)),
  forbidden_changes_json TEXT NOT NULL CHECK (json_valid(forbidden_changes_json)),
  success_criteria_json TEXT NOT NULL CHECK (json_valid(success_criteria_json)),
  output_contract_json TEXT NOT NULL CHECK (json_valid(output_contract_json)),
  author_instruction_version INTEGER CHECK (author_instruction_version IS NULL OR author_instruction_version >= 1),
  based_on_task_id TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active','superseded','archived')),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(owner_id,book_id,task_id,version),
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;
CREATE INDEX v7_task_contract_scope_task_idx
  ON v7_task_contracts(owner_id,book_id,task_id,version DESC);
CREATE INDEX v7_task_contract_kind_idx
  ON v7_task_contracts(task_kind,workstation_key,created_at DESC);

CREATE TRIGGER v7_task_contracts_no_delete
BEFORE DELETE ON v7_task_contracts
BEGIN
  SELECT RAISE(ABORT,'V7 task contract history is immutable');
END;

CREATE TRIGGER v7_task_contracts_content_immutable
BEFORE UPDATE OF contract_id,version,owner_id,book_id,task_id,task_kind,workstation_key,operation_mode,
  objective,must_preserve_json,allowed_changes_json,forbidden_changes_json,success_criteria_json,
  output_contract_json,author_instruction_version,based_on_task_id,content_hash,created_at
ON v7_task_contracts
BEGIN
  SELECT RAISE(ABORT,'V7 task contract snapshot is immutable');
END;

CREATE TABLE v7_context_pack_traces (
  context_pack_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  token_budget INTEGER NOT NULL CHECK (token_budget >= 0),
  estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens >= 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active','superseded','archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id)
) STRICT;
CREATE INDEX v7_context_pack_scope_task_idx
  ON v7_context_pack_traces(owner_id,book_id,task_id,created_at DESC);
CREATE INDEX v7_context_pack_hash_idx
  ON v7_context_pack_traces(content_hash);

CREATE TABLE v7_context_source_traces (
  trace_id TEXT PRIMARY KEY,
  context_pack_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  source_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  authority TEXT NOT NULL CHECK (authority IN ('author_source','confirmed','immutable_text','derived','candidate','reference')),
  decision TEXT NOT NULL CHECK (decision IN ('included','excluded')),
  reason TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens >= 0),
  UNIQUE(context_pack_id,sequence),
  FOREIGN KEY (context_pack_id) REFERENCES v7_context_pack_traces(context_pack_id)
) STRICT;
CREATE INDEX v7_context_source_pack_idx
  ON v7_context_source_traces(context_pack_id,sequence);
CREATE INDEX v7_context_source_lookup_idx
  ON v7_context_source_traces(source_type,source_id,source_version);

CREATE TRIGGER v7_context_pack_traces_no_delete
BEFORE DELETE ON v7_context_pack_traces
BEGIN
  SELECT RAISE(ABORT,'V7 context pack history is immutable');
END;

CREATE TRIGGER v7_context_pack_traces_content_immutable
BEFORE UPDATE OF context_pack_id,owner_id,book_id,task_id,policy_version,token_budget,estimated_tokens,
  content_json,content_hash,created_at
ON v7_context_pack_traces
BEGIN
  SELECT RAISE(ABORT,'V7 context pack snapshot is immutable');
END;

CREATE TRIGGER v7_context_source_traces_no_update
BEFORE UPDATE ON v7_context_source_traces
BEGIN
  SELECT RAISE(ABORT,'V7 context source trace is immutable');
END;

CREATE TRIGGER v7_context_source_traces_no_delete
BEFORE DELETE ON v7_context_source_traces
BEGIN
  SELECT RAISE(ABORT,'V7 context source trace is immutable');
END;

CREATE TABLE v7_prompt_manifests (
  manifest_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  member_key TEXT NOT NULL,
  role_key TEXT NOT NULL,
  workstation_key TEXT NOT NULL,
  task_kind TEXT NOT NULL,
  operation_mode TEXT NOT NULL CHECK (operation_mode IN ('fresh','revise','fusion','repair','retry')),
  role_prompt_version_id TEXT NOT NULL,
  workstation_prompt_version_id TEXT NOT NULL,
  genre_profile_id TEXT,
  genre_profile_version INTEGER CHECK (genre_profile_version IS NULL OR genre_profile_version >= 1),
  skill_version_ids_json TEXT NOT NULL CHECK (json_valid(skill_version_ids_json)),
  task_contract_id TEXT NOT NULL,
  task_contract_version INTEGER NOT NULL CHECK (task_contract_version >= 1),
  context_pack_id TEXT NOT NULL,
  context_pack_hash TEXT NOT NULL CHECK (length(context_pack_hash) = 64),
  model_profile_key TEXT NOT NULL,
  governance_revision INTEGER NOT NULL CHECK (governance_revision >= 1),
  temperature REAL NOT NULL CHECK (temperature BETWEEN 0 AND 1),
  allowed_tools_json TEXT NOT NULL CHECK (json_valid(allowed_tools_json)),
  compiled_blocks_json TEXT NOT NULL CHECK (json_valid(compiled_blocks_json)),
  compiled_prompt TEXT NOT NULL,
  compiled_prompt_hash TEXT NOT NULL CHECK (length(compiled_prompt_hash) = 64),
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active','superseded','archived')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id,book_id) REFERENCES books(owner_id,book_id),
  FOREIGN KEY (role_prompt_version_id) REFERENCES v7_prompt_asset_versions(asset_id),
  FOREIGN KEY (workstation_prompt_version_id) REFERENCES v7_prompt_asset_versions(asset_id),
  FOREIGN KEY (genre_profile_id) REFERENCES v7_book_genre_profiles(profile_id),
  FOREIGN KEY (task_contract_id) REFERENCES v7_task_contracts(contract_id),
  FOREIGN KEY (context_pack_id) REFERENCES v7_context_pack_traces(context_pack_id)
) STRICT;
CREATE INDEX v7_prompt_manifest_scope_task_idx
  ON v7_prompt_manifests(owner_id,book_id,task_id,created_at DESC);
CREATE INDEX v7_prompt_manifest_member_task_idx
  ON v7_prompt_manifests(member_key,task_kind,created_at DESC);
CREATE INDEX v7_prompt_manifest_prompt_hash_idx
  ON v7_prompt_manifests(compiled_prompt_hash);

CREATE TRIGGER v7_prompt_manifests_no_delete
BEFORE DELETE ON v7_prompt_manifests
BEGIN
  SELECT RAISE(ABORT,'V7 prompt manifest history is immutable');
END;

CREATE TRIGGER v7_prompt_manifests_content_immutable
BEFORE UPDATE OF manifest_id,owner_id,book_id,task_id,member_key,role_key,workstation_key,task_kind,
  operation_mode,role_prompt_version_id,workstation_prompt_version_id,genre_profile_id,genre_profile_version,
  skill_version_ids_json,task_contract_id,task_contract_version,context_pack_id,context_pack_hash,
  model_profile_key,governance_revision,temperature,allowed_tools_json,compiled_blocks_json,
  compiled_prompt,compiled_prompt_hash,created_at
ON v7_prompt_manifests
BEGIN
  SELECT RAISE(ABORT,'V7 prompt manifest snapshot is immutable');
END;

CREATE TABLE v7_prompt_governance_events (
  event_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'seeded','draft_created','previewed','published','restore_draft_created',
    'genre_profile_recorded','runtime_bundle_recorded','status_changed'
  )),
  target_kind TEXT NOT NULL,
  target_key TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX v7_prompt_governance_event_target_idx
  ON v7_prompt_governance_events(target_kind,target_key,created_at DESC);
CREATE INDEX v7_prompt_governance_event_actor_idx
  ON v7_prompt_governance_events(actor_id,created_at DESC);

-- 开书发生在正式书籍建立之前，不能伪造 book_id，也不能削弱正式书籍
-- 追溯表的 owner/book 外键。把同一套不可见运行快照绑定到已有、受 owner
-- 与 task 外键保护的开书模型调用，正式建书后仍使用上面的通用追溯表。
ALTER TABLE v7_opening_agent_model_calls
  ADD COLUMN task_contract_json TEXT CHECK (task_contract_json IS NULL OR json_valid(task_contract_json));
ALTER TABLE v7_opening_agent_model_calls
  ADD COLUMN context_pack_json TEXT CHECK (context_pack_json IS NULL OR json_valid(context_pack_json));
ALTER TABLE v7_opening_agent_model_calls
  ADD COLUMN prompt_manifest_json TEXT CHECK (prompt_manifest_json IS NULL OR json_valid(prompt_manifest_json));

-- 管理员按每次模型请求唯一的 manifestId 追溯开书前快照时，不能扫描整张
-- 模型调用表。开书任务本身已有 owner/task 索引，这里只补 JSON 快照主键索引。
CREATE INDEX v7_opening_agent_model_calls_prompt_manifest_id_idx
  ON v7_opening_agent_model_calls(json_extract(prompt_manifest_json,'$.manifestId'))
  WHERE prompt_manifest_json IS NOT NULL;

CREATE TRIGGER v7_opening_prompt_bundle_immutable
BEFORE UPDATE OF task_contract_json,context_pack_json,prompt_manifest_json
ON v7_opening_agent_model_calls
WHEN OLD.task_contract_json IS NOT NULL OR OLD.context_pack_json IS NOT NULL OR OLD.prompt_manifest_json IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'V7 prebook prompt bundle is immutable');
END;

CREATE TRIGGER v7_prompt_governance_events_no_update
BEFORE UPDATE ON v7_prompt_governance_events
BEGIN
  SELECT RAISE(ABORT,'V7 prompt governance event is immutable');
END;

CREATE TRIGGER v7_prompt_governance_events_no_delete
BEFORE DELETE ON v7_prompt_governance_events
BEGIN
  SELECT RAISE(ABORT,'V7 prompt governance event is immutable');
END;
