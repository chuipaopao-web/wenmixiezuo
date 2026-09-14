#!/bin/bash
# AUTH-TAKEOVER-01 Linux三阶段回退演练（25项，cookie修正版）
# 从响应头提取cookie（curl -D），非body；每项记录预期/实际/退出码
# 用法: 在候选源码根执行 bash scripts/release/auth-takeover/linux/drill-rollback.sh [回退包目录]
set -euo pipefail

SRC="$(pwd)"
RB="${1:-$SRC/.local/rollback-target-linux}"
PORT=${2:-43198}
DATA=$(mktemp -d /tmp/auth-drill-XXXXXX)
ORIGIN=http://127.0.0.1:43110
HOST=127.0.0.1:$PORT
URL="http://127.0.0.1:$PORT"
H='content-type: application/json'
EX="origin: $ORIGIN"
FS='sec-fetch-site: same-site'
HD="host: $HOST"
HDR=$(mktemp /tmp/hdr-XXXX)
PASS=0; FAIL=0; TOTAL=0
API_PID=""

check() {
  TOTAL=$((TOTAL+1))
  local expect=$1 actual=$2 label=$3
  if [ "$expect" = "$actual" ]; then
    PASS=$((PASS+1)); echo "  ✓ $label (expect=$expect actual=$actual)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ $label (expect=$expect actual=$actual)"
  fi
}

start_api() {
  local dist=$1 root=$2
  WENMI_PROJECT_ROOT="$root" WENMI_DATA_DIR="$DATA" WENMI_API_PORT=$PORT WENMI_API_HOST=127.0.0.1 node "$dist" &
  API_PID=$!
  for i in $(seq 1 20); do
    curl -s "$URL/health" -H "$HD" 2>/dev/null | grep -q '"ok"' && return 0
    sleep 1
  done
  echo "FAIL: API未能启动"; return 1
}

stop_api() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  [ -n "$API_PID" ] && wait "$API_PID" 2>/dev/null
  sleep 1; API_PID=""
}

get_cookie() { grep -i 'set-cookie' "$HDR" 2>/dev/null | grep -o 'wenmi_session=[^;]*' | head -1; }

cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  rm -rf "$DATA" "$HDR" /tmp/hdr-* 2>/dev/null
  echo "CLEANUP-DONE"
}
trap cleanup EXIT

# 包hash记录
echo "=== 包信息 ==="
NEW_HASH=$(sha256sum "$SRC/apps/api/dist/main.js" | cut -d' ' -f1)
RB_HASH=$(sha256sum "$RB/dist/main.js" | cut -d' ' -f1)
echo "新包main.js sha256: $NEW_HASH"
echo "回退包main.js sha256: $RB_HASH"

echo "════════ Phase A: 新包 ════════"
start_api "$SRC/apps/api/dist/main.js" "$SRC"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/register" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","displayName":"管理员","password":"Admin-Pass-123-456!"}')
check "200" "$CODE" "A1 注册admin"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Pass-123-456!"}')
check "200" "$CODE" "A2 admin登录"
ADMIN_COOKIE=$(get_cookie)

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/v1/admin/overview" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE")
check "200" "$CODE" "A3 admin概览"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/password/change" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{"currentPassword":"Admin-Pass-123-456!","nextPassword":"Admin-Changed-456!"}')
check "200" "$CODE" "A4 改密"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "200" "$CODE" "A5 新密码登录"
ADMIN_COOKIE=$(get_cookie)

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Wrong-Password-99!"}')
check "401" "$CODE" "A6 错误密码拒绝"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/register" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","displayName":"用户","password":"User-Pass-123-456!"}')
check "200" "$CODE" "A7 注册普通用户"

