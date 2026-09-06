#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $# == 3 ]] || { echo 'usage: deploy-r128-opening.sh fix8 archive-sha stage|cutover' >&2; exit 64; }
FIX=$1
SHA=$2
MODE=$3
[[ $FIX =~ ^[a-f0-9]{8}$ && $SHA =~ ^[a-f0-9]{64}$ && $MODE =~ ^(stage|cutover)$ && $EUID == 0 ]] || exit 64

BASE=wm-v7-20260906-125500-377cdfd9
NEW=wm-v7-20260906-183000-$FIX
ROOT=/opt/wenmi-releases/$NEW
SRC=$ROOT/source
OLD=/opt/wenmi-releases/$BASE/source
DB=/opt/wenmi/data/database/wenmi.sqlite
STATIC_OLD=/opt/wenmi/releases/versions/52e90ffde24fc1e1e7ad
ARCHIVE=/tmp/r128-$FIX-built.tar.gz
PLAN_TARGET=/opt/wenmi/docs/REBUILD_EXECUTION_PLAN.md

exec 9>/opt/wenmi-releases/.deploy.lock
flock -n 9

[[ $(cat /opt/wenmi/RELEASE_ID) == "$BASE" ]]
[[ $(readlink -f /opt/wenmi/apps) == "$OLD/apps" ]]
[[ $(readlink -f /opt/wenmi/releases/current) == "$STATIC_OLD" ]]
[[ -d /opt/wenmi/docs ]]
[[ -f "$DB" && ! -L "$DB" ]]
printf '%s  %s\n' "$SHA" "$ARCHIVE" | sha256sum -c -

