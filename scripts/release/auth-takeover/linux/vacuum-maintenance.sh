#!/bin/bash
# AUTH-TAKEOVER-01 生产库空闲页整理（原地VACUUM）维护脚本
# 前置（已在本批隔离验证）：SQLite 3.45.1/WAL/auto_vacuum=0；全部业务表显式主键，
#   唯二无主键对象为两个0行的fts5虚拟表；代码rowid使用仅为TEXT主键表上的created_at
#   平局决胜（v7_route_decision_jobs 0行、tm2_design_runs毫秒精度时间戳）——兼容。
#   隔离预演：.backup保形态副本(806MB) VACUUM 2s → 59MB，23表逻辑快照全等。
# 安全设计：
#   - 与清理/发布同一flock互斥；路径规范化校验（仅/opt/wenmi/data/database/wenmi.sqlite）
#   - 30秒连续零在途+即时复核；不取消/暂停/改写任何任务
#   - 停API（Worker经Requires连带）→fuser确认无其他写者→停服后新维护快照（覆盖当前状态）
#   - 原地VACUUM（sqlite3 CLI，事务性；失败原库不变）；禁止手工删WAL/SHM、禁止VACUUM INTO覆盖生产文件
#   - 事后integrity/foreign_key/逻辑快照比对；任一失败→停止后续、按API→Worker恢复服务并报告
#   - 临时物（快照/日志）唯一mktemp式路径，收尾按登记清理
set -u
DB=/opt/wenmi/data/database/wenmi.sqlite
LOG=/tmp/vacuum-maint-$(date -u +%Y%m%dT%H%M%S).log
SNAP_DIR=/opt/wenmi-releases/tmp-vacuum-maint-$(date -u +%Y%m%dT%H%M%S)
EXPECT_RELEASE=wm-v7-20260914-151504-a7614958

fail() { echo "FATAL: $1"; echo "MAINT-ABORT"; exit "${2:-1}"; }
step() { echo ""; echo "===== $1 ====="; }

# 路径规范化校验
[ "$(readlink -f "$DB")" = "$DB" ] || fail "库路径非规范化"
[ -f "$DB" ] || fail "库不存在"

