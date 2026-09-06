#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
FIX=$1 SHA=$2 MODE=$3
[[ $FIX =~ ^[a-f0-9]{8}$ && $SHA =~ ^[a-f0-9]{64}$ && $MODE =~ ^(stage|cutover)$ && $EUID == 0 ]]
BASE=wm-v7-20260906-003247-ce17325
NEW=wm-v7-20260906-105500-$FIX
ROOT=/opt/wenmi-releases/$NEW
SRC=$ROOT/source
OLD=/opt/wenmi-releases/$BASE/source
DB=/opt/wenmi/data/database/wenmi.sqlite
STATIC=/opt/wenmi/releases/versions/4f6d09ded6793ff2f998
ARCHIVE=/tmp/r119-$FIX-built.tar.gz
exec 9>/opt/wenmi-releases/.deploy.lock
flock -n 9
[[ $(cat /opt/wenmi/RELEASE_ID) == "$BASE" ]]
[[ $(readlink -f /opt/wenmi/apps) == "$OLD/apps" ]]
[[ $(readlink -f /opt/wenmi/releases/current) == "$STATIC" ]]
printf '%s  %s\n' "$SHA" "$ARCHIVE" | sha256sum -c -
active_count() { python3 "$SRC/scripts/release/r119-active-count.py" "$DB"; }
atomic_link() { ln -s "$1" "$2.r119-next"; mv -Tf "$2.r119-next" "$2"; }
write_release() { printf '%s\n' "$1" >/opt/wenmi/RELEASE_ID.r119-next; chown wenmi:wenmi /opt/wenmi/RELEASE_ID.r119-next; chmod 644 /opt/wenmi/RELEASE_ID.r119-next; mv -Tf /opt/wenmi/RELEASE_ID.r119-next /opt/wenmi/RELEASE_ID; }
api_ready() {
 for n in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:43111/health >"$ROOT/api-ready.json" 2>/dev/null &&
    grep -Fq "\"releaseId\":\"$1\"" "$ROOT/api-ready.json" &&
    grep -Fq '"status":"ok"' "$ROOT/api-ready.json"; then return; fi
  sleep 1
 done
 return 1
}
worker_current() {
 python3 - "$DB" "$1" "$(systemctl show -p MainPID --value wenmi-worker)" <<'PY'
import sqlite3,sys,datetime
d=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
rows=d.execute('SELECT heartbeat_at FROM worker_health WHERE release_id=? AND process_id=?',(sys.argv[2],int(sys.argv[3]))).fetchall()
now=datetime.datetime.now(datetime.timezone.utc)
ok=any(0 <= (now-datetime.datetime.fromisoformat(r[0].replace('Z','+00:00'))).total_seconds() < 15 for r in rows)
sys.exit(0 if ok else 1)
PY
}
health() {
 for n in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:43111/health >"$ROOT/health.json" 2>/dev/null &&
    grep -Fq "\"releaseId\":\"$1\"" "$ROOT/health.json" &&
    grep -Fq '"worker":"ready"' "$ROOT/health.json" &&
    grep -Fq '"status":"ok"' "$ROOT/health.json" && worker_current "$1"; then return; fi
  sleep 1
 done
 return 1
}
if [[ $MODE == stage ]]; then
 [[ ! -e $ROOT ]]
 [[ $(df --output=avail -B1 /opt/wenmi | tail -1) -gt 3221225472 ]]
 mkdir -p "$SRC"
 python3 - "$ARCHIVE" "$SRC" <<'PY'
import tarfile,pathlib,sys
with tarfile.open(sys.argv[1]) as t:
 seen=set()
 for m in t:
  p=pathlib.PurePosixPath(m.name)
  assert m.isfile() and not p.is_absolute() and '..' not in p.parts and m.name not in seen
  seen.add(m.name)
 t.extractall(sys.argv[2],filter='data')
PY
 [[ $(cat "$SRC/RELEASE_ID") == "$NEW" ]]
 cmp "$SRC/package-lock.json" "$OLD/package-lock.json"
 chown -R wenmi:wenmi "$SRC"
 chmod 755 "$ROOT"
 cp -al "$OLD/node_modules" "$SRC/node_modules"
 cd "$SRC"
 node node_modules/tsx/dist/cli.mjs scripts/quality/verify-v7-runtime-source-closure.ts --output artifacts/r119-closure.json >"$ROOT/closure.log"
 node node_modules/tsx/dist/cli.mjs scripts/release/verify-v7-release-module-resolution.ts --release-source "$SRC" --manifest "$SRC/artifacts/r119-closure.json" >"$ROOT/modules.log"
 node node_modules/vitest/vitest.mjs run --configLoader native tests/integration/security/request-policy.test.ts >"$ROOT/policy-tests.log" 2>&1
 node scripts/release/r119-compiled-probe.mjs >"$ROOT/compiled-probe.json"
 # Use the established consistent backup; never mutate/restore author data.
 nice -n 15 ionice -c 2 -n 7 sudo -u wenmi timeout 900 bash /opt/wenmi/deploy/backup.sh >"$ROOT/backup.log" 2>&1
 backup=$(find /opt/wenmi/data/backups/daily -mindepth 1 -maxdepth 1 -type d ! -name '.*' -exec test -f '{}/.complete' ';' -printf '%T@ %f\n' | sort -nr | head -1 | awk '{print $2}')
 [[ -n $backup ]]
 printf '%s\n' "$backup" >"$ROOT/backup-id"
 mkdir -p "$ROOT/preflight"
 cp "/opt/wenmi/data/backups/daily/$backup/wenmi.sqlite" "$ROOT/preflight/wenmi.sqlite"
 R119_DB="$ROOT/preflight/wenmi.sqlite" node --input-type=module <<'JS' >"$ROOT/migrations.json"
