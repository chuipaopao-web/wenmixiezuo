#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
BASE=wm-v7-20260905-203723-1eefc5c
NEW=wm-v7-20260905-223221-1f9e475
ROOT=/opt/wenmi-releases/$NEW
SRC=$ROOT/source
OLD=/opt/wenmi-releases/$BASE/source
DB=/opt/wenmi/data/database/wenmi.sqlite
ARCHIVE=/tmp/r101-1f9e475-built.tar.gz
SHA=4b5b599f6bd51d93077df61efee8dda2c68cb7fd03dade2c7b1c4c9f20fa79d7
STATIC_OLD=/opt/wenmi/releases/versions/a674f91c4d0d5dfca34e
fail() { echo "R101_FAILED: $*" >&2; exit 1; }
[[ $EUID == 0 ]] || fail root_required
exec 9>/opt/wenmi-releases/.deploy.lock
flock -n 9 || fail deployment_locked
[[ $(cat /opt/wenmi/RELEASE_ID) == "$BASE" ]] || fail baseline_changed
[[ $(readlink -f /opt/wenmi/apps) == "$OLD/apps" ]] || fail apps_changed
[[ $(readlink -f /opt/wenmi/releases/current) == "$STATIC_OLD" ]] || fail static_changed
atomic_link() { ln -s "$1" "$2.r101-next"; mv -Tf "$2.r101-next" "$2"; }
write_release() { printf '%s\n' "$1" >/opt/wenmi/RELEASE_ID.r101-next; chmod 644 /opt/wenmi/RELEASE_ID.r101-next; chown wenmi:wenmi /opt/wenmi/RELEASE_ID.r101-next; mv -Tf /opt/wenmi/RELEASE_ID.r101-next /opt/wenmi/RELEASE_ID; }
active_count() {
 python3 - "$DB" <<'PY'
import sqlite3,sys
d=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=5)
checks={
'tasks':('status',['pending','queued','working','waiting_confirmation','running']),
'model_calls':('state',['pending','queued','working','reserved','started','running']),
'account_usage_supplemental_calls':('state',['working','unknown']),
'prebook_opening_design_calls':('state',['working']),
'book_branding_designs':('status',['working']),
'v7_book_title_design_calls':('state',['working']),
'v7_book_cover_designs':('state',['working']),
'v7_opening_agent_tasks':('status',['queued','working']),
'v7_setting_batches':('status',['queued','working']),
'v7_setting_item_jobs':('state',['queued','working','chief_review']),
'v7_planning_recipe_runs':('status',['queued','working']),
'v7_planning_generation_runs':('status',['queued','working']),
'v7_planning_maintenance_runs':('status',['queued','working']),
'v7_character_context_packs':('status',['queued','working']),
'v7_character_maintenance_runs':('status',['queued','working']),
'v7_creation_workflows':('status',['queued','working']),
'v7_creation_context_packs':('status',['queued','working']),
'v7_creation_stage_jobs':('status',['pending','working']),
'v7_formalization_outbox':('status',['pending','working']),
'v7_managed_creation_runs':('status',['active'])}
for prefix in ['opening_agent','setting','planning','character','creation']:
 checks['v7_'+prefix+'_model_calls']=('state',['working'])
if d.execute("SELECT 1 FROM sqlite_master WHERE name='v7_route_decision_jobs'").fetchone():
 checks['v7_route_decision_jobs']=('status',['queued','working','unknown'])
total=0
for table,(col,states) in checks.items():
 total+=d.execute('SELECT count(*) FROM '+table+' WHERE '+col+' IN ('+','.join('?'*len(states))+')',states).fetchone()[0]
