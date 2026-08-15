-- 会员与算力值（token 配额）体系。
-- 每个账号最多一条会员记录；管理员开通/续费时整行覆盖（重新计周期与配额）。
-- 算力值 = 模型调用 token（输入+输出），按会员周期内 usage_ledger 聚合。

CREATE TABLE user_memberships (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(user_id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL UNIQUE REFERENCES owners(owner_id),
  plan TEXT NOT NULL CHECK (plan IN ('monthly', 'quarterly', 'yearly')),
  token_quota INTEGER NOT NULL CHECK (token_quota > 0),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
  granted_by_user_id TEXT NOT NULL REFERENCES user_accounts(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_user_memberships_owner ON user_memberships(owner_id, status);
