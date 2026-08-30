-- 冻结每次任务明确选择的 Skill 键；历史合同保持空列表并继续可读。
DROP TRIGGER IF EXISTS v7_task_contracts_content_immutable;

ALTER TABLE v7_task_contracts
  ADD COLUMN selected_skill_keys_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(selected_skill_keys_json));

CREATE TRIGGER v7_task_contracts_content_immutable
BEFORE UPDATE OF contract_id,version,owner_id,book_id,task_id,task_kind,workstation_key,operation_mode,
  objective,must_preserve_json,allowed_changes_json,forbidden_changes_json,success_criteria_json,
  output_contract_json,selected_skill_keys_json,author_instruction_version,based_on_task_id,content_hash,created_at
ON v7_task_contracts
BEGIN
  SELECT RAISE(ABORT,'V7 task contract snapshot is immutable');
END;
