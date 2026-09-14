#!/bin/bash
# AUTH-TAKEOVER-01 生产库空闲页整理（原地VACUUM）维护脚本 v3（S0-revision）
#
# v3修正（Codex核查5项）：
#  1. 失败/信号路径一律保留停服后保护快照并打印路径；快照目录独占创建（mkdir无-p，
#     已存在即失败），chown wenmi 并实测wenmi可写（生产）；不自动恢复数据库。
#  2. recover_services 真实验证：health JSON解析 releaseId 必须等于期望值且 status=ok；
#     start/is-active 返回码逐一检查；末次状态失败即返回非零。VACUUM失败后恢复前重新核验库完整性。
#  3. stop api 返回码检查+确认API/Worker均inactive+fuser rc>1(执行错误)拒绝；
#     logical_snapshot 枚举实际业务表，区分"表不存在(可选)"与"读取错误(失败)"，
#     纳入 sqlite_sequence，FTS仅按虚拟表行数核验，不触碰内部shadow表；不比较物理rowid。
#  4. 生产锁固定 /tmp/wenmi-space-cleanup.0.lock，不接受任何注入覆盖；
#     test模式强制要求隔离DB与全部替身，拒绝生产路径DB。
set -u

DB=/opt/wenmi/data/database/wenmi.sqlite
EXPECT_RELEASE=wm-v7-20260914-151504-a7614958
PROD_LOCK=/tmp/wenmi-space-cleanup.0.lock
MAX_OBSERVE=600
WINDOW=30
VMT_MODE=production
SQL_CMD="sudo -u wenmi sqlite3"
SYSCTL_CMD="systemctl"
HEALTH_URL=http://127.0.0.1:43111/health
FUSER_CMD="fuser"

