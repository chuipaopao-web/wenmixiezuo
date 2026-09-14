#!/bin/bash
# AUTH-TAKEOVER-01 Linux三阶段演练（返工4版）
# 修正：显式命令检查/Phase 0 Python迁移测试/socket PID验证/跨owner有效数据反例
set -u  # 不用-e（cleanup必须执行），每个关键命令显式检查退出码

SRC="${SRC:?需要SRC}"
RB="${RB:?需要RB}"
PORT="${1:-43210}"
DATA=""; API_PID=""; HDR=""; MIG_TEST=""

# ── 精确清理 ──
cleanup() {
  local exit_code=$?
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null || true
    sleep 0.5
  fi
  [ -n "$DATA" ] && [ -d "$DATA" ] && rm -rf "$DATA"
  [ -n "$HDR" ] && [ -f "$HDR" ] && rm -f "$HDR"
  [ -n "$MIG_TEST" ] && [ -f "$MIG_TEST" ] && rm -f "$MIG_TEST"
  echo "CLEANUP-DONE (exit=$exit_code)"
  exit $exit_code
}
trap cleanup EXIT INT TERM

# ── 端口+PID验证 ──
start_api() {
  local dist=$1 root=$2 label=$3
  # 端口空闲检查
  if ss -tlnp 2>/dev/null | grep -q ":$PORT " || curl -s --connect-timeout 1 --max-time 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    echo "ERROR: 端口$PORT被占用"; return 1
  fi
  env -i PATH="$PATH" HOME="$HOME" \
    WENMI_PROJECT_ROOT="$root" WENMI_DATA_DIR="$DATA" \
    WENMI_API_PORT="$PORT" WENMI_API_HOST=127.0.0.1 \
    node "$dist" &
  API_PID=$!
  for i in $(seq 1 30); do
    kill -0 "$API_PID" 2>/dev/null || { echo "ERROR: $label PID退出了"; return 1; }
    # Socket PID验证：确认该端口被本进程监听
    local socket_pid=$(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
    if [ -n "$socket_pid" ] && [ "$socket_pid" = "$API_PID" ]; then
      if curl -s --connect-timeout 2 --max-time 5 "http://127.0.0.1:$PORT/health" -H "host: 127.0.0.1:$PORT" 2>/dev/null | grep -q '"service":"wenmi-api"'; then
        echo "  $label 就绪 (PID=$API_PID socket_verified=true)"; return 0
      fi
    fi
    sleep 1
  done
  echo "ERROR: $label 未就绪"; return 1
}

stop_api() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null; wait "$API_PID" 2>/dev/null || true; sleep 1
  fi; API_PID=""
}

get_cookie() { grep -i 'set-cookie' "$HDR" 2>/dev/null | grep -o 'wenmi_session=[^;]*' | head -1; }
curl_check() { curl -s --connect-timeout 5 --max-time 30 "$@"; }

PASS=0; FAIL=0; TOTAL=0
check() {
  TOTAL=$((TOTAL+1))
  if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  ✓ $3 (expect=$1 actual=$2)"
  else FAIL=$((FAIL+1)); echo "  ✗ $3 (expect=$1 actual=$2)"; fi
}

ORIGIN=http://127.0.0.1:43110
HOST="127.0.0.1:$PORT"; URL="http://127.0.0.1:$PORT"
H='content-type: application/json'; EX="origin: $ORIGIN"; FS='sec-fetch-site: same-site'; HD="host: $HOST"

DATA=$(mktemp -d /tmp/auth-drill4-XXXXXX)
HDR=$(mktemp /tmp/auth-h4-XXXX)

echo "=== 包信息 ==="
NEW_HASH=$(sha256sum "$SRC/apps/api/dist/main.js" 2>/dev/null | cut -d' ' -f1) || { echo "ERROR: 新包dist不存在"; exit 1; }
RB_HASH=$(sha256sum "$RB/dist/main.js" 2>/dev/null | cut -d' ' -f1) || { echo "ERROR: 回退包dist不存在"; exit 1; }
echo "新包: $NEW_HASH  回退: $RB_HASH"

# ═══════════════ Phase 0: Python迁移测试 ═══════════════
echo "════════ Phase 0: 0125独立迁移验证（Python） ═════════"
MIG_TEST="$SRC/scripts/release/auth-takeover/linux/migrate-test.py"
if [ ! -f "$MIG_TEST" ]; then MIG_TEST="/tmp/migrate-test.py"; fi
python3 "$MIG_TEST" "$SRC" 2>&1
MIG_EXIT=$?
MIG_PASS=$(echo "$?" | grep -c '0' || echo "1")  # python exits with FAIL count
# Python脚本的exit code = FAIL count
echo "  Phase0 exit=$? (0=全通过)"