import {DatabaseSync} from 'node:sqlite';
import {runMigrations} from './apps/api/dist/infrastructure/db/migrations.js';
const db=new DatabaseSync(process.env.R119_DB);db.exec('PRAGMA foreign_keys=ON');
for(let i=0;i<2;i++)if(runMigrations(db,process.cwd()+'/apps/api/src/infrastructure/db/migrations').applied.length)throw Error('Unexpected migrations');
if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Invalid database');
console.log(JSON.stringify({noMigrations:true,databaseValid:true}));db.close();
JS
 touch "$ROOT/stage-passed"
 echo "R119_STAGED release=$NEW backup=$backup"
 exit 0
fi
[[ -f $ROOT/stage-passed && -f $ROOT/approved-local-checks ]]
zero=0
for n in $(seq 1 1800); do
 active=$(active_count)
 if [[ $active == 0 ]]; then zero=$((zero+1)); else zero=0; fi
 if [[ $zero == 1 || $zero == 30 || $((n%30)) == 0 ]]; then echo "active=$active zero_window=$zero/30"; fi
 sleep 1
 [[ $zero -ge 30 ]] && break
done
[[ $zero -ge 30 && $(active_count) == 0 ]]
WORKER_PID=$(systemctl show -p MainPID --value wenmi-worker)
[[ $WORKER_PID -gt 0 ]]
API_PID=$(systemctl show -p MainPID --value wenmi-api)
rollback() {
 code=$?
 trap - ERR
 if [[ $(active_count) == 0 ]]; then
  systemctl stop wenmi-api
  atomic_link "$OLD/apps" /opt/wenmi/apps
  write_release "$BASE"
  systemctl start wenmi-api
  api_ready "$BASE"
  systemctl start wenmi-worker
  health "$BASE"
  echo "R119_ROLLED_BACK code=$code"
 else echo "R119_ROLLBACK_DEFERRED active_work" >"$ROOT/rollback-deferred"; fi
 exit "$code"
}
trap rollback ERR
[[ $(active_count) == 0 ]]
systemctl stop wenmi-api
[[ $(active_count) == 0 ]]
atomic_link "$SRC/apps" /opt/wenmi/apps
write_release "$NEW"
systemctl start wenmi-api
api_ready "$NEW"
# Requires=wenmi-api.service stops Worker when API is stopped. Start the
# unchanged Worker implementation again before asserting readiness.
systemctl start wenmi-worker
health "$NEW"
[[ $(systemctl show -p MainPID --value wenmi-worker) -gt 0 ]]
[[ $(readlink -f /opt/wenmi/releases/current) == "$STATIC" ]]
curl -fsS https://wenmixiezuo.com/health >"$ROOT/public-health.json"
grep -Fq "\"releaseId\":\"$NEW\"" "$ROOT/public-health.json"
[[ $(curl -s -o /dev/null -w '%{http_code}' https://wenmixiezuo.com/api/v1/auth/me) == 401 ]]
[[ $(curl -s -o /dev/null -w '%{http_code}' https://wenmixiezuo.com/api/v1/v7/books) == 401 ]]
curl -fsS https://wenmixiezuo.com/ >"$ROOT/public-author.html"
cmp "$ROOT/public-author.html" "$STATIC/index.html"
curl -fsS https://admin.wenmixiezuo.com/v7/ >"$ROOT/public-admin.html"
cmp "$ROOT/public-admin.html" "$STATIC/v7/index.html"
trap - ERR
printf 'release=%s\nstatic=%s\ncompleted=%s\noldApiPid=%s\nnewApiPid=%s\noldWorkerPid=%s\nnewWorkerPid=%s\n' "$NEW" "$(basename "$STATIC")" "$(date -u --iso-8601=seconds)" "$API_PID" "$(systemctl show -p MainPID --value wenmi-api)" "$WORKER_PID" "$(systemctl show -p MainPID --value wenmi-worker)" >"$ROOT/deployment-passed.txt"
echo "R119_DEPLOYED release=$NEW worker_ready"
