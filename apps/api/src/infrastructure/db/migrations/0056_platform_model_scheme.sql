-- 平台级模型方案：管理后台保存的全员模型安排，新书写入与存量书收敛都以它为准；历史调用快照不受影响。
CREATE TABLE platform_model_scheme (
  scheme_id TEXT PRIMARY KEY,
  profiles_json TEXT NOT NULL CHECK (json_valid(profiles_json)),
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL
) STRICT;
