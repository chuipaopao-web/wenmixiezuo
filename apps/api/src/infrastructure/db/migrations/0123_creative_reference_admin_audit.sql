-- R209-B2 管理闭环：管理操作审计与发布幂等。
-- 只记录管理员对本库的动作、目标、实际actor、时间、简短意见与结果引用；不存密钥/作者作品/思维链。
CREATE TABLE creative_reference_admin_audit (
  audit_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('create','revise','review','retire','restore','publish')),
  target_id TEXT,
  target_revision INTEGER,
  actor_id TEXT NOT NULL,
  opinion TEXT,
  result_ref TEXT,
  idempotency_key TEXT,
  request_digest TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX creative_reference_admin_audit_target ON creative_reference_admin_audit(target_id, created_at);
CREATE INDEX creative_reference_admin_audit_idem ON creative_reference_admin_audit(action, idempotency_key);
CREATE TABLE creative_reference_release_requests (
  request_key TEXT PRIMARY KEY,
  request_digest TEXT NOT NULL,
  release_id TEXT,
  created_at TEXT NOT NULL
) STRICT;
