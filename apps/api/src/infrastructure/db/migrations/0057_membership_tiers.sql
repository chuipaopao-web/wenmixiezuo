-- 会员等级改版（2026-08-20 老板拍板）：包月/包季/包年 → 青铜/白银/黄金/钻石四档。
-- 配额口径改为算力值：算力值 = 真实 token × 2（usage_ledger 永远记真实 token，前台按双倍展示）。
-- 青铜 20万算力值（免费体验）/ 白银 98元 2000万 / 黄金 198元 5000万 / 钻石 980元 2亿。
-- 现有生效会员全部调整为钻石会员；已撤销记录只改套餐名满足新约束（仍为撤销状态，不生效）。

CREATE TABLE user_memberships_0057 (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(user_id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL UNIQUE REFERENCES owners(owner_id),
  plan TEXT NOT NULL CHECK (plan IN ('bronze', 'silver', 'gold', 'diamond')),
  token_quota INTEGER NOT NULL CHECK (token_quota > 0),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
  granted_by_user_id TEXT NOT NULL REFERENCES user_accounts(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO user_memberships_0057 (
  user_id, owner_id, plan, token_quota, period_start, period_end, status, granted_by_user_id, created_at, updated_at
)
SELECT user_id, owner_id,
  CASE WHEN status = 'active' THEN 'diamond' ELSE 'bronze' END,
  CASE WHEN status = 'active' THEN 200000000 ELSE 200000 END,
  period_start, period_end, status, granted_by_user_id, created_at, updated_at
FROM user_memberships;

DROP TABLE user_memberships;
ALTER TABLE user_memberships_0057 RENAME TO user_memberships;

CREATE INDEX idx_user_memberships_owner ON user_memberships(owner_id, status);

-- 从未开过会员的历史普通账号补发青铜体验（20万算力值，长期有效），
-- 避免老账号一登录就被会员门禁挡死；新注册账号由注册流程发放青铜。
INSERT INTO user_memberships (
  user_id, owner_id, plan, token_quota, period_start, period_end, status, granted_by_user_id, created_at, updated_at
)
SELECT a.user_id, a.owner_id, 'bronze', 200000, a.created_at, '2099-12-31T00:00:00.000Z', 'active', a.user_id, a.created_at, a.created_at
FROM user_accounts a
WHERE a.role = 'user'
  AND NOT EXISTS (SELECT 1 FROM user_memberships m WHERE m.user_id = a.user_id);
