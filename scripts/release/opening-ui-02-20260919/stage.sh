#!/bin/bash
# OPENING-UI-02 · 备份+预演迁移+回滚包+静态就位（服务器上执行）
set -Eeuo pipefail
ROOT=/opt/wenmi-releases/wm-v7-20260919-003800-05c82c9d
SRC=$ROOT/source
RB=$ROOT/rollback/source
OLD=/opt/wenmi-releases/wm-v7-20260918-195500-758265c5/source
DB=/opt/wenmi/data/database/wenmi.sqlite
exec 9>/opt/wenmi-releases/.deploy.lock
flock -n 9
test "$(cat /opt/wenmi/RELEASE_ID)" = wm-v7-20260918-195500-758265c5
test "$(readlink -f /opt/wenmi/apps)" = "$OLD/apps"
chown -R wenmi:wenmi "$SRC"
python3 - "$SRC" <<'PY'
import pathlib,sys
r=pathlib.Path(sys.argv[1]).resolve()
for p in (r/'node_modules/@wenmi').iterdir():
 assert r in p.resolve().parents,(p,p.resolve())
print('workspace-resolution: all local')
PY
sudo -u wenmi timeout 900 bash /opt/wenmi/deploy/backup.sh > "$ROOT/pre-release-backup.log" 2>&1
tail -4 "$ROOT/pre-release-backup.log"
python3 - "$ROOT" <<'PY'
import pathlib,sqlite3,sys,json,hashlib
r=pathlib.Path(sys.argv[1]);root=pathlib.Path('/opt/wenmi/data/backups/daily')
b=max((p for p in root.iterdir() if p.is_dir() and not p.name.startswith('.') and (p/'.complete').is_file()),key=lambda p:p.stat().st_mtime)
(r/'backup-id').write_text(str(b))
print('backup:',b.name)
print('backup-files:',','.join(p.name for p in b.iterdir()))
target=r/'preflight/database';target.mkdir(parents=True,exist_ok=False)
src=sqlite3.connect('file:/opt/wenmi/data/database/wenmi.sqlite?mode=ro',uri=True)
dst=sqlite3.connect(str(target/'wenmi.sqlite'));src.backup(dst);dst.close();src.close()
d=sqlite3.connect(str(target/'wenmi.sqlite'))
tables=['user_accounts','memberships','transactions','books','tm2_books']
present={x[0] for x in d.execute("SELECT name FROM sqlite_master WHERE type='table'")}
values={t:sorted(map(repr,d.execute('SELECT * FROM "'+t+'"').fetchall())) for t in tables if t in present}
(r/'protected-before.json').write_text(json.dumps({t:hashlib.sha256('\n'.join(v).encode()).hexdigest() for t,v in values.items()}))
PY
chown -R wenmi:wenmi "$ROOT/preflight"
sudo -u wenmi node "$SRC/scripts/release/r192-migrate-driver.mjs" "$ROOT/preflight/database/wenmi.sqlite" "$SRC" | tee "$ROOT/migrate-first.json"
sudo -u wenmi node "$SRC/scripts/release/r192-migrate-driver.mjs" "$ROOT/preflight/database/wenmi.sqlite" "$SRC" | tee "$ROOT/migrate-repeat.json"
grep -Fq '"applied":[]' "$ROOT/migrate-repeat.json"
python3 - "$ROOT" <<'PY'
import pathlib,sqlite3,sys,json,hashlib
r=pathlib.Path(sys.argv[1]);d=sqlite3.connect(str(r/'preflight/database/wenmi.sqlite'))
before=json.loads((r/'protected-before.json').read_text())
for t,h in before.items():
 rows=sorted(map(repr,d.execute('SELECT * FROM "'+t+'"').fetchall()))
 assert hashlib.sha256('\n'.join(rows).encode()).hexdigest()==h,t
print('protected-rows unchanged:',','.join(before))
PY
mkdir -p "$ROOT/rollback"
test ! -e "$RB"
cp -a "$OLD" "$RB"
cp -a "$SRC/apps/api/src/infrastructure/db/migrations/." "$RB/apps/api/src/infrastructure/db/migrations/"
chown -R wenmi:wenmi "$ROOT/rollback"
sudo -u wenmi node "$RB/scripts/release/r192-migrate-driver.mjs" "$ROOT/preflight/database/wenmi.sqlite" "$RB" | tee "$ROOT/rollback-migrate.json"
grep -Fq '"applied":[]' "$ROOT/rollback-migrate.json"
STATIC_ID=$(node -p "JSON.parse(require('fs').readFileSync('$SRC/artifacts/v7-static-releases/current.json')).releaseId")
TARGET=/opt/wenmi/releases/versions/$STATIC_ID
test ! -e "$TARGET"
cp -a "$SRC/artifacts/v7-static-releases/$STATIC_ID" "$TARGET"
chown -R wenmi:wenmi "$TARGET"
find "$TARGET" -type d -exec chmod 755 {} +
find "$TARGET" -type f -exec chmod 644 {} +
sudo -u wenmi node "$SRC/scripts/release/verify-v7-static.mjs" "$TARGET" | tee "$ROOT/static-verified.json"
printf '%s\n' "$STATIC_ID" > "$ROOT/static-id"
df -h /opt
echo STAGE-MIGRATION-ROLLBACK-OK
