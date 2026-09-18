#!/bin/bash
# OPENING-NOVEL-CLOSE-01 仅长篇开书开放 · 切换：零在途窗口→停API→迁移→逐服务切换→静态原子切换→线上验证
set -Eeuo pipefail
ROOT=/opt/wenmi-releases/wm-v7-20260919-050500-121540bc
SRC=$ROOT/source
RB=$ROOT/rollback/source
OLD=wm-v7-20260919-033900-2861da92
NEW=wm-v7-20260919-050500-121540bc
DB=/opt/wenmi/data/database/wenmi.sqlite
STATIC_OLD=/opt/wenmi/releases/versions/7438953c19970c436f33
STATIC_NEW=/opt/wenmi/releases/versions/$(cat "$ROOT/static-id")
exec 9>/opt/wenmi-releases/.deploy.lock
flock -n 9
test "$(cat /opt/wenmi/RELEASE_ID)" = "$OLD"
test "$(readlink -f /opt/wenmi/apps)" = "/opt/wenmi-releases/wm-v7-20260919-033900-2861da92/source/apps"
test "$(readlink -f /opt/wenmi/releases/current)" = "$STATIC_OLD"
test -f "$ROOT/rollback-migrate.json"
active() { python3 "$SRC/scripts/release/r119-active-count.py" "$DB"; }
window() {
 local zero=0 elapsed=0 n
 while [ "$zero" -lt 30 ] && [ "$elapsed" -lt 300 ]; do
  n=$(active)
  if [ "$n" = 0 ]; then zero=$((zero+1)); else zero=0; fi
  elapsed=$((elapsed+1))
  if [ "$zero" = 1 ] || [ "$zero" = 30 ] || [ $((elapsed % 30)) = 0 ]; then echo "active=$n zero=$zero/30"; fi
  sleep 1
 done
 test "$zero" -ge 30 && test "$(active)" = 0
}
atomic_link() { test ! -e "$2.s1-next" && test ! -L "$2.s1-next"; ln -s "$1" "$2.s1-next"; mv -Tf "$2.s1-next" "$2"; }
write_release() { printf '%s\n' "$1" > /opt/wenmi/RELEASE_ID.s1-next; chown wenmi:wenmi /opt/wenmi/RELEASE_ID.s1-next; chmod 644 /opt/wenmi/RELEASE_ID.s1-next; mv -Tf /opt/wenmi/RELEASE_ID.s1-next /opt/wenmi/RELEASE_ID; }
health() {
 local expected=$1 require_worker=$2
 for i in $(seq 1 40); do
  if curl -fsS --max-time 3 http://127.0.0.1:43111/health > "$ROOT/last-health.json" 2>/dev/null && python3 - "$ROOT/last-health.json" "$expected" "$require_worker" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))['data']
assert d['status']=='ok' and d['releaseId']==sys.argv[2]
if sys.argv[3]=='yes': assert d['worker']=='ready' and d['canStartModelTasks'] is True
PY
  then return 0; fi
  sleep 1
 done
 return 1
}
switched=0
rollback() {
 local rc=${1:-$?}
 trap - ERR INT TERM
 echo "CUTOVER-FAILED rc=$rc; restoring code only"
 if [ "$switched" = 1 ]; then
  if ! window; then echo 'ROLLBACK-BLOCKED: active tasks; no author task modified'; exit 75; fi
 fi
 systemctl stop wenmi-api
 ! systemctl is-active --quiet wenmi-api
 ! systemctl is-active --quiet wenmi-worker
 test "$(sudo -u wenmi sqlite3 -readonly "$DB" 'PRAGMA quick_check;')" = ok
 test -z "$(sudo -u wenmi sqlite3 -readonly "$DB" 'PRAGMA foreign_key_check;')"
 python3 /tmp/production-env.py project "$RB"
 atomic_link "$RB/apps" /opt/wenmi/apps
 write_release "$OLD"
 atomic_link "$STATIC_OLD" /opt/wenmi/releases/current
 install -m 644 "$ROOT/Caddyfile.before" /etc/caddy/Caddyfile
 systemctl reload caddy
 systemctl reset-failed wenmi-api wenmi-worker
 systemctl start wenmi-api
 health "$OLD" no
 test "$(active)" = 0
 systemctl start wenmi-worker
 health "$OLD" yes
 echo CODE-ROLLBACK-OK
 exit "$rc"
}
BACKUP=$(cat "$ROOT/backup-id")
(cd "$BACKUP" && sha256sum --strict -c checksums.sha256)
window
test "$(active)" = 0
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
systemctl stop wenmi-api
! systemctl is-active --quiet wenmi-api
! systemctl is-active --quiet wenmi-worker
test "$(active)" = 0
sudo -u wenmi node "$SRC/scripts/release/r192-migrate-driver.mjs" "$DB" "$SRC" > "$ROOT/production-migrate.json"
python3 /tmp/production-env.py project "$SRC"
atomic_link "$SRC/apps" /opt/wenmi/apps
write_release "$NEW"
switched=1
test "$(active)" = 0
systemctl start wenmi-api
health "$NEW" no
test "$(active)" = 0
systemctl start wenmi-worker
health "$NEW" yes
install -m 644 "$ROOT/Caddyfile.next" /etc/caddy/Caddyfile
systemctl reload caddy
atomic_link "$STATIC_OLD" /opt/wenmi/releases/previous
atomic_link "$STATIC_NEW" /opt/wenmi/releases/current
python3 - "$STATIC_NEW" "$NEW" <<'PY'
import pathlib,json,sys,urllib.request,urllib.error,hashlib
root=pathlib.Path(sys.argv[1]);m=json.loads((root/'release-manifest.json').read_text())
for f in m['files']:
 with urllib.request.urlopen('https://wenmixiezuo.com/'+f['path'],timeout=20) as r: data=r.read()
 assert hashlib.sha256(data).hexdigest()==f['sha256'],f['path']
for url,path in [('https://wenmixiezuo.com/','index.html'),('https://admin.wenmixiezuo.com/v7/','v7/index.html')]:
 with urllib.request.urlopen(url,timeout=20) as r:assert r.read()==(root/path).read_bytes()
with urllib.request.urlopen('https://wenmixiezuo.com/health',timeout=20) as r:d=json.load(r)['data']
assert d['releaseId']==sys.argv[2] and d['status']=='ok' and d['worker']=='ready'
for path in ['/api/v1/auth/me','/api/v1/v7/books','/api/v1/v7/books/probe/delete-preview','/api/v1/admin/rebuild-control']:
 try:urllib.request.urlopen('https://wenmixiezuo.com'+path,timeout=20);raise AssertionError(path)
 except urllib.error.HTTPError as e:assert e.code==401,(path,e.code)
print(json.dumps({'release':sys.argv[2],'static':m['releaseId'],'assets':len(m['files']),'protectedRoutes':4}))
PY
trap - ERR INT TERM
date -Iseconds > "$ROOT/deployment-passed"
echo "DEPLOYED $NEW"
