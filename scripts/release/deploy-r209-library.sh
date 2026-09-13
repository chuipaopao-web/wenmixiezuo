#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
BASE=wm-v7-20260913-053000-a2080001
NEW=wm-v7-20260913-190000-a2090001
OLD=/opt/wenmi-releases/$BASE/source
ROOT=/opt/wenmi-releases/$NEW
SRC=$ROOT/source
DB=/opt/wenmi/data/database/wenmi.sqlite
STATIC_OLD=/opt/wenmi/releases/versions/976dd329934d83ef1f77
[[ $EUID == 0 && ${1:-} =~ ^(stage|preflight|cutover)$ ]]
exec 9>/opt/wenmi-releases/.deploy.lock
flock -n 9
[[ $(cat /opt/wenmi/RELEASE_ID) == "$BASE" && $(readlink -f /opt/wenmi/apps) == "$OLD/apps" ]]
count(){ python3 "$SRC/scripts/release/r119-active-count.py" "$DB"; }
link(){ [[ ! -e "$2.r209-next" && ! -L "$2.r209-next" ]]; ln -s "$1" "$2.r209-next"; mv -Tf "$2.r209-next" "$2"; }
release(){ printf '%s\n' "$1" >/opt/wenmi/RELEASE_ID.r209-next; chown wenmi:wenmi /opt/wenmi/RELEASE_ID.r209-next; mv -Tf /opt/wenmi/RELEASE_ID.r209-next /opt/wenmi/RELEASE_ID; }
ready(){ for i in $(seq 1 30); do if curl -fsS "http://127.0.0.1:$2/health" >"$ROOT/health-$2.json" 2>/dev/null && grep -Fq "\"releaseId\":\"$1\"" "$ROOT/health-$2.json" && grep -Fq '"status":"ok"' "$ROOT/health-$2.json"; then return 0; fi; sleep 1; done; return 1; }
migrate(){ sudo -u wenmi node "$SRC/scripts/release/r192-migrate-driver.mjs" "$1" "$SRC"; }
backup(){ python3 - "$DB" "$1" <<'PY'
import sqlite3,sys
source=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=15)
dest=sqlite3.connect(sys.argv[2])
source.backup(dest,pages=-1)
dest.close();source.close()
PY
}
if [[ $1 != cutover ]]; then
 if [[ $1 == stage ]]; then
 [[ ! -e "$ROOT" && $(df --output=avail -B1 /opt | tail -1) -gt 2147483648 ]]
 cd /tmp; sha256sum -c r209.tar.gz.sha256
 mkdir -p "$ROOT"; cp -a "$OLD" "$SRC"
 python3 - "$SRC" <<'PY'
import sys,tarfile,pathlib
with tarfile.open('/tmp/r209.tar.gz') as t:
 for m in t:
  p=pathlib.PurePosixPath(m.name)
  assert not p.is_absolute() and '..' not in p.parts and not m.issym() and not m.islnk()
 t.extractall(sys.argv[1],filter='data')
PY
 printf '%s\n' "$NEW" >"$SRC/RELEASE_ID"
 cd "$SRC"
 npm run build -w @wenmi/api >"$ROOT/build-api.log" 2>&1
 npm run build:v7:static-release >"$ROOT/build-static.log" 2>&1
 npm run verify:v7:static-release >"$ROOT/verify-static.log" 2>&1
 ID=$(python3 -c 'import json;print(json.load(open("artifacts/v7-static-releases/current.json"))["releaseId"])')
 [[ $ID =~ ^[a-f0-9]{20}$ ]]
 TARGET=/opt/wenmi/releases/versions/$ID
 [[ ! -e "$TARGET" ]]; cp -a "$SRC/artifacts/v7-static-releases/$ID" "$TARGET"
 cp -an "$STATIC_OLD/assets/." "$TARGET/assets/"
 if [[ -d "$STATIC_OLD/v7/assets" ]]; then mkdir -p "$TARGET/v7/assets"; cp -an "$STATIC_OLD/v7/assets/." "$TARGET/v7/assets/"; fi
 chown -R wenmi:wenmi "$ROOT" "$TARGET"
 find "$TARGET" -type d -exec chmod 755 {} +
 find "$TARGET" -type f -exec chmod 644 {} +
 printf '%s\n' "$ID" >"$ROOT/static-id"
 fi
 [[ -f "$ROOT/static-id" ]]
 ID=$(cat "$ROOT/static-id")
 mkdir -p "$ROOT/preflight"; chmod 700 "$ROOT/preflight"
 backup "$ROOT/preflight/before.sqlite"
 cp "$ROOT/preflight/before.sqlite" "$ROOT/preflight/test.sqlite"
 chown -R wenmi:wenmi "$ROOT/preflight"
 migrate "$ROOT/preflight/test.sqlite" >"$ROOT/preflight/migrate.json"
 migrate "$ROOT/preflight/test.sqlite" >"$ROOT/preflight/repeat.json"
 python3 - "$ROOT/preflight" <<'PY'