active_count() { python3 "$SRC/scripts/release/r119-active-count.py" "$DB"; }
atomic_link() { rm -f "$2.r128-next"; ln -s "$1" "$2.r128-next"; mv -Tf "$2.r128-next" "$2"; }
switch_static() { rm -f /opt/wenmi/releases/.r128-next; ln -s "$1" /opt/wenmi/releases/.r128-next; mv -Tf /opt/wenmi/releases/.r128-next /opt/wenmi/releases/current; }
write_release() {
  printf '%s\n' "$1" >/opt/wenmi/RELEASE_ID.r128-next
  chown wenmi:wenmi /opt/wenmi/RELEASE_ID.r128-next
  chmod 644 /opt/wenmi/RELEASE_ID.r128-next
  mv -Tf /opt/wenmi/RELEASE_ID.r128-next /opt/wenmi/RELEASE_ID
}
api_ready() {
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:43111/health >"$ROOT/api-ready.json" 2>/dev/null &&
      grep -Fq "\"releaseId\":\"$1\"" "$ROOT/api-ready.json" &&
      grep -Fq '"status":"ok"' "$ROOT/api-ready.json"; then return 0; fi
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
  install -o wenmi -g wenmi -m 644 "$SRC/docs/REBUILD_EXECUTION_PLAN.md" "$PLAN_TARGET.r128-next"
  mv -Tf "$PLAN_TARGET.r128-next" "$PLAN_TARGET"
}
restore_plan() {
  if [[ -f "$ROOT/plan-before-state" && $(cat "$ROOT/plan-before-state") == present ]]; then
    install -o wenmi -g wenmi -m 644 "$ROOT/plan-before" "$PLAN_TARGET.r128-rollback"
    mv -Tf "$PLAN_TARGET.r128-rollback" "$PLAN_TARGET"
  else
    rm -f "$PLAN_TARGET"
  fi
}
verify_old_assets_preserved() {
  python3 - "$STATIC_OLD" "$1" <<'PY'
import hashlib,pathlib,sys
old,target=map(pathlib.Path,sys.argv[1:3])
for folder in ('assets','avatars','v7/assets','v7/avatars'):
    for p in (old/folder).rglob('*'):
        if not p.is_file(): continue
        q=target/p.relative_to(old)
        assert q.is_file() and hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256(q.read_bytes()).digest(),str(p)
PY
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
        if (not m.isfile()) or p.is_absolute() or '..' in p.parts or not p.parts or '\\' in m.name or m.name in seen:
            raise RuntimeError(f'unsafe package member: {m.name}')
        seen.add(m.name)
    t.extractall(target,filter='data')
PY
  [[ $(cat "$SRC/RELEASE_ID") == "$NEW" ]]
  [[ -d "$SRC/admin-dist" && -f "$SRC/admin-dist/index.html" ]]
  [[ -f "$SRC/docs/REBUILD_EXECUTION_PLAN.md" ]]
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
  cd "$SRC"
  npm run build -w @wenmi/contracts >"$ROOT/build-contracts.log" 2>&1
  npm run build -w @wenmi/v7-backend >"$ROOT/build-v7-backend.log" 2>&1
  npm run build -w @wenmi/api >"$ROOT/build-api.log" 2>&1
  npm run build -w @wenmi/worker >"$ROOT/build-worker.log" 2>&1
  npm run build -w @wenmi/v7-author-app >"$ROOT/build-author.log" 2>&1
  diff -qr coauthoring-v7/author-app/dist author-dist >"$ROOT/author-dist-diff.log"
  npm run build -w @wenmi/v7-admin-console >"$ROOT/build-admin.log" 2>&1
  diff -qr coauthoring-v7/admin-console/dist admin-dist >"$ROOT/admin-dist-diff.log"
  node node_modules/tsx/dist/cli.mjs scripts/quality/verify-v7-runtime-source-closure.ts --output artifacts/r128-closure.json >"$ROOT/closure.log"
  node node_modules/tsx/dist/cli.mjs scripts/release/verify-v7-release-module-resolution.ts --release-source "$SRC" --manifest "$SRC/artifacts/r128-closure.json" >"$ROOT/modules.log"
  node scripts/release/r128-opening-probe.mjs --synthetic >"$ROOT/compiled-opening-probe.json"
  node scripts/release/r122-admin-probe.mjs --database "$DB" --project-root "$SRC" >"$ROOT/rebuild-control-probe.json"
  nice -n 15 ionice -c 2 -n 7 sudo -u wenmi timeout 900 bash /opt/wenmi/deploy/backup.sh >"$ROOT/backup.log" 2>&1
  backup=$(find /opt/wenmi/data/backups/daily -mindepth 1 -maxdepth 1 -type d ! -name '.*' -exec test -f '{}/.complete' ';' -printf '%T@ %f\n' | sort -nr | head -1 | awk '{print $2}')
  [[ -n $backup ]]
  printf '%s\n' "$backup" >"$ROOT/backup-id"
  mkdir -p "$ROOT/preflight"
  cp "/opt/wenmi/data/backups/daily/$backup/wenmi.sqlite" "$ROOT/preflight/wenmi.sqlite"
  R128_DB="$ROOT/preflight/wenmi.sqlite" node --input-type=module <<'JS' >"$ROOT/migrations.json"
import {DatabaseSync} from 'node:sqlite';
import {runMigrations} from './apps/api/dist/infrastructure/db/migrations.js';
const db=new DatabaseSync(process.env.R128_DB);db.exec('PRAGMA foreign_keys=ON');
for(let i=0;i<2;i++)if(runMigrations(db,process.cwd()+'/apps/api/src/infrastructure/db/migrations').applied.length)throw Error('Unexpected migrations');
if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Invalid database');
console.log(JSON.stringify({noMigrations:true,databaseValid:true}));db.close();
JS
  mkdir -p "$ROOT/static-input/author" "$ROOT/static-input/admin"
  python3 - "$STATIC_OLD" "$SRC/admin-dist" "$ROOT/static-input" <<'PY'
import pathlib,shutil,sys
old,admin_dist,root=map(pathlib.Path,sys.argv[1:4])
author=root/'author'; admin=root/'admin'
for p in old.iterdir():
    if p.name in ('v7','release-manifest.json'): continue
    if p.is_dir(): shutil.copytree(p,author/p.name)
    elif p.is_file(): shutil.copy2(p,author/p.name)
shutil.copytree(old/'v7',admin,dirs_exist_ok=True)
shutil.copytree(admin_dist,admin,dirs_exist_ok=True)
shutil.copytree(admin_dist.parent/'author-dist',author,dirs_exist_ok=True)
PY
  R128_STATIC_ROOT="$ROOT/static-input" R128_SOURCE="$SRC" node --input-type=module <<'JS' >"$ROOT/static.json"
const {assembleV7StaticRelease}=await import(process.env.R128_SOURCE+'/scripts/release/v7-static-release.mjs');
console.log(JSON.stringify(await assembleV7StaticRelease({projectRoot:process.env.R128_STATIC_ROOT,authorDist:'author',adminDist:'admin'})));
JS
  ID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["releaseId"])' "$ROOT/static.json")
  [[ $ID =~ ^[a-f0-9]{20}$ ]]
  TARGET=/opt/wenmi/releases/versions/$ID
  [[ ! -e "$TARGET" ]]
  cp -a "$ROOT/static-input/artifacts/v7-static-releases/$ID" "$TARGET"
  chown -R wenmi:wenmi "$TARGET"
  find "$TARGET" -type d -exec chmod 755 {} +
  find "$TARGET" -type f -exec chmod 644 {} +
  node "$SRC/scripts/release/verify-v7-static.mjs" "$TARGET" >"$ROOT/verified-static.json"
    verify_old_assets_preserved "$TARGET"
  printf '%s\n' "$ID" >"$ROOT/static-id"
  remember_plan_state
  touch "$ROOT/stage-passed"
  echo "R128_STAGED release=$NEW static=$ID backup=$backup"
  exit 0
