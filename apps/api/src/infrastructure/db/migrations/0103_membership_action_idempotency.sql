-- 管理员办理/续费/撤销会员的请求幂等键。
-- 历史流水保持原样（NULL）；新客户端带键后，网络重试不能重复顺延会员或重复记收入。

ALTER TABLE membership_transactions ADD COLUMN idempotency_key TEXT
  CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 128);

CREATE UNIQUE INDEX membership_transactions_actor_idempotency_idx
  ON membership_transactions(actor_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