# 普通用户访问admin接口→403
CODE=$(curl -s -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","password":"User-Pass-123-456!"}')
USER_COOKIE=$(get_cookie)
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/v1/admin/overview" -H "$EX" -H "$FS" -H "$HD" -b "$USER_COOKIE")
check "403" "$CODE" "A8 普通用户访问admin→403"

stop_api

# 种v1历史用户
V1_HASH=$(node --input-type=module -e "
import { scryptSync } from 'node:crypto';
console.log(scryptSync('Legacy-Pass-123-456!', '0123456789abcdef0123456789abcdef', 64, { N: 16384, r: 8, p: 1, maxmem: 128*1024*1024 }).toString('hex'));
")
sqlite3 "$DATA/database/wenmi.sqlite" "
INSERT INTO owners (owner_id, display_name, version, created_at, updated_at) VALUES ('legacy-owner','历史用户',1,'2026-01-01','2026-01-01');
INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash, password_format, password_n, password_r, password_p, credential_version, role, status, created_at, updated_at, last_login_at) VALUES ('legacy-user', 'legacy-owner', 'legacy@example.com', '历史用户', '0123456789abcdef0123456789abcdef', '$V1_HASH', NULL, NULL, NULL, NULL, 0, 'user', 'active', '2026-01-01', '2026-01-01', NULL);
"
BEFORE_ACCOUNTS=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM user_accounts")
BEFORE_OWNERS=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM owners")

echo "════════ Phase B: Linux回退包 ════════"
# 回退包需要node_modules——创建symlink
if [ ! -e "$RB/node_modules" ]; then
  ln -sf "$SRC/node_modules" "$RB/node_modules"
fi

start_api "$RB/dist/main.js" "$RB"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL/health" -H "$HD")
check "200" "$CODE" "B1 回退包健康"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"legacy@example.com","password":"Legacy-Pass-123-456!"}')
check "200" "$CODE" "B2 v1历史用户登录"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "200" "$CODE" "B3 v2改密用户登录"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","password":"User-Pass-123-456!"}')
check "200" "$CODE" "B4 普通用户登录"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/v1/admin/overview" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE")
check "200" "$CODE" "B5 旧会话认证"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/password/change" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{}')
check "404" "$CODE" "B6 改密端点回退后404"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/sessions/revoke-others" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{}')
check "404" "$CODE" "B7 撤销端点回退后404"

stop_api

AFTER_ACCOUNTS=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM user_accounts")
AFTER_OWNERS=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM owners")
check "$BEFORE_ACCOUNTS" "$AFTER_ACCOUNTS" "B8 账号数不变($BEFORE_ACCOUNTS→$AFTER_ACCOUNTS)"
check "$BEFORE_OWNERS" "$AFTER_OWNERS" "B9 owner数不变($BEFORE_OWNERS→$AFTER_OWNERS)"

MEMBERSHIPS=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM user_memberships" 2>/dev/null || echo "0")
[ "$MEMBERSHIPS" -ge "1" ]; check "0" "$?" "B10 会员权益保留(count=$MEMBERSHIPS)"

echo "════════ Phase C: 新包回切 ════════"
start_api "$SRC/apps/api/dist/main.js" "$SRC"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "200" "$CODE" "C1 admin(v2)登录"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/login" -H "$H" -H" $EX" -H "$FS" -H "$HD" -d '{"email":"legacy@example.com","password":"Legacy-Pass-123-456!"}')
check "200" "$CODE" "C2 v1用户登录+透明升级"

FORMAT=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT password_format FROM user_accounts WHERE email_normalized='legacy@example.com'")
check "scrypt-v2" "$FORMAT" "C3 v1用户升级为v2(format=$FORMAT)"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -D "$HDR" --max-time 60 -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
NEW_COOKIE=$(get_cookie)
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/password/change" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$NEW_COOKIE" -d '{"currentPassword":"Admin-Changed-456!","nextPassword":"Final-Pass-789-012!"}')
check "200" "$CODE" "C4 改密端点恢复"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Final-Pass-789-012!"}')
check "200" "$CODE" "C5 最终密码登录"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "401" "$CODE" "C6 旧密码拒绝"

FAIL_COUNT=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM auth_audit_events WHERE event_type='login_failed'")
[ "$FAIL_COUNT" -ge "2" ]; check "0" "$?" "C7 login_failed审计持久化(count=$FAIL_COUNT)"

MIG_COUNT=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM schema_migrations")
[ "$MIG_COUNT" -ge "125" ]; check "0" "$?" "C8 迁移完整性(count=$MIG_COUNT)"

# 0125历史数据迁移验证：审计记录有历史+新增
TOTAL_AUDIT=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM auth_audit_events")
[ "$TOTAL_AUDIT" -ge "5" ]; check "0" "$?" "C9 审计总量(count=$TOTAL_AUDIT)"

stop_api

echo "════════ RESULT: $PASS/$TOTAL PASS, $FAIL FAIL ════════"
exit $FAIL