fi

[[ -f "$ROOT/stage-passed" && -f "$ROOT/approved-local-checks" && -f "$ROOT/real-opening-passed" ]]
ID=$(cat "$ROOT/static-id")
[[ $ID =~ ^[a-f0-9]{20}$ ]]
TARGET=/opt/wenmi/releases/versions/$ID
node "$SRC/scripts/release/verify-v7-static.mjs" "$TARGET" >"$ROOT/preactivate-static.json"
verify_old_assets_preserved "$TARGET"
node "$SRC/scripts/release/r122-admin-probe.mjs" --database "$DB" --project-root "$SRC" >"$ROOT/preactivate-probe.json"

if ! wait_zero_window predeploy 300; then
  echo "R128_NOT_DEPLOYED active_tasks_timeout" | tee "$ROOT/not-deployed"
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
    api_ready "$BASE"
    systemctl start wenmi-worker
    health "$BASE"
    echo "R128_ROLLED_BACK code=$code"
  else
    echo "R128_ROLLBACK_DEFERRED active_work" >"$ROOT/rollback-deferred"
  fi
  exit "$code"
}
trap rollback ERR

[[ $(active_count) == 0 ]]
systemctl stop wenmi-api
[[ $(active_count) == 0 ]]
atomic_link "$SRC/apps" /opt/wenmi/apps
write_release "$NEW"
publish_plan
systemctl start wenmi-api
api_ready "$NEW"
systemctl start wenmi-worker
health "$NEW"
NEW_WORKER_PID=$(systemctl show -p MainPID --value wenmi-worker)
[[ $NEW_WORKER_PID -gt 0 && "$NEW_WORKER_PID" != "$WORKER_PID" ]]
switch_static "$TARGET"
ln -s "$STATIC_OLD" /opt/wenmi/releases/.r128-previous
mv -Tf /opt/wenmi/releases/.r128-previous /opt/wenmi/releases/previous

python3 - "$TARGET" "$STATIC_OLD" "$NEW" <<'PY' >"$ROOT/public-checks.json"
import hashlib,json,pathlib,sys,urllib.request,urllib.error
target,old,release=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]),sys.argv[3]
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
for path in ('/api/v1/auth/me','/api/v1/v7/books','/api/v1/admin/rebuild-control'):
    try:
        with urllib.request.urlopen('https://wenmixiezuo.com'+path,timeout=30) as r: status=r.status
    except urllib.error.HTTPError as e:
        status=e.code
    assert status==401,(path,status)
with urllib.request.urlopen('https://wenmixiezuo.com/',timeout=30) as r:
    assert r.read()==(target/'index.html').read_bytes(),'author entry mismatch'
with urllib.request.urlopen('https://admin.wenmixiezuo.com/v7/',timeout=30) as r:
    assert r.read()==(target/'v7/index.html').read_bytes(),'admin host entry mismatch'
print(json.dumps({'passed':True,'release':release,'static':manifest['releaseId'],'checkedFiles':checks,'health':health,'protected401':['/api/v1/auth/me','/api/v1/v7/books','/api/v1/admin/rebuild-control']}))
PY

node "$SRC/scripts/release/r122-admin-probe.mjs" --database "$DB" --project-root /opt/wenmi >"$ROOT/postdeploy-probe.json"
trap - ERR
printf 'release=%s\nstatic=%s\ncompleted=%s\noldApiPid=%s\nnewApiPid=%s\noldWorkerPid=%s\nnewWorkerPid=%s\nplan=%s\n' \
  "$NEW" "$ID" "$(date -u --iso-8601=seconds)" "$API_PID" "$(systemctl show -p MainPID --value wenmi-api)" "$WORKER_PID" "$NEW_WORKER_PID" "$PLAN_TARGET" \
  >"$ROOT/deployment-passed.txt"
echo "R128_DEPLOYED release=$NEW static=$ID worker_ready"
