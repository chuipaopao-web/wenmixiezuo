#!/bin/bash
# AUTH-TAKEOVER-01 生产库空闲页整理（原地VACUUM）维护脚本 v2
#
# v2修正（REBUILD-CLOSEOUT S0.2，四项确认缺陷）：
#  1. 逻辑/完整性核验失败不再自动恢复服务：VACUUM提交后库已被修改，失败时库状态不可证健康，
#     启动API=对可疑库写入——保持服务停止并报告，交人工处置。
#     仅"原库未修改且已证健康"的失败（前置完整性通过后的快照失败/逻辑前置失败/VACUUM自身rc失败）
#     才按API→Worker顺序恢复服务。
#  2. 完整性检查收紧：integrity_check 输出必须恰为单行 ok；foreign_key_check 输出必须为空。
#     不再宽松grep或仅打印。
#  3. API健康等待超时不得启动Worker：recover_services 中健康未达成即报告并停止，不启Worker。
#  4. 连续零窗口用 while+计数器正确重计时（原 for i=0 写法无法重计满30次），
#     且带总观察上限（默认600秒），超限安全退出（此时尚未停服，无副作用）。
#  另：日志/逻辑快照临时文件改用mktemp唯一路径；INT/TERM清理临时并非零退出；
#     测试注入仅 WENMI_VMT_MODE=test 时生效（生产模式忽略注入变量）。
set -u

DB=/opt/wenmi/data/database/wenmi.sqlite
EXPECT_RELEASE=wm-v7-20260914-151504-a7614958
MAX_OBSERVE=600    # 在途窗口总观察上限（秒）
WINDOW=30          # 连续零秒数
VMT_MODE=production

# ── 可注入测试面（仅test模式） ──
if [ "${WENMI_VMT_MODE:-}" = "test" ]; then
  VMT_MODE=test
  DB="${WENMI_VMT_DB:?test模式需要WENMI_VMT_DB}"
  SQL_CMD="${WENMI_VMT_SQL:?test模式需要WENMI_VMT_SQL}"
  SYSCTL_CMD="${WENMI_VMT_SYSCTL:?test模式需要WENMI_VMT_SYSCTL}"
  HEALTH_CMD="${WENMI_VMT_HEALTH:?test模式需要WENMI_VMT_HEALTH}"
  FUSER_CMD="${WENMI_VMT_FUSER:-fuser}"
  WINDOW="${WENMI_VMT_WINDOW:-30}"
  MAX_OBSERVE="${WENMI_VMT_MAX_OBSERVE:-600}"
  vmt_sleep() { [ "${WENMI_VMT_FAST:-0}" = 1 ] || sleep "$1"; }
else
  SQL_CMD="sudo -u wenmi sqlite3"
  SYSCTL_CMD="systemctl"
  HEALTH_CMD="curl -s --max-time 3 http://127.0.0.1:43111/health"
  FUSER_CMD="fuser"
  vmt_sleep() { sleep "$1"; }
fi

LOG=$(mktemp /tmp/vacuum-maint.XXXXXXXX) || { echo "mktemp失败"; exit 70; }
TMPFILES="$LOG"
exec 8>&2 || true   # 保留真实stderr：主流程块重定向后fail()的诊断经fd8送达控制台
vmt_reg() { TMPFILES="$TMPFILES $1"; }
vmt_cleanup() { for f in $TMPFILES; do rm -f "$f" 2>/dev/null || true; done; }
trap vmt_cleanup EXIT
trap 'echo "收到信号，非零退出"; exit 130' INT
trap 'echo "收到信号，非零退出"; exit 143' TERM

fail() {
  # 主流程块将stdout/stderr都重定向进LOG并在退出时清理；fd8保留真实stderr，
  # 失败诊断必须走fd8否则随LOG一起丢失
  echo "FATAL: $1" >&8 2>/dev/null || echo "FATAL: $1"
  [ -f "${LOG:-}" ] && tail -60 "$LOG" >&8 2>/dev/null
  echo "MAINT-ABORT" >&8 2>/dev/null || echo "MAINT-ABORT"
  exit "${2:-1}"
}
step() { echo ""; echo "===== $1 ====="; }

