-- 发布渠道在开书任务创建时冻结，只影响商业包装表达，不改变作者原始创作事实。
ALTER TABLE v7_opening_agent_tasks
  ADD COLUMN publishing_platform TEXT NOT NULL DEFAULT 'fanqie'
  CHECK (publishing_platform IN ('fanqie', 'qidian', 'mainstream'));

-- 成员补充提示在独立后台公开可查、可审计；岗位基础提示和安全合同仍由代码固定。
ALTER TABLE v7_opening_agent_member_settings
  ADD COLUMN prompt_instruction TEXT NOT NULL DEFAULT ''
  CHECK (length(prompt_instruction) <= 4000);
