-- design_review_id: DR-V7-20260829-53-SETTING-AUTHOR-REVISION
-- 作者端允许提交最多2000字的完整设定修改稿；旧author_note只允许800字，
-- 会在创建可恢复复审任务前触发CHECK失败。本迁移只放宽该任务快照容量，
-- 原表数据、任务ID、状态、版本和外键全部原样保留。
CREATE TABLE v7_setting_item_jobs_next (
  job_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT NOT NULL, batch_id TEXT NOT NULL,
  item_key TEXT NOT NULL, item_label TEXT NOT NULL, group_title TEXT NOT NULL, item_prompt TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','working','chief_review','needs_author','confirmed','failed')),
  assigned_member_key TEXT, previous_member_key TEXT, attempted_members_json TEXT NOT NULL CHECK (json_valid(attempted_members_json)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  author_note TEXT NOT NULL DEFAULT '' CHECK (length(author_note) <= 3200),
  context_manifest_json TEXT CHECK (context_manifest_json IS NULL OR json_valid(context_manifest_json)), context_hash TEXT,
  active_output_id TEXT, revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES user_accounts(owner_id), FOREIGN KEY (book_id) REFERENCES books(book_id),
  FOREIGN KEY (batch_id) REFERENCES v7_setting_batches(batch_id), UNIQUE (owner_id, book_id, batch_id, item_key)
) STRICT;

INSERT INTO v7_setting_item_jobs_next (
  job_id,owner_id,book_id,batch_id,item_key,item_label,group_title,item_prompt,state,
  assigned_member_key,previous_member_key,attempted_members_json,attempt_count,author_note,
  context_manifest_json,context_hash,active_output_id,revision,created_at,updated_at
)
SELECT
  job_id,owner_id,book_id,batch_id,item_key,item_label,group_title,item_prompt,state,
  assigned_member_key,previous_member_key,attempted_members_json,attempt_count,author_note,
  context_manifest_json,context_hash,active_output_id,revision,created_at,updated_at
FROM v7_setting_item_jobs;

DROP TABLE v7_setting_item_jobs;
ALTER TABLE v7_setting_item_jobs_next RENAME TO v7_setting_item_jobs;
CREATE INDEX v7_setting_item_jobs_batch_idx ON v7_setting_item_jobs(owner_id, book_id, batch_id, state);
