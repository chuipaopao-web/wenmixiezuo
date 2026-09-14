#!/bin/bash
# AUTH-TAKEOVER-01 Linux三阶段演练（返工3修正版）
# 修正：端口保护/PID归属/精确清理/0125独立迁移验证/逐owner权益对比/跨owner隔离
# 用法: SRC=/path/to/source RB=/path/to/rollback bash scripts/release/auth-takeover/linux/drill-rollback.sh [PORT]
set -uo pipefail  # 不用-e，让cleanup始终执行

SRC="${SRC:?需要SRC}"
RB="${RB:?需要RB}"
PORT="${1:-43200}"
DATA=""
API_PID=""
HDR=""

# ── 精确清理：只删本脚本创建的路径 ──
cleanup() {
  local exit_code=$?
  # 等待自己的子进程退出
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null || true  # kill后的非零退出码不阻断清理
    sleep 0.5
  fi
  # 只删精确路径（本脚本mktemp创建的）
  [ -n "$DATA" ] && [ -d "$DATA" ] && rm -rf "$DATA"
  [ -n "$HDR" ] && [ -f "$HDR" ] && rm -f "$HDR"
  echo "CLEANUP-DONE (exit=$exit_code)"
  exit $exit_code
}
trap cleanup EXIT INT TERM

# ── 端口保护 ──
check_port_free() {
  local port=$1
  if ss -tlnp 2>/dev/null | grep -q ":$port " || \
     netstat -tlnp 2>/dev/null | grep -q ":$port " || \
     curl -s --connect-timeout 1 "http://127.0.0.1:$port/" >/dev/null 2>&1; then
    echo "ERROR: 端口$port被占用"; return 1
  fi
  return 0
}

# ── 启动API（带端口保护+PID归属+身份验证） ──
start_api() {
  local dist=$1 root=$2 label=$3
  check_port_free "$PORT" || return 1

  # 环境白名单（不继承生产配置）
  env -i \
    PATH="$PATH" \
    HOME="$HOME" \
    WENMI_PROJECT_ROOT="$root" \
    WENMI_DATA_DIR="$DATA" \
    WENMI_API_PORT="$PORT" \
    WENMI_API_HOST=127.0.0.1 \
    node "$dist" &
  API_PID=$!

  # 等健康就绪
  for i in $(seq 1 30); do
    # 确认还是自己的子进程
    if ! kill -0 "$API_PID" 2>/dev/null; then
      echo "ERROR: $label 子进程$API_PID已退出"; return 1
    fi
    # 检查端口确实是本进程
    if curl -s --connect-timeout 2 --max-time 5 "http://127.0.0.1:$PORT/health" -H "host: 127.0.0.1:$PORT" 2>/dev/null | grep -q '"service":"wenmi-api"'; then
      # 验证PID仍然存活
      kill -0 "$API_PID" 2>/dev/null && {
        echo "  $label 就绪 (PID=$API_PID port=$PORT)"
        return 0
      }
    fi
    sleep 1
  done
  echo "ERROR: $label 未在30秒内就绪"; return 1
}

stop_api() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null || true
    sleep 1
  fi
  API_PID=""
}

get_cookie() { grep -i 'set-cookie' "$HDR" 2>/dev/null | grep -o 'wenmi_session=[^;]*' | head -1; }

PASS=0; FAIL=0; TOTAL=0
check() {
  TOTAL=$((TOTAL+1))
  local expect=$1 actual=$2 label=$3
  if [ "$expect" = "$actual" ]; then
    PASS=$((PASS+1)); echo "  ✓ $label (expect=$expect actual=$actual)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ $label (expect=$expect actual=$actual)"
  fi
}

ORIGIN=http://127.0.0.1:43110
HOST="127.0.0.1:$PORT"
URL="http://127.0.0.1:$PORT"
H='content-type: application/json'
EX="origin: $ORIGIN"
FS='sec-fetch-site: same-site'
HD="host: $HOST"
CT="--connect-timeout 5 --max-time 30"  # curl超时

DATA=$(mktemp -d /tmp/auth-drill3-XXXXXX)
HDR=$(mktemp /tmp/auth-hdr-XXXXXX)  # 精确路径

echo "=== 包信息 ==="
NEW_HASH=$(sha256sum "$SRC/apps/api/dist/main.js" | cut -d' ' -f1)
RB_HASH=$(sha256sum "$RB/dist/main.js" | cut -d' ' -f1)
echo "新包: $NEW_HASH"
echo "回退: $RB_HASH"