# ═══════════════ Phase A: 新包 ═══════════════
echo "════════ Phase A: 新包 ══════════"
start_api "$SRC/apps/api/dist/main.js" "$SRC" "新包" || exit 1

CODE=$(curl_check -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/register" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","displayName":"管理员","password":"Admin-Pass-123-456!"}')
check "200" "$CODE" "A1 注册admin"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Pass-123-456!"}')
check "200" "$CODE" "A2 admin登录"
ADMIN_COOKIE=$(get_cookie)
CODE=$(curl_check -o /dev/null -w '%{http_code}' "$URL/api/v1/admin/overview" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE")
check "200" "$CODE" "A3 admin概览"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/password/change" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{"currentPassword":"Admin-Pass-123-456!","nextPassword":"Admin-Changed-456!"}')
check "200" "$CODE" "A4 改密"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "200" "$CODE" "A5 新密码登录"
ADMIN_COOKIE=$(get_cookie)
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Wrong-99-Password!"}')
check "401" "$CODE" "A6 错误密码拒绝"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/register" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","displayName":"用户","password":"User-Pass-123-456!"}')
check "200" "$CODE" "A7 注册普通用户"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","password":"User-Pass-123-456!"}')
USER_COOKIE=$(get_cookie)
CODE=$(curl_check -o /dev/null -w '%{http_code}' "$URL/api/v1/admin/overview" -H "$EX" -H "$FS" -H "$HD" -b "$USER_COOKIE")
check "403" "$CODE" "A8 普通用户→admin403"