print(total)
PY
}
health() {
 local release=$1 worker=${2:-}
 for n in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:43111/health >"$ROOT/health.json" 2>/dev/null && grep -Fq "\"releaseId\":\"$release\"" "$ROOT/health.json" && grep -Fq '"status":"ok"' "$ROOT/health.json"; then
   if [[ -z $worker ]] || grep -Fq '"worker":"ready"' "$ROOT/health.json"; then return; fi
  fi
  sleep 1
 done
 return 1
}
if [[ ${1:-} == stage ]]; then
 printf '%s  %s\n' "$SHA" "$ARCHIVE" | sha256sum -c -
 [[ $(df --output=avail -B1 /opt/wenmi | tail -1) -gt 5368709120 ]] || fail insufficient_space
 if [[ ! -e $ROOT ]]; then
 python3 - "$ARCHIVE" "$SRC" <<'PY'
import tarfile,sys,pathlib
with tarfile.open(sys.argv[1]) as t:
 seen=set()
 for m in t:
  p=pathlib.PurePosixPath(m.name)
  assert m.isfile() and not p.is_absolute() and '..' not in p.parts and m.name not in seen
  seen.add(m.name)
 t.extractall(sys.argv[2],filter='data')
 print('archive_files',len(seen))
PY
 cmp "$SRC/package-lock.json" "$OLD/package-lock.json"
 # Hard-link immutable installed dependencies; relative workspace links resolve inside the new source.
 cp -al "$OLD/node_modules" "$SRC/node_modules"
 chown -R wenmi:wenmi "$SRC"
 chmod 755 "$ROOT"
 fi
 [[ $(cat "$SRC/RELEASE_ID") == "$NEW" ]] || fail staged_version_changed
 cmp "$SRC/package-lock.json" "$OLD/package-lock.json"
 cd "$SRC"
 node node_modules/tsx/dist/cli.mjs scripts/quality/verify-v7-runtime-source-closure.ts --output "$SRC/artifacts/deploy/closure-r101.json" >"$ROOT/closure.log"
 node node_modules/tsx/dist/cli.mjs scripts/release/verify-v7-release-module-resolution.ts --release-source "$SRC" --manifest "$SRC/artifacts/deploy/closure-r101.json" >"$ROOT/modules.log"
 python3 - "$DB" "$SRC/apps/api/src/infrastructure/db/migrations" <<'PY'
import sqlite3,sys,pathlib,hashlib
d=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
rows=d.execute('SELECT name,checksum FROM schema_migrations').fetchall(); assert len(rows)==107
for name,digest in rows: assert hashlib.sha256((pathlib.Path(sys.argv[2])/name).read_bytes()).hexdigest()==digest.lower(),name
assert len(list(pathlib.Path(sys.argv[2]).glob('*.sql')))==107
print('existing_107_migrations_unchanged')
PY
 # Retain published hash assets, and use the exact current admin application.
 python3 - "$STATIC_OLD/assets" "$SRC/coauthoring-v7/author-app/dist/assets" <<'PY'
import pathlib,shutil,sys
for p in pathlib.Path(sys.argv[1]).rglob('*'):
 if p.is_file():
  dst=pathlib.Path(sys.argv[2])/p.relative_to(sys.argv[1]); dst.parent.mkdir(parents=True,exist_ok=True)
  if dst.exists(): assert dst.read_bytes()==p.read_bytes()
  else: shutil.copy2(p,dst)
PY
 R101_SOURCE="$SRC" R101_ADMIN="$STATIC_OLD/v7" node --input-type=module <<'JS' >"$ROOT/static.json"