if [ "${WENMI_VMT_MODE:-}" = "test" ]; then
  VMT_MODE=test
  DB="${WENMI_VMT_DB:?test模式要求WENMI_VMT_DB(必须为非生产隔离库)}"
  SQL_CMD="${WENMI_VMT_SQL:?test模式要求WENMI_VMT_SQL替身}"
  SYSCTL_CMD="${WENMI_VMT_SYSCTL:?test模式要求WENMI_VMT_SYSCTL替身}"
  HEALTH_CMD="${WENMI_VMT_HEALTH:?test模式要求WENMI_VMT_HEALTH替身}"
  FUSER_CMD="${WENMI_VMT_FUSER:?test模式要求WENMI_VMT_FUSER替身}"
  EXPECT_RELEASE="${WENMI_VMT_EXPECT_RELEASE:-$EXPECT_RELEASE}"
  WINDOW="${WENMI_VMT_WINDOW:-30}"
  MAX_OBSERVE="${WENMI_VMT_MAX_OBSERVE:-600}"
  case "$DB" in
    /opt/wenmi/*) echo "FATAL: test模式拒绝生产路径DB: $DB" >&2; exit 64 ;;
  esac
  vmt_sleep() { [ "${WENMI_VMT_FAST:-0}" = 1 ] || sleep "$1"; }
else
  # 生产模式：忽略全部注入变量，锁路径固定
  HEALTH_CMD="curl -s --max-time 3 $HEALTH_URL"
  vmt_sleep() { sleep "$1"; }
fi

LOG=$(mktemp /tmp/vacuum-maint.XXXXXXXX) || { echo "mktemp失败" >&2; exit 70; }
TMPFILES="$LOG"
exec 8>&2 || true
vmt_reg() { TMPFILES="$TMPFILES $1"; }
vmt_cleanup() { for f in $TMPFILES; do rm -f "$f" 2>/dev/null || true; done; }
trap vmt_cleanup EXIT
trap 'echo "收到信号，非零退出；保护快照与诊断保留" >&8; exit 130' INT
trap 'echo "收到信号，非零退出；保护快照与诊断保留" >&8; exit 143' TERM

fail() {
  echo "FATAL: $1" >&8 2>/dev/null || echo "FATAL: $1"
  [ -f "${LOG:-}" ] && tail -60 "$LOG" >&8 2>/dev/null
  [ -n "${SNAP_DIR:-}" ] && [ -d "${SNAP_DIR:-}" ] && echo "保护快照保留于: $SNAP_DIR" >&8 2>/dev/null
  echo "MAINT-ABORT" >&8 2>/dev/null || echo "MAINT-ABORT"
  exit "${2:-1}"
}
step() { echo ""; echo "===== $1 ====="; }

strict_integrity() {
  local out
  out=$($SQL_CMD -readonly "$1" "PRAGMA integrity_check;" 2>/dev/null); local rc1=$?
  [ $rc1 -eq 0 ] && [ "$out" = "ok" ] || return 1
  out=$($SQL_CMD -readonly "$1" "PRAGMA foreign_key_check;" 2>/dev/null); local rc2=$?
  [ $rc2 -eq 0 ] && [ -z "$out" ] || return 1
  return 0
}

# 逻辑指纹：枚举实际业务表（排除sqlite内部/fts shadow），缺表=可选，读错误=失败；
# 内容行排序哈希（不比较物理rowid）；纳入sqlite_sequence与FTS虚拟表行数。
logical_snapshot() {  # $1=输出文件
  python3 - "$DB" > "$1" <<'PY' || return 1
import hashlib, sqlite3, sys
try:
    db = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
except Exception as e:
    print(f'SNAPSHOT-ERR:{e}'); sys.exit(0)
lines = []
def table_names():
    rows = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    out = []
    for (n,) in rows:
        if n.startswith('sqlite_'): continue
        if n.endswith(('_fts_data','_fts_idx','_fts_config','_fts_docsize','_fts_delete')): continue
        out.append(n)
    return sorted(out)
errors = []
for t in table_names():
    try:
        rows = db.execute(f'SELECT * FROM "{t}"').fetchall()
    except sqlite3.OperationalError as e:
        if 'no such table' in str(e):
            continue
        errors.append(f'{t}:{e}'); continue
    except Exception as e:
        errors.append(f'{t}:{e}'); continue
    h = hashlib.sha256()
    for r in sorted(rows, key=lambda x: repr(x)):
        h.update(repr(r).encode())
    lines.append(f'{t}={len(rows)}:{h.hexdigest()[:16]}')
fts = []
for (n,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'").fetchall():
    try:
        cnt = db.execute(f'SELECT COUNT(*) FROM "{n}"').fetchone()[0]
        lines.append(f'FTS:{n}={cnt}')
    except Exception as e:
        errors.append(f'{n}:{e}')
try:
    seq = db.execute("SELECT name, seq FROM sqlite_sequence ORDER BY name").fetchall()
    lines.append('sequence=' + repr([(r[0], r[1]) for r in seq]))
except sqlite3.OperationalError:
    pass  # 无AUTOINCREMENT表时sqlite_sequence可能不存在（可选）
except Exception as e:
    errors.append(f'sqlite_sequence:{e}')
if errors:
    print('SNAPSHOT-ERR:' + ';'.join(errors[:5]))
    sys.exit(0)
print('\n'.join(lines))
PY
  grep -q 'SNAPSHOT-ERR' "$1" && return 1
  return 0
}

# 健康合同：解析JSON，releaseId必须等于期望且status=ok
health_ok() {
  $HEALTH_CMD 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)['data']
    sys.exit(0 if d.get('releaseId') == '$EXPECT_RELEASE' and d.get('status') == 'ok' else 1)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

recover_services() {  # 全程真实验证；任一失败返回1且不启动Worker
  echo "恢复服务（API→健康验证→Worker）"
  $SYSCTL_CMD reset-failed wenmi-worker 2>/dev/null || true
  if ! $SYSCTL_CMD start wenmi-api; then
    echo "RECOVERY-DEGRADED: start wenmi-api 失败" >&8 2>/dev/null || echo "RECOVERY-DEGRADED: start wenmi-api 失败"
    return 1
  fi
  local ok=""
  for i in $(seq 1 60); do
    if health_ok; then ok=1; break; fi
    vmt_sleep 1
  done
  if [ -z "$ok" ]; then
    echo "RECOVERY-DEGRADED: API健康(含期望版本)未达成，不启动Worker" >&8 2>/dev/null || echo "RECOVERY-DEGRADED"
    return 1
  fi
  if ! $SYSCTL_CMD start wenmi-worker; then
    echo "RECOVERY-DEGRADED: start wenmi-worker 失败" >&8 2>/dev/null || echo "RECOVERY-DEGRADED: worker"
    return 1
  fi
  vmt_sleep 5
  $SYSCTL_CMD is-active --quiet wenmi-api || { echo "RECOVERY-DEGRADED: API末次is-active失败" >&8; return 1; }
  $SYSCTL_CMD is-active --quiet wenmi-worker || { echo "RECOVERY-DEGRADED: Worker末次is-active失败" >&8; return 1; }
  $HEALTH_CMD; echo
  return 0
}

inflight_query() {
  $SQL_CMD -readonly "$DB" "SELECT (SELECT COUNT(*) FROM tasks WHERE status IN ('working','queued','pending','waiting_confirmation')) + (SELECT COUNT(*) FROM tm2_steps WHERE state='running') + (SELECT COUNT(*) FROM v7_opening_agent_tasks WHERE lease_expires_at IS NOT NULL AND lease_expires_at > datetime('now'));"
}

SNAP_DIR=""
{
step "0 互斥锁"
LOCK_PATH="$PROD_LOCK"
[ "$VMT_MODE" = test ] && LOCK_PATH="${WENMI_VMT_LOCK:-/tmp/wenmi-vmt-test-$$.$RANDOM.lock}"
exec 9>"$LOCK_PATH" || fail "锁文件无法打开: $LOCK_PATH" 70
flock -n 9 || fail "锁被持有（清理/发布/维护互斥）" 66

step "1 状态与在途窗口（连续${WINDOW}秒，总上限${MAX_OBSERVE}s）"
$SYSCTL_CMD is-active --quiet wenmi-api || echo "警告: API当前非active"
$SYSCTL_CMD is-active --quiet wenmi-worker || echo "警告: Worker当前非active"
stat -c '%s %n' "$DB" 2>/dev/null
$SQL_CMD -readonly "$DB" "PRAGMA page_count; PRAGMA freelist_count;"
ZEROS=0; ELAPSED=0
while [ $ZEROS -lt $WINDOW ]; do
  N=$(inflight_query) || fail "在途查询失败（拒绝继续，未停服）" 2
  [ "$N" = 0 ] && ZEROS=$((ZEROS+1)) || { [ $ZEROS -gt 0 ] && echo "  t=${ELAPSED}s 活动=${N}，重新计时"; ZEROS=0; }
  ELAPSED=$((ELAPSED+1))
  [ $ELAPSED -ge $MAX_OBSERVE ] && fail "总观察超限，窗口未满足（未停服，安全退出）" 2
  vmt_sleep 1
done
N=$(inflight_query) || fail "切换前复核查询失败（未停服）" 2
[ "$N" = 0 ] || fail "切换前立即复核非零（未停服）" 2
echo "连续${WINDOW}秒零在途+即时复核通过"

step "2 停止写入服务（真实验证停止）"
if ! $SYSCTL_CMD stop wenmi-api; then
  fail "stop wenmi-api 失败：不执行VACUUM" 3
fi
vmt_sleep 2
$SYSCTL_CMD is-active --quiet wenmi-api && fail "API仍active，停止未生效" 3
$SYSCTL_CMD is-active --quiet wenmi-worker && fail "Worker仍active（Requires未联动），停止未生效" 3
echo "API/Worker均已停止"
FOUT=$($FUSER_CMD "$DB" "$DB-wal" "$DB-shm" 2>/dev/null); FRC=$?
if [ $FRC -gt 1 ]; then
  recover_services || true
  fail "fuser执行错误(rc=$FRC)，不能当作无打开者" 3
fi
if [ $FRC -eq 0 ]; then
  recover_services || true
  fail "库仍有其他写者/打开者: $FOUT" 3
fi
echo "无其他写者: PASS"

step "3 前置完整性与逻辑基线"
strict_integrity "$DB" || fail "前置完整性不通过：原库不可证健康，不自动恢复服务" 5
VBEFORE=$(mktemp /tmp/vac-logic.XXXXXXXX) || fail mktemp失败 70
vmt_reg "$VBEFORE"
logical_snapshot "$VBEFORE" || { recover_services || true; fail "前置逻辑指纹失败(读取错误，原库完整已恢复服务)" 5; }

step "4 停服后维护快照（独占创建，失败/信号均保留）"
SNAP_DIR="$(dirname "$DB")/vacuum-maint-snap-$(date -u +%Y%m%dT%H%M%S)-$$"
if ! mkdir "$SNAP_DIR" 2>/dev/null; then
  recover_services || true
  fail "快照目录已存在或创建失败(独占): $SNAP_DIR" 4
fi
if [ "$VMT_MODE" != test ]; then
  chown wenmi:wenmi "$SNAP_DIR" || { recover_services || true; fail "快照目录属主设置失败" 4; }
  # 实测wenmi可写（真实权限验证，非SQL shim可掩盖）
  if ! sudo -u wenmi touch "$SNAP_DIR/.writetest" 2>/dev/null; then
    recover_services || true
    fail "wenmi无法写入快照目录(权限实测失败)" 4
  fi
  rm -f "$SNAP_DIR/.writetest"
fi
if ! $SQL_CMD "$DB" "VACUUM INTO '$SNAP_DIR/maint.sqlite';"; then
  recover_services || true
  fail "快照失败(保护点已保留于 $SNAP_DIR)" 4
fi
strict_integrity "$SNAP_DIR/maint.sqlite" || { recover_services || true; fail "快照完整性异常(保护点已保留)" 4; }
echo "快照: $SNAP_DIR/maint.sqlite $(stat -c %s "$SNAP_DIR/maint.sqlite" 2>/dev/null)"

step "5 原地VACUUM"
DF0=$(df --output=avail -B1 "$(dirname "$DB")" | tail -1)
T0=$(date +%s)
VRC=0
$SQL_CMD "$DB" "VACUUM;" || VRC=$?
T1=$(date +%s); DF1=$(df --output=avail -B1 "$(dirname "$DB")" | tail -1)
echo "VACUUM rc=$VRC 耗时=$((T1-T0))s df: $DF0 → $DF1"
if [ $VRC -ne 0 ]; then
  # 不凭"事务性"断定健康：恢复前重新核验
  if strict_integrity "$DB"; then
    recover_services || true
    fail "VACUUM失败rc=$VRC；库重新核验完整，已恢复服务" 6
  else
    fail "VACUUM失败rc=$VRC且库核验不通过：不启动服务，人工核查(快照保留)" 6
  fi
fi

step "6 事后核验（失败不自动恢复、快照保留）"
stat -c '%s %n' "$DB"
$SQL_CMD -readonly "$DB" "PRAGMA page_count; PRAGMA freelist_count;"
strict_integrity "$DB" || fail "事后完整性不通过：不启动服务，人工核查(快照保留: $SNAP_DIR)" 7
VAFTER=$(mktemp /tmp/vac-logic.XXXXXXXX) || fail mktemp失败 70
vmt_reg "$VAFTER"
logical_snapshot "$VAFTER" || fail "事后逻辑指纹失败：不启动服务(快照保留)" 7
if [ "$VMT_MODE" = test ] && [ "${WENMI_VMT_CORRUPT_AFTER_SNAPSHOT:-0}" = 1 ]; then
  echo 'INJECTED=MISMATCH' >> "$VAFTER"
fi
if ! diff -q "$VBEFORE" "$VAFTER" >/dev/null 2>&1; then
  diff "$VBEFORE" "$VAFTER" | head -10
  fail "逻辑指纹不一致：不启动服务(快照保留: $SNAP_DIR)" 7
fi
echo "完整性/外键/逻辑指纹一致: PASS"

step "7 恢复服务"
recover_services || fail "服务恢复降级(见上)，人工核查" 8
echo "维护快照保留: $SNAP_DIR（收尾决定保留/清理）"
echo MAINT-DONE
} > "$LOG" 2>&1
cat "$LOG"
grep -q MAINT-DONE "$LOG" && echo VACUUM-MAINT-OK || echo VACUUM-MAINT-FAIL