# 严格完整性：$1=db路径；0=通过
strict_integrity() {
  local out
  out=$($SQL_CMD -readonly "$1" "PRAGMA integrity_check;" 2>/dev/null) || return 1
  [ "$out" = "ok" ] || return 1
  out=$($SQL_CMD -readonly "$1" "PRAGMA foreign_key_check;" 2>/dev/null) || return 1
  [ -z "$out" ] || return 1
  return 0
}

logical_snapshot() {  # $1=输出文件（仅hash/计数）
  python3 - "$DB" > "$1" <<'PY' || return 1
import hashlib, sqlite3, sys
try:
    db = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
    def fp(t):
        rows = db.execute(f'SELECT * FROM "{t}"').fetchall()
        h = hashlib.sha256()
        for r in sorted(rows, key=lambda x: repr(x)):
            h.update(repr(r).encode())
        return f'{len(rows)}:{h.hexdigest()[:16]}'
    lines = []
    schema = sorted(r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))
    lines.append('schema_sha=' + hashlib.sha256('\n'.join(schema).encode()).hexdigest()[:16])
    for t in ['owners','user_accounts','user_memberships','membership_transactions','auth_sessions',
              'auth_audit_events','account_usage_purge_archive','deletion_tombstones','books',
              'v7_opening_agent_tasks','tm2_books','tm2_steps','tm2_outbox','budgets',
              'creative_reference_cards','v7_prompt_manifests','v7_task_contracts']:
        try:
            lines.append(f'{t}=' + fp(t))
        except Exception:
            lines.append(f'{t}=ABSENT')
    lines.append('mig_sha=' + hashlib.sha256(repr(db.execute("SELECT name, checksum FROM schema_migrations ORDER BY name").fetchall()).encode()).hexdigest()[:16])
    lines.append('fts=%d,%d' % (db.execute('SELECT COUNT(*) FROM content_chunks_fts').fetchone()[0], db.execute('SELECT COUNT(*) FROM content_fts').fetchone()[0]))
    print('\n'.join(lines))
except Exception as e:
    print(f'SNAPSHOT-ERR:{e}')
PY
}

recover_services() {  # API健康成功才启Worker；健康超时不启Worker并报告
  echo "恢复服务（API→健康→Worker）"
  $SYSCTL_CMD reset-failed wenmi-worker 2>/dev/null || true
  $SYSCTL_CMD start wenmi-api
  local ok=""
  for i in $(seq 1 60); do
    if $HEALTH_CMD 2>/dev/null | grep -q "\"releaseId\""; then ok=1; break; fi
    vmt_sleep 1
  done
  if [ -z "$ok" ]; then
    echo "RECOVERY-DEGRADED: API健康等待超时，不启动Worker，需人工核查"
    return 1
  fi
  $SYSCTL_CMD start wenmi-worker || { echo "Worker启动失败，需人工"; return 1; }
  vmt_sleep 5
  $SYSCTL_CMD is-active wenmi-api wenmi-worker
  $HEALTH_CMD; echo
  return 0
}

inflight_query() {
  $SQL_CMD -readonly "$DB" "SELECT (SELECT COUNT(*) FROM tasks WHERE status IN ('working','queued','pending','waiting_confirmation')) + (SELECT COUNT(*) FROM tm2_steps WHERE state='running') + (SELECT COUNT(*) FROM v7_opening_agent_tasks WHERE lease_expires_at IS NOT NULL AND lease_expires_at > datetime('now'));"
}

