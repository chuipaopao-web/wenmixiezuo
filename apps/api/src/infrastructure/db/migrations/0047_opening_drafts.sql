-- 建书向导草稿跟随账号保存在服务器。
-- 背景：草稿此前只存浏览器 localStorage，浏览器自动清理或换设备后作者必须重填。
-- 每个 owner 最多一份草稿，整行覆盖更新；书籍创建成功后删除。

CREATE TABLE opening_drafts (
  owner_id TEXT PRIMARY KEY REFERENCES owners(owner_id),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