import {assembleV7StaticRelease} from './scripts/release/v7-static-release.mjs';
console.log(JSON.stringify(await assembleV7StaticRelease({projectRoot:process.env.R101_SOURCE,adminDist:process.env.R101_ADMIN})));
JS
 static_id=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["releaseId"])' "$ROOT/static.json")
 [[ $static_id =~ ^[a-f0-9]{20}$ ]] || fail invalid_static
 [[ ! -e /opt/wenmi/releases/versions/$static_id ]] || fail static_exists
 cp -a "$SRC/artifacts/v7-static-releases/$static_id" "/opt/wenmi/releases/versions/$static_id"
 chmod -R a+rX "/opt/wenmi/releases/versions/$static_id"
 node scripts/release/verify-v7-static.mjs "/opt/wenmi/releases/versions/$static_id" >"$ROOT/static-verified.json"
 printf '%s\n' "$static_id" >"$ROOT/static-id"
 # Use the established VACUUM INTO backup; never run a live .backup loop.
 nice -n 15 ionice -c 2 -n 7 sudo -u wenmi timeout 900 bash /opt/wenmi/deploy/backup.sh >"$ROOT/backup.log" 2>&1
 backup=$(find /opt/wenmi/data/backups/daily -mindepth 1 -maxdepth 1 -type d ! -name '.*' -exec test -f '{}/.complete' ';' -printf '%T@ %f\n' | sort -nr | head -1 | awk '{print $2}')
 [[ -n $backup ]] || fail backup_missing
 printf '%s\n' "$backup" >"$ROOT/backup-id"
 mkdir -p "$ROOT/preflight/database"
 cp "/opt/wenmi/data/backups/daily/$backup/wenmi.sqlite" "$ROOT/preflight/database/wenmi.sqlite"
 R101_SOURCE="$SRC" R101_DB="$ROOT/preflight/database/wenmi.sqlite" node --input-type=module <<'JS' >"$ROOT/migration-preflight.json"
import {DatabaseSync} from 'node:sqlite';
import {runMigrations} from './apps/api/dist/infrastructure/db/migrations.js';
const db=new DatabaseSync(process.env.R101_DB);db.exec('PRAGMA foreign_keys=ON');
const before=db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
const first=runMigrations(db,process.env.R101_SOURCE+'/apps/api/src/infrastructure/db/migrations');
const second=runMigrations(db,process.env.R101_SOURCE+'/apps/api/src/infrastructure/db/migrations');
if(first.applied.length||second.applied.length)throw Error('unexpected migrations');
for(const row of before){const after=db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(row.name);if(after?.sql!==row.sql)throw Error('existing schema changed');}
if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('database check failed');
console.log(JSON.stringify({first,second,existingSchemaUnchanged:true}));db.close();
JS
 mkdir -p "$ROOT/isolated-empty"
 chown -R wenmi:wenmi "$ROOT/isolated-empty"
 sudo -u wenmi env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/opt/wenmi USER=wenmi LANG=C.UTF-8 \
  WENMI_PROJECT_ROOT="$SRC" WENMI_DATA_DIR="$ROOT/isolated-empty" WENMI_MODEL_MODE=deterministic \
  WENMI_API_HOST=127.0.0.1 WENMI_API_PORT=43119 WENMI_WEB_ORIGIN=http://127.0.0.1:43119 \
  WENMI_PUBLIC_ORIGIN=http://127.0.0.1:43119 WENMI_ADMIN_ORIGIN=http://127.0.0.1:43119 \
  WENMI_WORKER_TOKEN=r101-isolated-no-model timeout 60 node "$SRC/apps/api/dist/main.js" >"$ROOT/isolated.log" 2>&1 &
 isolated_pid=$!
 isolated_ok=0
 for n in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:43119/health >"$ROOT/isolated-health.json" 2>/dev/null; then isolated_ok=1; break; fi
  sleep 1
 done
 kill "$isolated_pid" 2>/dev/null || true
 wait "$isolated_pid" 2>/dev/null || true
 [[ $isolated_ok == 1 ]] || fail isolated_api_failed
 grep -Fq "\"releaseId\":\"$NEW\"" "$ROOT/isolated-health.json" || fail isolated_version_failed
 touch "$ROOT/stage-passed"
 echo "STAGE_PASSED release=$NEW static=$static_id backup=$backup"
 exit