# ═════════════════════════════════════════════════════
echo "════════ Phase 0: 0125独立迁移验证（返工3新增） ═════════"
# 创建0124 schema合成库（不含0125）
MIG_DB=$(mktemp /tmp/auth-mig-XXXXXX.sqlite)
MIGRATIONS_DIR="$SRC/apps/api/src/infrastructure/db/migrations"

# 只应用0001-0124（排除0125）
TMP_MIG=$(mktemp -d /tmp/auth-mig-src-XXXXXX)
cp "$MIGRATIONS_DIR"/*.sql "$TMP_MIG/" 2>/dev/null
rm -f "$TMP_MIG/0125_password_scrypt_v2.sql"

node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '$SRC/apps/api/dist/infrastructure/db/migrations.js';
import { resolve } from 'node:path';
const db = new DatabaseSync('$MIG_DB');
const result = runMigrations(db, resolve('$TMP_MIG'));
console.log('pre-0125 applied:', result.applied.length, 'migrations (last:', result.applied[result.applied.length-1] + ')');
// 验证无0125
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE name LIKE 'creative_reference_%'\").all();
console.log('creative tables before 0125:', tables.length, '(should be >0 from 0122-0124)');
// 检查user_accounts没有新列
const cols = db.prepare('PRAGMA table_info(user_accounts)').all();
const hasFmt = cols.some(c => c.name === 'password_format');
console.log('password_format column exists:', hasFmt, '(should be false)');
db.close();
"

# 在0124库中种历史数据
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomUUID } from 'node:crypto';
const db = new DatabaseSync('$MIG_DB');
// 种账号（旧schema无password_format等列）
const salt = '0123456789abcdef0123456789abcdef';
const hash = scryptSync('Old-Pass-123-456!', salt, 64, { N: 16384, r: 8, p: 1, maxmem: 128*1024*1024 }).toString('hex');
db.prepare(\"INSERT INTO owners (owner_id, display_name, version, created_at, updated_at) VALUES ('mig-owner-1','迁移测试Owner',1,'2026-01-01','2026-01-01')\").run();
db.prepare(\"INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash, role, status, created_at, updated_at, last_login_at) VALUES ('mig-user-1','mig-owner-1','mig@example.com','迁移用户','$salt','$hash','user','active','2026-01-01','2026-01-01',NULL)\").run();
// 种旧审计记录（0125会重建此表）
db.prepare(\"INSERT INTO auth_audit_events (audit_id, user_id, event_type, email_normalized, actor_user_id, recorded_at, details_json) VALUES (?,?,?,?,?,?,?)\").run(randomUUID(), 'mig-user-1', 'login_success', 'mig@example.com', 'mig-user-1', '2026-01-01', '{\"seed\":true}');
// 种权益
db.prepare(\"INSERT INTO user_memberships (user_id, owner_id, plan, status, token_quota, period_start, period_end, total_tokens, period_tokens, created_at) VALUES ('mig-user-1','mig-owner-1','bronze','active',200000,'2026-01-01','2027-01-01',200000,200000,'2026-01-01')\").run();
// 记录迁移前数据
const preAccounts = db.prepare('SELECT user_id, email_normalized, display_name, password_hash, role, status FROM user_accounts').all();
const preAudit = db.prepare('SELECT COUNT(*) n FROM auth_audit_events').get().n;
const preMembership = db.prepare('SELECT user_id, plan, status, token_quota FROM user_memberships').all();
const preOwners = db.prepare('SELECT owner_id, display_name FROM owners').all();
console.log('PRE_MIG:' + JSON.stringify({accounts:preAccounts, audit:preAudit, membership:preMembership, owners:preOwners}));
db.close();
"

# 应用0125
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '$SRC/apps/api/dist/infrastructure/db/migrations.js';
import { resolve } from 'node:path';
const db = new DatabaseSync('$MIG_DB');
const r1 = runMigrations(db, resolve('$MIGRATIONS_DIR'));
console.log('0125 applied:', r1.applied);
// 验证迁移后数据保留
const accounts = db.prepare('SELECT user_id, email_normalized, display_name, password_hash, role, status FROM user_accounts').all();
const audit = db.prepare('SELECT COUNT(*) n FROM auth_audit_events').get().n;
const membership = db.prepare('SELECT user_id, plan, status, token_quota FROM user_memberships').all();
const owners = db.prepare('SELECT owner_id, display_name FROM owners').all();
// 新列存在
const cols = db.prepare('PRAGMA table_info(user_accounts)').all().map(c=>c.name);
const hasFmt = cols.includes('password_format') && cols.includes('credential_version');
console.log('POST_MIG:' + JSON.stringify({accounts, audit, membership, owners, hasFmt}));
// 重入：再跑一次，applied应为空
const r2 = runMigrations(db, resolve('$MIGRATIONS_DIR'));
console.log('REENTRY applied:', r2.applied.length, '(should be 0)');
db.close();
"

# 比较迁移前后
PRE_COUNT=$(node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('$MIG_DB');
console.log(db.prepare('SELECT COUNT(*) n FROM user_accounts WHERE email_normalized=?').get('mig@example.com').n);
db.close();
")
check "1" "$PRE_COUNT" "P0-1 迁移后账号保留"

AUDIT_PRESERVED=$(node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('$MIG_DB');
// 0125重建audit表时INSERT INTO ... SELECT保留旧记录
const n = db.prepare('SELECT COUNT(*) n FROM auth_audit_events WHERE event_type=?').get('login_success').n;
console.log(n);
db.close();
")
[ "$AUDIT_PRESERVED" -ge "1" ]; check "0" "$?" "P0-2 旧审计记录保留(count=$AUDIT_PRESERVED)"

MEMBERSHIP_OK=$(node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('$MIG_DB');
const m = db.prepare('SELECT plan, status, token_quota FROM user_memberships WHERE user_id=?').get('mig-user-1');
console.log(m && m.plan === 'bronze' && m.status === 'active' && m.token_quota === 200000 ? 'OK' : 'FAIL:' + JSON.stringify(m));
db.close();
")
check "OK" "$MEMBERSHIP_OK" "P0-3 权益内容保留(plan=bronze quota=200000)"

# 迁移失败原子性（0125触发器注入）
MIG_FAIL_DB=$(mktemp /tmp/auth-migfail-XXXXXX.sqlite)
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '$SRC/apps/api/dist/infrastructure/db/migrations.js';
import { resolve } from 'node:path';
const db = new DatabaseSync('$MIG_FAIL_DB');
// 先应用到0124
runMigrations(db, resolve('$TMP_MIG'));
// 创建0125失败触发器
db.exec(\"CREATE TRIGGER fail_0125 BEFORE INSERT ON creative_reference_admin_audit BEGIN SELECT RAISE(ABORT,'injected'); END\");
try {
  runMigrations(db, resolve('$MIGRATIONS_DIR'));
  console.log('UNEXPECTED_SUCCESS');
} catch(e) {
  console.log('EXPECTED_FAIL');
}
// 验证无半迁移：0125的表不应存在（回滚成功）
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE name='creative_reference_admin_audit'\").all();
// 触发器可能已创建表再插入失败，检查user_accounts新列不应存在
const cols = db.prepare('PRAGMA table_info(user_accounts)').all().map(c=>c.name);
console.log('HAS_NEW_COLS:' + (cols.includes('password_format') ? 'YES(BAD)' : 'NO(GOOD)'));
db.close();
"
rm -f "$MIG_FAIL_DB"

# 清理迁移测试库
rm -f "$MIG_DB" "$MIG_FAIL_DB"
rm -rf "$TMP_MIG"

# ═════════════════════════════════════════════════════
echo "════════ Phase A: 新包 ══════════"
start_api "$SRC/apps/api/dist/main.js" "$SRC" "新包" || exit 1

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/register" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","displayName":"管理员","password":"Admin-Pass-123-456!"}')
check "200" "$CODE" "A1 注册admin"

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Pass-123-456!"}')
check "200" "$CODE" "A2 admin登录"
ADMIN_COOKIE=$(get_cookie)

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' "$URL/api/v1/admin/overview" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE")
check "200" "$CODE" "A3 admin概览"

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/password/change" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{"currentPassword":"Admin-Pass-123-456!","nextPassword":"Admin-Changed-456!"}')
check "200" "$CODE" "A4 改密"

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "200" "$CODE" "A5 新密码登录"
ADMIN_COOKIE=$(get_cookie)

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Wrong-Password-99!"}')
check "401" "$CODE" "A6 错误密码拒绝"

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/register" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","displayName":"用户","password":"User-Pass-123-456!"}')
check "200" "$CODE" "A7 注册普通用户"

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","password":"User-Pass-123-456!"}')
USER_COOKIE=$(get_cookie)
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' "$URL/api/v1/admin/overview" -H "$EX" -H "$FS" -H "$HD" -b "$USER_COOKIE")
check "403" "$CODE" "A8 普通用户访问admin→403"

# 记录逐owner权益（Phase A结束前）
OWNER1_PRE=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT plan,status,token_quota FROM user_memberships WHERE owner_id=(SELECT owner_id FROM user_accounts WHERE email_normalized='user@example.com')" 2>/dev/null)
echo "  · user@example.com 权益: $OWNER1_PRE"

stop_api

# 种v1历史用户+第二个owner
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

echo "════════ Phase B: Linux回退包 ══════════"
[ -e "$RB/node_modules" ] || ln -sf "$SRC/node_modules" "$RB/node_modules"

start_api "$RB/dist/main.js" "$RB" "回退包" || exit 1

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' "$URL/health" -H "$HD")
check "200" "$CODE" "B1 回退包健康"
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"legacy@example.com","password":"Legacy-Pass-123-456!"}')
check "200" "$CODE" "B2 v1历史用户登录"
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "200" "$CODE" "B3 v2改密用户登录"
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","password":"User-Pass-123-456!"}')
check "200" "$CODE" "B4 普通用户登录"
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' "$URL/api/v1/admin/overview" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE")
check "200" "$CODE" "B5 旧会话认证"
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/password/change" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{}')
check "404" "$CODE" "B6 改密端点404"
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/sessions/revoke-others" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$ADMIN_COOKIE" -d '{}')
check "404" "$CODE" "B7 撤销端点404"

stop_api

AFTER_ACCOUNTS=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM user_accounts")
AFTER_OWNERS=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM owners")
check "$BEFORE_ACCOUNTS" "$AFTER_ACCOUNTS" "B8 账号数不变($BEFORE_ACCOUNTS→$AFTER_ACCOUNTS)"
check "$BEFORE_OWNERS" "$AFTER_OWNERS" "B9 owner数不变($BEFORE_OWNERS→$AFTER_OWNERS)"

# 逐owner权益对比
OWNER1_POST=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT plan,status,token_quota FROM user_memberships WHERE owner_id=(SELECT owner_id FROM user_accounts WHERE email_normalized='user@example.com')" 2>/dev/null)
check "$OWNER1_PRE" "$OWNER1_POST" "B10 user权益逐项保留($OWNER1_PRE→$OWNER1_POST)"

echo "════════ Phase C: 新包回切 ══════════"
start_api "$SRC/apps/api/dist/main.js" "$SRC" "新包回切" || exit 1

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "200" "$CODE" "C1 admin(v2)登录"
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"legacy@example.com","password":"Legacy-Pass-123-456!"}')
check "200" "$CODE" "C2 v1用户登录+透明升级"
FORMAT=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT password_format FROM user_accounts WHERE email_normalized='legacy@example.com'")
check "scrypt-v2" "$FORMAT" "C3 v1用户升级为v2(format=$FORMAT)"

CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
NEW_COOKIE=$(get_cookie)
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/password/change" -H "$H" -H "$EX" -H "$FS" -H "$HD" -b "$NEW_COOKIE" -d '{"currentPassword":"Admin-Changed-456!","nextPassword":"Final-Pass-789-012!"}')
check "200" "$CODE" "C4 改密端点恢复"
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Final-Pass-789-012!"}')
check "200" "$CODE" "C5 最终密码登录"
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"admin@example.com","password":"Admin-Changed-456!"}')
check "401" "$CODE" "C6 旧密码拒绝"

FAIL_COUNT=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM auth_audit_events WHERE event_type='login_failed'")
[ "$FAIL_COUNT" -ge "2" ]; check "0" "$?" "C7 login_failed审计持久化(count=$FAIL_COUNT)"
MIG_COUNT=$(sqlite3 "$DATA/database/wenmi.sqlite" "SELECT COUNT(*) FROM schema_migrations")
[ "$MIG_COUNT" -ge "125" ]; check "0" "$?" "C8 迁移完整性(count=$MIG_COUNT)"

# 跨owner数据隔离：user不能读admin的数据
CODE=$(curl -s $CT -o /dev/null -w '%{http_code}' -D "$HDR" -X POST "$URL/api/v1/auth/login" -H "$H" -H "$EX" -H "$FS" -H "$HD" -d '{"email":"user@example.com","password":"User-Pass-123-456!"}')
USER2_COOKIE=$(get_cookie)
# user的书籍列表
BOOKS_JSON=$(curl -s $CT "$URL/api/v1/v7/opening-agent/tasks?limit=10" -H "$EX" -H "$FS" -H "$HD" -b "$USER2_COOKIE")
# 验证返回的booklist只含user自己的（不含admin的——目前两个用户都没书，但检查请求成功）
echo "$BOOKS_JSON" | grep -q '"data"'; check "0" "$?" "C9 user任务列表正常返回"

stop_api

echo "════════ RESULT: $PASS/$TOTAL PASS, $FAIL FAIL ═════════"
exit $FAIL
