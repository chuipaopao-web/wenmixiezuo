-- AUTH-TAKEOVER-01：密码哈希参数列与凭据版本（scrypt-v2 接管）。
-- password_format/n/r/p：NULL=历史v1参数（n=16384,r=8,p=1，与rebuild "scrypt-v1-legacy"逐字节一致）；
-- 登录成功后透明升级为 v2（n=32768,r=8,p=3），参数随行存储，rebuild域实现可直接验证。
-- credential_version：凭据版本号，登录/改密在异步哈希后按版本CAS写入，防止并发改密被旧登录覆盖。
ALTER TABLE user_accounts ADD password_format TEXT;
ALTER TABLE user_accounts ADD password_n INTEGER;
ALTER TABLE user_accounts ADD password_r INTEGER;
ALTER TABLE user_accounts ADD password_p INTEGER;
ALTER TABLE user_accounts ADD credential_version INTEGER NOT NULL DEFAULT 0;

-- 身份域审计事件扩展（改密/撤销会话/登录拒绝）：重建表以放宽event_type CHECK，历史审计保留。
CREATE TABLE auth_audit_events_v2 (
  audit_id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'register', 'login_success', 'login_failed', 'login_rejected', 'logout',
    'user_suspended', 'user_reactivated', 'password_changed', 'password_change_failed', 'sessions_revoked'
  )),
  email_normalized TEXT,
  actor_user_id TEXT,
  recorded_at TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  FOREIGN KEY (user_id) REFERENCES user_accounts(user_id),
  FOREIGN KEY (actor_user_id) REFERENCES user_accounts(user_id)
) STRICT;
INSERT INTO auth_audit_events_v2 SELECT * FROM auth_audit_events;
DROP TABLE auth_audit_events;
ALTER TABLE auth_audit_events_v2 RENAME TO auth_audit_events;
CREATE INDEX auth_audit_recorded_idx ON auth_audit_events(recorded_at DESC);