fi
[[ ${1:-} == cutover && -f $ROOT/stage-passed ]] || fail stage_required
static_id=$(cat "$ROOT/static-id")
[[ $static_id =~ ^[a-f0-9]{20}$ ]] || fail invalid_static
node "$SRC/scripts/release/verify-v7-static.mjs" "/opt/wenmi/releases/versions/$static_id" >"$ROOT/precutover-static.json"
zero=0
for waited in $(seq 1 1800); do
 active=$(active_count)
 if [[ $active == 0 ]]; then zero=$((zero+1)); else zero=0; fi
 echo "zero_window=$zero/30 active=$active"
 sleep 1
 [[ $zero -ge 30 ]] && break
done
[[ $zero -ge 30 && $(active_count) == 0 ]] || fail no_safe_window
started=$(date -u --iso-8601=seconds)
switched=0
rollback() {
 status=$?
 if [[ $status != 0 && $switched == 1 ]]; then
  echo 'Cutover failed; restoring previous application pointers.'
  # Only rollback when no new work has begun; never kill an author task for rollback.
  if [[ $(active_count) == 0 ]]; then
   systemctl stop wenmi-worker wenmi-api
   atomic_link "$OLD/apps" /opt/wenmi/apps
   write_release "$BASE"
   atomic_link "$STATIC_OLD" /opt/wenmi/releases/current
   systemctl start wenmi-api
   systemctl start wenmi-worker
   echo rollback_application_pointers_restored >"$ROOT/rollback.txt"
  else echo 'Rollback deferred: active author work; intervention required.' >"$ROOT/rollback.txt"; fi
 fi
 exit "$status"
}
trap rollback EXIT
[[ $(active_count) == 0 ]] || fail work_started
switched=1
systemctl stop wenmi-worker
[[ $(active_count) == 0 ]] || fail work_started_before_api_stop
systemctl stop wenmi-api
[[ $(active_count) == 0 ]] || fail work_after_stop
cd "$SRC"
sudo -u wenmi env R101_SOURCE="$SRC" R101_DB="$DB" node --input-type=module <<'JS' >"$ROOT/migration-production.json"
import {DatabaseSync} from 'node:sqlite';import {runMigrations} from './apps/api/dist/infrastructure/db/migrations.js';
const db=new DatabaseSync(process.env.R101_DB);db.exec('PRAGMA foreign_keys=ON');
const result=runMigrations(db,process.env.R101_SOURCE+'/apps/api/src/infrastructure/db/migrations');
if(result.applied.length)throw Error('unexpected migration');
console.log(JSON.stringify(result));db.close();
JS
atomic_link "$SRC/apps" /opt/wenmi/apps
write_release "$NEW"
systemctl start wenmi-api
health "$NEW"
systemctl start wenmi-worker
health "$NEW" ready
atomic_link "$STATIC_OLD" /opt/wenmi/releases/previous
atomic_link "/opt/wenmi/releases/versions/$static_id" /opt/wenmi/releases/current
curl -fsS https://wenmixiezuo.com/health >"$ROOT/public-health.json"
grep -Fq "\"releaseId\":\"$NEW\"" "$ROOT/public-health.json"
curl -fsS https://wenmixiezuo.com/ >"$ROOT/public-author.html"
cmp "$ROOT/public-author.html" "/opt/wenmi/releases/versions/$static_id/index.html"
curl -fsS https://admin.wenmixiezuo.com/v7/ >"$ROOT/public-admin.html"
cmp "$ROOT/public-admin.html" "$STATIC_OLD/v7/index.html"
journalctl -u wenmi-api -u wenmi-worker --since "$started" --priority=err --no-pager --quiet >"$ROOT/post-errors.log"
[[ ! -s $ROOT/post-errors.log ]] || fail postdeploy_errors
printf 'release=%s\nstatic=%s\nstarted=%s\ncompleted=%s\n' "$NEW" "$static_id" "$started" "$(date -u --iso-8601=seconds)" >"$ROOT/deployment-passed.txt"
switched=0
echo "DEPLOYMENT_PASSED release=$NEW static=$static_id"