import sqlite3,sys,json
from pathlib import Path
p=Path(sys.argv[1]); a=sqlite3.connect(p/'before.sqlite'); b=sqlite3.connect(p/'test.sqlite')
expected=['0122_creative_reference.sql','0123_creative_reference_admin_audit.sql']
assert json.loads((p/'migrate.json').read_text())['applied']==expected
assert json.loads((p/'repeat.json').read_text())['applied']==[]
for (t,) in a.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name!='schema_migrations'"):
 q='select count(*) from "'+t.replace('"','""')+'"'
 assert a.execute(q).fetchone()==b.execute(q).fetchone(),t
print('migration: only 0122/0123, old table counts unchanged')
PY
 mkdir -p "$ROOT/runtime-data"; chown wenmi:wenmi "$ROOT/runtime-data"
 sudo -u wenmi bash -c "cd '$SRC'; set -a; . /opt/wenmi/deploy/.env.production; set +a; WENMI_PROJECT_ROOT='$SRC' WENMI_DATA_DIR='$ROOT/runtime-data' WENMI_API_PORT=43199 node apps/api/dist/main.js" >"$ROOT/isolated.log" 2>&1 &
 PID=$!
 trap 'kill "$PID" 2>/dev/null || true; fuser -k 43199/tcp 2>/dev/null || true' EXIT
 ready "$NEW" 43199
 [[ $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:43199/api/v1/admin/creative-reference/cards) == 401 ]]
 kill "$PID" 2>/dev/null || true; fuser -k 43199/tcp 2>/dev/null || true
 wait "$PID" 2>/dev/null || true; trap - EXIT
 touch "$ROOT/staged"
 echo "STAGED $NEW $ID"
 exit 0
fi
[[ -f "$ROOT/staged" && $(readlink -f /opt/wenmi/releases/current) == "$STATIC_OLD" ]]
[[ -f "$ROOT/rollback-source" && -f "$ROOT/rollback-compatible/migration-check.json" && -f "$ROOT/rollback-compatible/health.json" ]]
ROLLBACK_SRC=$(cat "$ROOT/rollback-source")
[[ $ROLLBACK_SRC == "$ROOT/rollback-compatible/source" && -d "$ROLLBACK_SRC/apps" ]]
TARGET=/opt/wenmi/releases/versions/$(cat "$ROOT/static-id")
zero(){ local n=0; for i in $(seq 1 55); do if [[ $(count) == 0 ]]; then n=$((n+1)); else n=0; fi; [[ $n -ge 30 ]] && break; sleep 1; done; [[ $n -ge 30 && $(count) == 0 ]]; }
zero || { echo DEFERRED_ACTIVE_TASKS; exit 75; }
rollback(){ local code=$?; trap - ERR; if zero; then systemctl stop wenmi-api; link "$ROLLBACK_SRC/apps" /opt/wenmi/apps; release "$BASE"; link "$STATIC_OLD" /opt/wenmi/releases/current; systemctl reset-failed wenmi-api; systemctl start wenmi-api; ready "$BASE" 43111; systemctl start wenmi-worker; echo ROLLED_BACK; else echo ROLLBACK_DEFERRED_ACTIVE_TASKS; fi; exit "$code"; }
trap rollback ERR
[[ $(count) == 0 ]]
backup "$ROOT/preflight/pre-cutover.sqlite"
chmod 600 "$ROOT/preflight/pre-cutover.sqlite"
[[ $(count) == 0 ]]; systemctl stop wenmi-api
[[ $(count) == 0 ]]
migrate "$DB" >"$ROOT/production-migrate.json"
link "$SRC/apps" /opt/wenmi/apps; release "$NEW"
systemctl reset-failed wenmi-api; systemctl start wenmi-api; ready "$NEW" 43111
systemctl start wenmi-worker
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:43111/health >"$ROOT/health.json"; grep -Fq '"worker":"ready"' "$ROOT/health.json" && break; sleep 1; done
grep -Fq '"worker":"ready"' "$ROOT/health.json"
python3 - "$DB" "$NEW" "$(systemctl show -p MainPID --value wenmi-worker)" <<'PY'
import sqlite3,sys,datetime,time
d=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
for _ in range(30):
 rows=d.execute('select heartbeat_at from worker_health where release_id=? and process_id=?',(sys.argv[2],int(sys.argv[3]))).fetchall()
 if any(0 <= (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(t.replace('Z','+00:00'))).total_seconds()<20 for (t,) in rows):break
 time.sleep(1)
else:raise RuntimeError('new worker PID heartbeat not ready')
PY
link "$TARGET" /opt/wenmi/releases/current
curl -fsS https://wenmixiezuo.com/ -o "$ROOT/public-author.html"; cmp "$ROOT/public-author.html" "$TARGET/index.html"
curl -fsS https://admin.wenmixiezuo.com/ -o "$ROOT/public-admin.html"; cmp "$ROOT/public-admin.html" "$TARGET/v7/index.html"
[[ $(curl -s -o /dev/null -w '%{http_code}' https://admin.wenmixiezuo.com/api/v1/admin/creative-reference/cards) == 401 ]]
trap - ERR
touch "$ROOT/deployment-passed"
echo "DEPLOYED $NEW $(cat "$ROOT/static-id")"