logical_snapshot() {  # $1=输出文件（仅hash/计数）
  sudo -u wenmi python3 - "$DB" > "$1" <<'PY'
import hashlib, sqlite3, sys
db = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
def fp(t):
    rows = db.execute(f'SELECT * FROM "{t}"').fetchall()
    h = hashlib.sha256()
    for r in sorted(rows, key=lambda x: repr(x)):
        h.update(repr(r).encode())
    return f'{len(rows)}:{h.hexdigest()[:16]}'
schema = sorted(r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"))
lines = ['schema_sha=' + hashlib.sha256('\n'.join(schema).encode()).hexdigest()[:16]]
for t in ['owners','user_accounts','user_memberships','membership_transactions','auth_sessions',
          'auth_audit_events','account_usage_purge_archive','deletion_tombstones','books',
          'v7_opening_agent_tasks','tm2_books','tm2_steps','tm2_outbox','budgets',
          'creative_reference_cards','v7_prompt_manifests','v7_task_contracts']:
    lines.append(f'{t}=' + fp(t))
lines.append('migrations_sha=' + hashlib.sha256(repr(db.execute("SELECT name, checksum FROM schema_migrations ORDER BY name").fetchall()).encode()).hexdigest()[:16])
lines.append('fts_live=%d,%d' % (db.execute('SELECT COUNT(*) FROM content_chunks_fts').fetchone()[0], db.execute('SELECT COUNT(*) FROM content_fts').fetchone()[0]))
print('\n'.join(lines))
PY
}

recover_services() {
  echo "恢复服务（API→健康→Worker）"
  systemctl reset-failed wenmi-worker 2>/dev/null || true
  systemctl start wenmi-api
  for i in $(seq 1 60); do
    curl -s --max-time 3 http://127.0.0.1:43111/health 2>/dev/null | grep -q "\"releaseId\":\"$EXPECT_RELEASE\"" && break
    sleep 1
  done
  systemctl start wenmi-worker
  sleep 5
  systemctl is-active wenmi-api wenmi-worker
  curl -s --max-time 5 http://127.0.0.1:43111/health; echo
}

{
step "0 互斥锁"
exec 9>/tmp/wenmi-space-cleanup.0.lock
flock -n 9 || fail "锁被持有（清理/发布/维护互斥）" 66

step "1 状态与在途窗口（连续30秒）"
systemctl is-active wenmi-api wenmi-worker
stat -c '%s %n' "$DB" "$DB-wal" 2>/dev/null
sudo -u wenmi sqlite3 -readonly "$DB" "PRAGMA page_count; PRAGMA freelist_count;"
for i in $(seq 1 30); do
  T1=$(sudo -u wenmi sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM tasks WHERE status IN ('working','queued','pending','waiting_confirmation');")
  T2=$(sudo -u wenmi sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM tm2_steps WHERE state='running';")
  T3=$(sudo -u wenmi sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM v7_opening_agent_tasks WHERE lease_expires_at IS NOT NULL AND lease_expires_at > datetime('now');")
  echo "  t=${i}s $T1/$T2/$T3"
  { [ "$T1" = 0 ] && [ "$T2" = 0 ] && [ "$T3" = 0 ]; } || { echo "  非零，重计时"; i=0; sleep 1; continue; }
  sleep 1
done
T1=$(sudo -u wenmi sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM tasks WHERE status IN ('working','queued','pending','waiting_confirmation');")
T2=$(sudo -u wenmi sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM tm2_steps WHERE state='running';")
T3=$(sudo -u wenmi sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM v7_opening_agent_tasks WHERE lease_expires_at IS NOT NULL AND lease_expires_at > datetime('now');")
[ "$T1$T2$T3" = "000" ] || fail "切换前复核非零" 2

step "2 停止写入服务"
systemctl stop wenmi-api
sleep 2
systemctl is-active wenmi-api wenmi-worker || true
if fuser "$DB" "$DB-wal" "$DB-shm" 2>/dev/null; then
  recover_services
  fail "库仍有其他写者/打开者，已恢复服务" 3
fi
echo "无其他写者: PASS"

step "3 停服后维护快照（覆盖当前状态）"
mkdir -p "$SNAP_DIR"; chown wenmi:wenmi "$SNAP_DIR"
sudo -u wenmi sqlite3 "$DB" "VACUUM INTO '$SNAP_DIR/maint.sqlite';" || { recover_services; fail "快照失败，已恢复服务" 4; }
sudo -u wenmi sqlite3 -readonly "$SNAP_DIR/maint.sqlite" "PRAGMA integrity_check;" | grep -q ok || { recover_services; fail "快照完整性异常，已恢复服务" 4; }
echo "快照: $SNAP_DIR/maint.sqlite $(stat -c %s $SNAP_DIR/maint.sqlite)"

step "4 维护前逻辑快照与完整性"
logical_snapshot /tmp/vac-before.txt
sudo -u wenmi sqlite3 -readonly "$DB" "PRAGMA integrity_check;" | grep -q ok || { recover_services; fail "维护前integrity异常" 5; }
sudo -u wenmi sqlite3 -readonly "$DB" "PRAGMA foreign_key_check;" | head -2

step "5 原地VACUUM"
DF0=$(df --output=avail -B1 / | tail -1)
T0=$(date +%s)
sudo -u wenmi sqlite3 "$DB" "VACUUM;"
RC=$?
T1=$(date +%s); DF1=$(df --output=avail -B1 / | tail -1)
echo "VACUUM rc=$RC 耗时=$((T1-T0))s 前后df: $DF0 → $DF1"
[ $RC -eq 0 ] || { recover_services; fail "VACUUM失败（事务性，原库应未变），已恢复服务" 6; }

step "6 事后核验"
stat -c '%s %n' "$DB"
sudo -u wenmi sqlite3 -readonly "$DB" "PRAGMA page_count; PRAGMA freelist_count; PRAGMA integrity_check;" | head -3
sudo -u wenmi sqlite3 -readonly "$DB" "PRAGMA foreign_key_check;" | head -2
logical_snapshot /tmp/vac-after.txt
if diff /tmp/vac-before.txt /tmp/vac-after.txt; then
  echo "逻辑快照一致: PASS"
else
  recover_services
  fail "逻辑快照不一致，已恢复服务，停止依赖写入并报告" 7
fi
rm -f /tmp/vac-before.txt /tmp/vac-after.txt

step "7 恢复服务"
recover_services
systemctl show wenmi-api -p MainPID; systemctl show wenmi-worker -p MainPID
echo "维护快照保留: $SNAP_DIR（收尾决定保留/清理）"
echo MAINT-DONE
} > "$LOG" 2>&1
cat "$LOG"
grep -q MAINT-DONE "$LOG" && echo VACUUM-MAINT-OK || echo VACUUM-MAINT-FAIL