{
step "0 互斥锁"
LOCK_PATH="${WENMI_VMT_LOCK:-/tmp/wenmi-space-cleanup.0.lock}"
[ "$VMT_MODE" = test ] && LOCK_PATH="${WENMI_VMT_LOCK:-/tmp/wenmi-vmt-test-$$.$RANDOM.lock}"
exec 9>"$LOCK_PATH" || fail "锁文件无法打开: $LOCK_PATH" 70
flock -n 9 || fail "锁被持有（清理/发布/维护互斥）" 66

step "1 状态与在途窗口（连续${WINDOW}秒，总上限${MAX_OBSERVE}s）"
$SYSCTL_CMD is-active wenmi-api wenmi-worker
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

step "2 停止写入服务"
$SYSCTL_CMD stop wenmi-api
vmt_sleep 2
$SYSCTL_CMD is-active wenmi-api wenmi-worker || true
if $FUSER_CMD "$DB" "$DB-wal" "$DB-shm" 2>/dev/null; then
  recover_services || true
  fail "库仍有其他写者/打开者" 3
fi
echo "无其他写者: PASS"

step "3 前置完整性与逻辑基线（原库可证健康才允许后续失败时恢复服务）"
strict_integrity "$DB" || fail "前置完整性不通过：原库不可证健康，不自动恢复服务，人工核查" 5
VBEFORE=$(mktemp /tmp/vac-logic.XXXXXXXX) || fail mktemp失败
vmt_reg "$VBEFORE"
logical_snapshot "$VBEFORE" || { recover_services || true; fail "前置逻辑快照失败（原库完整，已恢复服务）" 5; }
grep -q 'SNAPSHOT-ERR' "$VBEFORE" && { recover_services || true; fail "前置逻辑快照异常（原库完整，已恢复服务）" 5; }

step "4 停服后维护快照（覆盖当前状态）"
SNAP_DIR="$(dirname "$DB")/vacuum-maint-snap-$(date -u +%Y%m%dT%H%M%S)"
mkdir -p "$SNAP_DIR"
$SQL_CMD "$DB" "VACUUM INTO '$SNAP_DIR/maint.sqlite';" || { r=$?; recover_services || true; rm -rf "$SNAP_DIR"; fail "快照失败(rc=$r，原库完整已恢复服务)" 4; }
strict_integrity "$SNAP_DIR/maint.sqlite" || { recover_services || true; rm -rf "$SNAP_DIR"; fail "快照完整性异常（原库完整已恢复服务）" 4; }
echo "快照: $SNAP_DIR/maint.sqlite $(stat -c %s "$SNAP_DIR/maint.sqlite" 2>/dev/null)"

step "5 原地VACUUM"
DF0=$(df --output=avail -B1 "$(dirname "$DB")" | tail -1)
T0=$(date +%s)
$SQL_CMD "$DB" "VACUUM;"
RC=$?
T1=$(date +%s); DF1=$(df --output=avail -B1 "$(dirname "$DB")" | tail -1)
echo "VACUUM rc=$RC 耗时=$((T1-T0))s df: $DF0 → $DF1"
if [ $RC -ne 0 ]; then
  # VACUUM事务性：原库未修改，且步骤3已证健康 → 允许恢复
  recover_services || true
  fail "VACUUM失败（事务性，原库未修改且已证健康，已恢复服务）" 6
fi

step "6 事后核验（失败不自动恢复：库已被VACUUM修改，状态不可证即停）"
stat -c '%s %n' "$DB"
$SQL_CMD -readonly "$DB" "PRAGMA page_count; PRAGMA freelist_count;"
strict_integrity "$DB" || { rm -rf "$SNAP_DIR"; fail "事后完整性不通过：不启动服务，人工核查（快照已删，正式备份仍可回退参照）" 7; }
VAFTER=$(mktemp /tmp/vac-logic.XXXXXXXX) || fail mktemp失败
vmt_reg "$VAFTER"
logical_snapshot "$VAFTER" || { rm -rf "$SNAP_DIR"; fail "事后逻辑快照失败：不启动服务，人工核查" 7; }
if [ "$VMT_MODE" = test ] && [ "${WENMI_VMT_CORRUPT_AFTER_SNAPSHOT:-0}" = 1 ]; then
  echo 'INJECTED=MISMATCH' >> "$VAFTER"
fi
if grep -q 'SNAPSHOT-ERR' "$VAFTER" || ! diff -q "$VBEFORE" "$VAFTER" >/dev/null 2>&1; then
  diff "$VBEFORE" "$VAFTER" | head -10
  rm -rf "$SNAP_DIR"
  fail "逻辑快照不一致：不启动服务（写者不启动），人工核查" 7
fi
echo "完整性/外键/逻辑快照一致: PASS"

step "7 恢复服务"
recover_services || fail "服务恢复降级（见上），人工核查" 8
$SYSCTL_CMD show wenmi-api -p MainPID; $SYSCTL_CMD show wenmi-worker -p MainPID
echo "维护快照保留: $SNAP_DIR（收尾决定保留/清理）"
echo MAINT-DONE
} > "$LOG" 2>&1
cat "$LOG"
grep -q MAINT-DONE "$LOG" && echo VACUUM-MAINT-OK || echo VACUUM-MAINT-FAIL
