#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# R192 新时光机（迁移0114—0118 + API/Worker + V7静态）安全发布。
# 机制沿用r128：/opt/wenmi/apps符号链接原子切换、发布目录构建、迁移预检跑在备份副本上。
[[ $# == 3 ]] || { echo 'usage: deploy-r192-time-machine.sh fix8 archive-sha stage|cutover' >&2; exit 64; }
FIX=$1
SHA=$2
MODE=$3
[[ $FIX =~ ^[a-f0-9]{8}$ && $SHA =~ ^[a-f0-9]{64}$ && $MODE =~ ^(stage|cutover)$ && $EUID == 0 ]] || exit 64

BASE=wm-v7-20260910-011000-635a6ed3
NEW=wm-v7-20260912-180500-$FIX
ROOT=/opt/wenmi-releases/$NEW
SRC=$ROOT/source
OLD=/opt/wenmi-releases/$BASE/source
DB=/opt/wenmi/data/database/wenmi.sqlite
STATIC_OLD=/opt/wenmi/releases/versions/c25b6a3fa0efcf59ce23
ARCHIVE=/tmp/r192-$FIX.tar.gz
PLAN_TARGET=/opt/wenmi/docs/REBUILD_EXECUTION_PLAN.md
ENV_FILE=/opt/wenmi/deploy/.env.production

exec 9>/opt/wenmi-releases/.deploy.lock
flock -n 9

[[ $(cat /opt/wenmi/RELEASE_ID) == "$BASE" ]]
[[ $(readlink -f /opt/wenmi/apps) == "$OLD/apps" ]]
[[ $(readlink -f /opt/wenmi/releases/current) == "$STATIC_OLD" ]]
[[ -d /opt/wenmi/docs ]]
[[ -f "$DB" && ! -L "$DB" ]]
printf '%s  %s\n' "$SHA" "$ARCHIVE" | sha256sum -c -

active_count() { python3 "$SRC/scripts/release/r119-active-count.py" "$DB"; }
atomic_link() { rm -f "$2.r192-next"; ln -s "$1" "$2.r192-next"; mv -Tf "$2.r192-next" "$2"; }
switch_static() { rm -f /opt/wenmi/releases/.r192-next; ln -s "$1" /opt/wenmi/releases/.r192-next; mv -Tf /opt/wenmi/releases/.r192-next /opt/wenmi/releases/current; }
write_release() {
  printf '%s\n' "$1" >/opt/wenmi/RELEASE_ID.r192-next
  chown wenmi:wenmi /opt/wenmi/RELEASE_ID.r192-next
  chmod 644 /opt/wenmi/RELEASE_ID.r192-next
  mv -Tf /opt/wenmi/RELEASE_ID.r192-next /opt/wenmi/RELEASE_ID
}
api_ready() {
  for _ in $(seq 1 30); do
    if curl -fsS "$1" >"$2" 2>/dev/null &&
      grep -Fq "\"releaseId\":\"$3\"" "$2" &&
      grep -Fq '"status":"ok"' "$2"; then return 0; fi
    sleep 1
  done
  return 1
}
worker_current() {
  python3 - "$DB" "$1" "$(systemctl show -p MainPID --value wenmi-worker)" <<'PY'
import sqlite3,sys,datetime
d=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=5)
rows=d.execute('SELECT heartbeat_at FROM worker_health WHERE release_id=? AND process_id=?',(sys.argv[2],int(sys.argv[3]))).fetchall()
now=datetime.datetime.now(datetime.timezone.utc)
ok=any(0 <= (now-datetime.datetime.fromisoformat(r[0].replace('Z','+00:00'))).total_seconds() < 15 for r in rows)
sys.exit(0 if ok else 1)
PY
}
health() {
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:43111/health >"$ROOT/health.json" 2>/dev/null &&
      grep -Fq "\"releaseId\":\"$1\"" "$ROOT/health.json" &&
      grep -Fq '"worker":"ready"' "$ROOT/health.json" &&
      grep -Fq '"status":"ok"' "$ROOT/health.json" && worker_current "$1"; then return 0; fi
    sleep 1
  done
  return 1
}
wait_zero_window() {
  local label=$1
  local max_seconds=${2:-300}
  local zero=0
  local active
  for n in $(seq 1 "$max_seconds"); do
    active=$(active_count)
    if [[ $active == 0 ]]; then zero=$((zero+1)); else zero=0; fi
    if [[ $zero == 1 || $zero == 30 || $((n%30)) == 0 ]]; then
      echo "$label active=$active zero_window=$zero/30"
    fi
    [[ $zero -ge 30 ]] && break
    sleep 1
  done
  [[ $zero -ge 30 && $(active_count) == 0 ]]
}
remember_plan_state() {
  if [[ -e "$PLAN_TARGET" ]]; then
    [[ -f "$PLAN_TARGET" && ! -L "$PLAN_TARGET" ]]
    cp -a "$PLAN_TARGET" "$ROOT/plan-before"
    printf 'present\n' >"$ROOT/plan-before-state"
  else
    printf 'absent\n' >"$ROOT/plan-before-state"
  fi
}
publish_plan() {
  [[ -f "$SRC/docs/REBUILD_EXECUTION_PLAN.md" && ! -L "$SRC/docs/REBUILD_EXECUTION_PLAN.md" ]]
  install -o wenmi -g wenmi -m 644 "$SRC/docs/REBUILD_EXECUTION_PLAN.md" "$PLAN_TARGET.r192-next"
  mv -Tf "$PLAN_TARGET.r192-next" "$PLAN_TARGET"
}
restore_plan() {
  if [[ -f "$ROOT/plan-before-state" && $(cat "$ROOT/plan-before-state") == present ]]; then
    install -o wenmi -g wenmi -m 644 "$ROOT/plan-before" "$PLAN_TARGET.r192-rollback"
    mv -Tf "$PLAN_TARGET.r192-rollback" "$PLAN_TARGET"
  else
    rm -f "$PLAN_TARGET"
  fi
}
# 迁移驱动：既用于预检副本也用于正式库；始终以wenmi运行，目录属主先修正。
# runMigrations自带已应用清单与校验和核对，重复执行返回空applied。
migrate_driver() {
  local target_db=$1
  mkdir -p "$(dirname "$target_db")"
  chown -R wenmi:wenmi "$(dirname "$target_db")"
  sudo -u wenmi node "$SRC/scripts/release/r192-migrate-driver.mjs" "$target_db" "$SRC"
}
verify_tm2_schema() {
  local target_db=$1
  local tables cols
  tables=$(sudo -u wenmi sqlite3 -readonly "$target_db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tm2_books','tm2_candidates','tm2_steps','tm2_attempts','tm2_model_calls','tm2_design_runs','tm2_outbox','tm2_numbers','tm2_adoptions','tm2_reviews','tm2_operations','tm2_consumptions','tm2_context_cards');")
  cols=$(sudo -u wenmi sqlite3 -readonly "$target_db" "SELECT COUNT(*) FROM pragma_table_info('tm2_design_runs') WHERE name IN ('scheme','round_key');")
  if [[ $tables != 13 || $cols != 2 ]]; then echo "tm2 schema check failed tables=$tables cols=$cols" >&2; exit 70; fi
}

if [[ $MODE == stage ]]; then
  [[ ! -e "$ROOT" ]]
  [[ $(df --output=avail -B1 /opt/wenmi | tail -1) -gt 3221225472 ]]
  mkdir -p "$SRC"
  python3 - "$ARCHIVE" "$SRC" <<'PY'
import pathlib,sys,tarfile
archive,target=sys.argv[1:3]
with tarfile.open(archive) as t:
    seen=set()
    for m in t:
        p=pathlib.PurePosixPath(m.name)
        if m.issym() or m.islnk() or not (m.isfile() or m.isdir()):
            raise RuntimeError(f'unsafe package member type: {m.name}')
        if p.is_absolute() or '..' in p.parts or not p.parts or '\\' in m.name:
            raise RuntimeError(f'unsafe package member: {m.name}')
        if m.isfile() and m.name in seen:
            raise RuntimeError(f'duplicate package member: {m.name}')
        seen.add(m.name)
    t.extractall(target,filter='data')
PY
  printf '%s\n' "$NEW" >"$SRC/RELEASE_ID"
  [[ -f "$SRC/docs/REBUILD_EXECUTION_PLAN.md" ]]
  for m in 0114_time_machine_core 0115_time_machine_execution 0116_time_machine_model_calls 0117_time_machine_design_runs 0118_time_machine_design_schemes; do
    [[ -f "$SRC/apps/api/src/infrastructure/db/migrations/$m.sql" ]]
  done
  [[ -f "$SRC/scripts/release/r119-active-count.py" && -f "$SRC/scripts/release/r192-migrate-driver.mjs" ]]
  python3 - "$OLD/package-lock.json" "$SRC/package-lock.json" <<'PY'
import json,sys
old,new=[json.load(open(x))['packages'] for x in sys.argv[1:]]
external=lambda d:{k:v for k,v in d.items() if k.startswith('node_modules/') and not v.get('link')}
assert external(old)==external(new),'External dependency change requires separate install'
PY
  chown -R wenmi:wenmi "$SRC"
  chmod 755 "$ROOT"
  cp -al "$OLD/node_modules" "$SRC/node_modules"
  ln -s ../../rebuild/packages/backend/src/legacy-opening "$SRC/node_modules/@wenmi/opening-runtime"
  ln -s ../../rebuild/packages/time-machine-core "$SRC/node_modules/@wenmi/time-machine-core"
  cd "$SRC"
  npm run build -w @wenmi/contracts >"$ROOT/build-contracts.log" 2>&1
  npm run build -w @wenmi/v7-backend >"$ROOT/build-v7-backend.log" 2>&1
  npm run build -w @wenmi/api >"$ROOT/build-api.log" 2>&1
  npm run build -w @wenmi/worker >"$ROOT/build-worker.log" 2>&1
  npm run build:v7:web >"$ROOT/build-web.log" 2>&1
  # 构建以root+umask 077运行会把dist写成root:700，API/Worker以wenmi读取会ENOENT；构建后统一归还属主。
  chown -R wenmi:wenmi "$SRC"
  node node_modules/tsx/dist/cli.mjs scripts/quality/verify-v7-runtime-source-closure.ts --output artifacts/r192-closure.json >"$ROOT/closure.log" 2>&1
  node node_modules/tsx/dist/cli.mjs scripts/release/verify-v7-release-module-resolution.ts --release-source "$SRC" --manifest "$SRC/artifacts/r192-closure.json" >"$ROOT/modules.log" 2>&1
  # 隔离启动：全新临时库跑迁移，再用发布dist启动API，核对版本号与时光机路由注册。
  mkdir -p "$ROOT/runtime-data"
  chown wenmi:wenmi "$ROOT/runtime-data"
  migrate_driver "$ROOT/runtime-data/database/wenmi.sqlite" >"$ROOT/runtime-migrate.json"
  verify_tm2_schema "$ROOT/runtime-data/database/wenmi.sqlite"
  sudo -u wenmi bash -c "cd '$SRC' && set -a && . '$ENV_FILE' && set +a && WENMI_PROJECT_ROOT='$SRC' WENMI_DATA_DIR='$ROOT/runtime-data' WENMI_API_PORT=43199 WENMI_TIME_MACHINE_CONTEXT_WINDOW=64000 node apps/api/dist/main.js" >"$ROOT/runtime-api.log" 2>&1 &
  BOOT_PID=$!
  api_ready "http://127.0.0.1:43199/health" "$ROOT/runtime-health.json" "$NEW" || { echo 'isolated API boot failed' >&2; sudo fuser -k 43199/tcp || true; wait "$BOOT_PID" 2>/dev/null || true; exit 70; }
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:43199/api/time-machine/books/probe/state)
  STATE=$(curl -fsS http://127.0.0.1:43199/health)
  sudo fuser -k 43199/tcp || true
  wait "$BOOT_PID" 2>/dev/null || true
  [[ $CODE == 401 ]] || { echo "tm2 route probe got $CODE" >&2; exit 70; }
  printf '%s\n' "$STATE" >"$ROOT/runtime-health-final.json"
  # 备份与迁移预检：备份后把0114—0118应用到副本，核对完整性、外键、作者数据计数不变。
  nice -n 15 ionice -c 2 -n 7 sudo -u wenmi timeout 900 bash /opt/wenmi/deploy/backup.sh >"$ROOT/backup.log" 2>&1
  backup=$(find /opt/wenmi/data/backups/daily -mindepth 1 -maxdepth 1 -type d ! -name '.*' -exec test -f '{}/.complete' ';' -printf '%T@ %f\n' | sort -nr | head -1 | awk '{print $2}')
  [[ -n $backup ]]
  printf '%s\n' "$backup" >"$ROOT/backup-id"
  mkdir -p "$ROOT/preflight"
  cp "/opt/wenmi/data/backups/daily/$backup/wenmi.sqlite" "$ROOT/preflight/wenmi.sqlite"
  chown -R wenmi:wenmi "$ROOT/preflight"
  for t in books user_accounts tasks file_registry; do
    sudo -u wenmi sqlite3 -readonly "$ROOT/preflight/wenmi.sqlite" "SELECT '$t', COUNT(*) FROM $t;" >>"$ROOT/preflight/counts-before.txt"
  done
  migrate_driver "$ROOT/preflight/wenmi.sqlite" >"$ROOT/preflight/migrate.json"
  migrate_driver "$ROOT/preflight/wenmi.sqlite" >"$ROOT/preflight/migrate-again.json"
  grep -Fq '"applied":[]' "$ROOT/preflight/migrate-again.json"
  verify_tm2_schema "$ROOT/preflight/wenmi.sqlite"
  [[ $(sudo -u wenmi sqlite3 -readonly "$ROOT/preflight/wenmi.sqlite" 'PRAGMA quick_check;') == ok ]]
  [[ $(sudo -u wenmi sqlite3 -readonly "$ROOT/preflight/wenmi.sqlite" 'PRAGMA foreign_key_check;' | wc -l) == 0 ]]
  for t in books user_accounts tasks file_registry; do
    sudo -u wenmi sqlite3 -readonly "$ROOT/preflight/wenmi.sqlite" "SELECT '$t', COUNT(*) FROM $t;" >>"$ROOT/preflight/counts-after.txt"
  done
  diff -q "$ROOT/preflight/counts-before.txt" "$ROOT/preflight/counts-after.txt"
  # 静态发布：装配+清单校验+安装到版本目录（不切换current）。
  npm run build:v7:static-release >"$ROOT/static.log" 2>&1
  npm run verify:v7:static-release >"$ROOT/static-verify.log" 2>&1
  ID=$(python3 -c 'import json; print(json.load(open("artifacts/v7-static-releases/current.json"))["releaseId"])')
  [[ $ID =~ ^[a-f0-9]{20}$ ]]
  TARGET=/opt/wenmi/releases/versions/$ID
  [[ ! -e "$TARGET" ]]
  cp -a "$SRC/artifacts/v7-static-releases/$ID" "$TARGET"
  chown -R wenmi:wenmi "$TARGET"
  find "$TARGET" -type d -exec chmod 755 {} +
  find "$TARGET" -type f -exec chmod 644 {} +
  node "$SRC/scripts/release/verify-v7-static.mjs" "$TARGET" >"$ROOT/verified-static.json"
  printf '%s\n' "$ID" >"$ROOT/static-id"
  remember_plan_state
  touch "$ROOT/stage-passed"
  echo "R192_STAGED release=$NEW static=$ID backup=$backup"
  exit 0
fi

[[ -f "$ROOT/stage-passed" && -f "$ROOT/approved-local-checks" && -f "$ROOT/real-probe-passed" ]]
ID=$(cat "$ROOT/static-id")
[[ $ID =~ ^[a-f0-9]{20}$ ]]
TARGET=/opt/wenmi/releases/versions/$ID
node "$SRC/scripts/release/verify-v7-static.mjs" "$TARGET" >"$ROOT/preactivate-static.json"

if ! wait_zero_window predeploy 300; then
  echo "R192_NOT_DEPLOYED active_tasks_timeout" | tee "$ROOT/not-deployed"
  exit 75
fi

WORKER_PID=$(systemctl show -p MainPID --value wenmi-worker)
API_PID=$(systemctl show -p MainPID --value wenmi-api)
[[ $WORKER_PID -gt 0 && $API_PID -gt 0 ]]
remember_plan_state

rollback() {
  code=$?
  trap - ERR
  if wait_zero_window rollback 300; then
    systemctl stop wenmi-api || true
    atomic_link "$OLD/apps" /opt/wenmi/apps
    write_release "$BASE"
    restore_plan
    switch_static "$STATIC_OLD"
    systemctl start wenmi-api
    api_ready "http://127.0.0.1:43111/health" "$ROOT/rollback-health.json" "$BASE"
    systemctl start wenmi-worker
    health "$BASE"
    echo "R192_ROLLED_BACK code=$code"
  else
    echo "R192_ROLLBACK_DEFERRED active_work" >"$ROOT/rollback-deferred"
  fi
  exit "$code"
}
trap rollback ERR

# 时光机执行窗口配置：缺少时补上（备份原env后追加；不读取也不输出文件内容）。
if ! sudo grep -q '^WENMI_TIME_MACHINE_CONTEXT_WINDOW=' "$ENV_FILE"; then
  sudo cp -a "$ENV_FILE" "$ENV_FILE.before-r192"
  printf 'WENMI_TIME_MACHINE_CONTEXT_WINDOW=64000\n' | sudo tee -a "$ENV_FILE" >/dev/null
fi
sudo grep -q '^WENMI_TIME_MACHINE_CONTEXT_WINDOW=64000' "$ENV_FILE"

# 正式迁移（向后兼容；此时旧代码仍在运行，只新增表不改动旧表）。
[[ $(active_count) == 0 ]]
migrate_driver "$DB" >"$ROOT/real-migrate.json"
verify_tm2_schema "$DB"
[[ $(sudo -u wenmi sqlite3 -readonly "$DB" 'PRAGMA quick_check;') == ok ]]

[[ $(active_count) == 0 ]]
systemctl stop wenmi-api
[[ $(active_count) == 0 ]]
atomic_link "$SRC/apps" /opt/wenmi/apps
write_release "$NEW"
publish_plan
systemctl start wenmi-api
api_ready "http://127.0.0.1:43111/health" "$ROOT/api-ready.json" "$NEW"
systemctl start wenmi-worker
health "$NEW"
NEW_WORKER_PID=$(systemctl show -p MainPID --value wenmi-worker)
[[ $NEW_WORKER_PID -gt 0 && "$NEW_WORKER_PID" != "$WORKER_PID" ]]
switch_static "$TARGET"
ln -s "$STATIC_OLD" /opt/wenmi/releases/.r192-previous
mv -Tf /opt/wenmi/releases/.r192-previous /opt/wenmi/releases/previous

python3 - "$TARGET" "$NEW" <<'PY' >"$ROOT/public-checks.json"
import hashlib,json,pathlib,sys,urllib.request,urllib.error
target,release=pathlib.Path(sys.argv[1]),sys.argv[2]
manifest=json.loads((target/'release-manifest.json').read_text())
checks=[]
for f in manifest['files']:
    with urllib.request.urlopen('https://wenmixiezuo.com/'+f['path'],timeout=30) as r:
        body=r.read()
    assert hashlib.sha256(body).hexdigest()==f['sha256'],f['path']
    checks.append(f['path'])
with urllib.request.urlopen('https://wenmixiezuo.com/health',timeout=30) as r:
    health=json.load(r)['data']
assert health['releaseId']==release and health['status']=='ok' and health['worker']=='ready' and health['canStartModelTasks'] is True
for path in ('/api/v1/auth/me','/api/v1/v7/books','/api/v1/admin/rebuild-control','/api/time-machine/books/probe/state'):
    try:
        with urllib.request.urlopen('https://wenmixiezuo.com'+path,timeout=30) as r: status=r.status
    except urllib.error.HTTPError as e:
        status=e.code
    assert status==401,(path,status)
with urllib.request.urlopen('https://wenmixiezuo.com/',timeout=30) as r:
    assert r.read()==(target/'index.html').read_bytes(),'author entry mismatch'
with urllib.request.urlopen('https://admin.wenmixiezuo.com/v7/',timeout=30) as r:
    assert r.read()==(target/'v7/index.html').read_bytes(),'admin host entry mismatch'
print(json.dumps({'passed':True,'release':release,'static':manifest['releaseId'],'checkedFiles':checks,'health':health,'protected401':['/api/v1/auth/me','/api/v1/v7/books','/api/v1/admin/rebuild-control','/api/time-machine/books/probe/state']}))
PY

trap - ERR
printf 'release=%s\nstatic=%s\ncompleted=%s\noldApiPid=%s\nnewApiPid=%s\noldWorkerPid=%s\nnewWorkerPid=%s\nplan=%s\n' \
  "$NEW" "$ID" "$(date -u --iso-8601=seconds)" "$API_PID" "$(systemctl show -p MainPID --value wenmi-api)" "$WORKER_PID" "$NEW_WORKER_PID" "$PLAN_TARGET" \
  >"$ROOT/deployment-passed.txt"
echo "R192_DEPLOYED release=$NEW static=$ID worker_ready"