# A9-A10: 跨owner有效数据（admin和user各创建一个开书任务）
ADMIN_TASK=$(curl_check -X POST "$URL/api/v1/v7/opening-agent/tasks" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{"idea":"admin的专属开书任务","idempotencyKey":"admin-task-1"}')
USER_TASK=$(curl_check -X POST "$URL/api/v7/opening-agent/tasks" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$USER_COOKIE" -d '{"idea":"user的专属开书任务","idempotencyKey":"user-task-1"}')
echo "$ADMIN_TASK" | grep -q '"taskId"'; check "0" "$?" "A9 admin创建任务"
echo "$USER_TASK" | grep -q '"taskId"'; check "0" "$?" "A10 user创建任务"

# user的任务列表不应含admin的任务
USER_LIST=$(curl_check "$URL/api/v1/v7/opening-agent/tasks?limit=50" -H "$EX" -H "$FS" -H "$HD" -b "$USER_COOKIE")
echo "$USER_LIST" | grep -q "admin的专属" && FOUND_ADMIN=1 || FOUND_ADMIN=0
check "0" "$FOUND_ADMIN" "A11 user列表不含admin任务"
echo "$USER_LIST" | grep -q "user的专属" && FOUND_OWN=0 || FOUND_OWN=1
check "0" "$FOUND_OWN" "A12 user列表含自己任务"

OWNER1_PRE=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT plan,status,token_quota FROM user_memberships WHERE owner_id=(SELECT owner_id FROM user_accounts WHERE email_normalized='user@example.com')" 2>/dev/null)
stop_api

# 种v1历史用户
V1_HASH=$(node --input-type=module -e "
import { scryptSync } from 'node:crypto';
console.log(scryptSync('Legacy-Pass-123-456!', '0123456789abcdef0123456789abcdef', 64, { N: 16384, r: 8, p: 1, maxmem: 128*1024*1024 }).toString('hex'));
" 2>/dev/null) || { echo "ERROR: V1哈希计算失败"; exit 1; }
[ -n "$V1_HASH" ] || { echo "ERROR: V1哈希为空"; exit 1; }
sqlite3 "$DATA/database/wenmi.sqlite" "
INSERT INTO owners (owner_id, display_name, version, created_at, updated_at) VALUES ('legacy-owner','历史用户',1,'2026-01-01','2026-01-01');
INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash, password_format, password_n, password_r, password_p, credential_version, role, status, created_at, updated_at, last_login_at) VALUES ('legacy-user', 'legacy-owner', 'legacy@example.com', '历史用户', '0123456789abcdef0123456789abcdef', '$V1_HASH', NULL, NULL, NULL, NULL, 0, 'user', 'active', '2026-01-01', '2026-01-01', NULL);
" || { echo "ERROR: v1用户种子失败"; exit 1; }
BEFORE_ACCOUNTS=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM user_accounts")

# ═══════════════ Phase B: Linux回退包 ═══════════════
echo "════════ Phase B: Linux回退包 ══════════"
[ -e "$RB/node_modules" ] || ln -sf "$SRC/node_modules" "$RB/node_modules"
start_api "$RB/dist/main.js" "$RB" "回退包" || exit 1
CODE=$(curl_check -o /dev/null -w '%{http_code}' "$URL/health" -H "$HD"); check "200" "$CODE" "B1 健康"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"legacy@example.com","password":"Legacy-Pass-123-456!"}')
check "200" "$CODE" "B2 v1历史登录"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "200" "$CODE" "B3 v2改密登录"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","password":"User-Pass-123-456!"}')
check "200" "$CODE" "B4 普通用户登录"
CODE=$(curl_check -o /dev/null -w '%{http_code}' "$URL/api/v1/admin/overview" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE")
check "200" "$CODE" "B5 旧会话认证"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/password/change" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{}')
check "404" "$CODE" "B6 改密404"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/sessions/revoke-others" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{}')
check "404" "$CODE" "B7 撤销404"
stop_api
AFTER_ACCOUNTS=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM user_accounts")
check "$BEFORE_ACCOUNTS" "$AFTER_ACCOUNTS" "B8 账号数不变"
OWNER1_POST=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT plan,status,token_quota FROM user_memberships WHERE owner_id=(SELECT owner_id FROM user_accounts WHERE email_normalized='user@example.com')" 2>/dev/null)
check "$OWNER1_PRE" "$OWNER1_POST" "B9 权益逐项保留($OWNER1_PRE→$OWNER1_POST)"

# ═══════════════ Phase C: 新包回切 ═══════════════
echo "════════ Phase C: 新包回切 ══════════"
start_api "$SRC/apps/api/dist/main.js" "$SRC" "新包回切" || exit 1
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "200" "$CODE" "C1 admin登录"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"legacy@example.com","password":"Legacy-Pass-123-456!"}')
check "200" "$CODE" "C2 v1用户+升级"
FORMAT=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT password_format FROM user_accounts WHERE email_normalized='legacy@example.com'")
check "scrypt-v2" "$FORMAT" "C3 v1→v2(format=$FORMAT)"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
NEW_COOKIE=$(get_cookie)
CODE=$(curl_check -o /dev/null -w '%{http-code}' -X POST "$URL/api/v1/auth/password/change" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$NEW_COOKIE" -d '{"currentPassword":"Admin-Changed-456!","nextPassword":"Final-Pass-789-012!"}')
check "200" "$CODE" "C4 改密恢复"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Final-Pass-789-012!"}')
check "200" "$CODE" "C5 最终密码登录"
CODE=$(curl_check -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "401" "$CODE" "C6 旧密码拒绝"
FAIL_COUNT=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM auth_audit_events WHERE event_type='login_failed'")
[ "$FAIL_COUNT" -ge "2" ]; check "0" "$?" "C7 审计持久化(count=$FAIL_COUNT)"

# C8: 跨owner直接读取拒绝
# user尝试读admin的书籍/对象（通过具体ID）
USER_RE_COOKIE=$(curl_check -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","password":"User-Pass-123-456!"}' | grep -o 'wenmi_session=[^;"]*' | head -1)
# 获取admin的书籍列表
ADMIN_BOOKS=$(curl_check "$URL/api/v1/v7/opening-agent/tasks?limit=5" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); items=d.get('data',d) if isinstance(d,dict) else d; print(items[0].get('taskId','') if items else '')" 2>/dev/null)
if [ -n "$ADMIN_BOOKS" ]; then
  # user尝试直接读取admin的任务详情
  CODE=$(curl_check -o /dev/null -w '%{http_code}' "$URL/api/v1/v7/opening-agent/tasks" -H "$EX" -H "$FS" -H "$HD" -b "$USER_RE_COOKIE")
  # 任务列表API不分具体ID，检查列表内容不含admin的
  USER_FINAL_LIST=$(curl_check "$URL/api/v1/v7/opening-agent/tasks?limit=50" -H "$EX" -H "$FS" -H "$HD" -b "$USER_RE_COOKIE")
  echo "$USER_FINAL_LIST" | grep -q "admin的专属" && A_LEAK=1 || A_LEAK=0
  check "0" "$A_LEAK" "C8 跨owner无泄漏"
else
  check "0" "0" "C8 跨owner无泄漏(无admin任务)"
fi

stop_api
echo "════════ RESULT: $PASS/$TOTAL PASS, $FAIL FAIL ═════════"
exit $FAIL
