#!/usr/bin/env bash
set -euo pipefail
sqlite3 /opt/wenmi/data/database/wenmi.sqlite <<'SQL'
BEGIN IMMEDIATE;
UPDATE user_accounts SET role = 'admin', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email_normalized = '595341366@qq.com' AND role = 'user';
UPDATE user_accounts SET role = 'user',  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email_normalized = '1746495718@qq.com' AND role = 'admin';
COMMIT;
SELECT email_normalized, role, status FROM user_accounts ORDER BY created_at;
SQL
echo "backup after change:"
ls -la /opt/wenmi/data/backups/ 2>/dev/null | tail -3 || true
