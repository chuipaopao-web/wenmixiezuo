#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $# == 3 ]] || { echo 'usage: deploy-r117-static.sh commit archive-sha stage|activate'; exit 64; }
FIX=$1
SHA=$2
MODE=$3
[[ $FIX =~ ^[a-f0-9]{7,40}$ && $SHA =~ ^[a-f0-9]{64}$ ]] || exit 64
[[ $MODE == stage || $MODE == activate ]] || exit 64
BASE=wm-v7-20260906-003247-ce17325
OLD=/opt/wenmi/releases/versions/35fb4d1039e27657c595
SOURCE=/opt/wenmi-releases/$BASE/source
ROOT=/opt/wenmi-releases/r117-navigation-$FIX
ARCHIVE=/tmp/r117-navigation-$FIX.tar.gz
[[ $EUID == 0 ]] || exit 64
exec 9>/opt/wenmi-releases/.deploy.lock
flock -n 9
[[ $(cat /opt/wenmi/RELEASE_ID) == "$BASE" ]]
[[ $(readlink -f /opt/wenmi/releases/current) == "$OLD" ]]
printf '%s  %s\n' "$SHA" "$ARCHIVE" | sha256sum -c -
if [[ $MODE == stage ]]; then
 [[ ! -e $ROOT ]]
 mkdir -p "$ROOT/input"
 python3 - "$ARCHIVE" "$ROOT/input" <<'PY'
import pathlib,sys,tarfile
with tarfile.open(sys.argv[1]) as t:
 for m in t.getmembers():
  p=pathlib.PurePosixPath(m.name)
  if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0] not in ('author-dist','source') or not (m.isfile() or m.isdir()):
   raise RuntimeError('unsafe package member')
 t.extractall(sys.argv[2],filter='data')
PY
 python3 - "$OLD" "$ROOT" <<'PY'
import pathlib,shutil,sys
old,root=map(pathlib.Path,sys.argv[1:])
author=root/'author'; author.mkdir()
for p in old.iterdir():
 if p.name in ('v7','release-manifest.json'): continue
 if p.is_dir(): shutil.copytree(p,author/p.name)
 else: shutil.copy2(p,author/p.name)
shutil.copytree(root/'input/author-dist',author,dirs_exist_ok=True)
PY
 R117_ROOT="$ROOT" R117_SOURCE="$SOURCE" R117_OLD="$OLD" node --input-type=module <<'JS' >"$ROOT/static.json"
const {assembleV7StaticRelease}=await import(process.env.R117_SOURCE+'/scripts/release/v7-static-release.mjs');
console.log(JSON.stringify(await assembleV7StaticRelease({projectRoot:process.env.R117_ROOT,authorDist:'author',adminDist:process.env.R117_OLD+'/v7'})));
JS
 ID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["releaseId"])' "$ROOT/static.json")
 [[ $ID =~ ^[a-f0-9]{20}$ ]]
 TARGET=/opt/wenmi/releases/versions/$ID
 [[ ! -e $TARGET ]]
 cp -a "$ROOT/artifacts/v7-static-releases/$ID" "$TARGET"
 chown -R wenmi:wenmi "$TARGET"
 find "$TARGET" -type d -exec chmod 755 {} +
 find "$TARGET" -type f -exec chmod 644 {} +
 node "$SOURCE/scripts/release/verify-v7-static.mjs" "$TARGET" >"$ROOT/verified.json"
 diff -qr "$OLD/v7" "$TARGET/v7"
 printf '%s\n' "$ID" >"$ROOT/static-id"
 echo "R117_STAGED static=$ID"
 exit 0
fi
[[ -f $ROOT/approved-local-checks ]]
ID=$(cat "$ROOT/static-id")
[[ $ID =~ ^[a-f0-9]{20}$ ]]
TARGET=/opt/wenmi/releases/versions/$ID
node "$SOURCE/scripts/release/verify-v7-static.mjs" "$TARGET" >"$ROOT/preactivate-verified.json"
diff -qr "$OLD/v7" "$TARGET/v7"
API_PID=$(systemctl show -p MainPID --value wenmi-api)
WORKER_PID=$(systemctl show -p MainPID --value wenmi-worker)
[[ $API_PID -gt 0 && $WORKER_PID -gt 0 ]]
# The production release directory is root-owned and /opt/wenmi/current has no
# activation helper. Reuse the verified R116 atomic switch under this deploy lock.
switch_static() { ln -s "$1" /opt/wenmi/releases/.r117-next; mv -Tf /opt/wenmi/releases/.r117-next /opt/wenmi/releases/current; }
rollback() { code=$?; trap - ERR; switch_static "$OLD"; echo "R117_ROLLED_BACK exit=$code" >&2; exit "$code"; }
trap rollback ERR
switch_static "$TARGET"
python3 - "$TARGET" <<'PY' >"$ROOT/public-checks.json"
import hashlib,json,pathlib,sys,urllib.request,urllib.error
root=pathlib.Path(sys.argv[1]); manifest=json.loads((root/'release-manifest.json').read_text())
checks=[]
for f in manifest['files']:
 with urllib.request.urlopen('https://wenmixiezuo.com/'+f['path'],timeout=30) as r:
  body=r.read(); assert hashlib.sha256(body).hexdigest()==f['sha256'],f['path']
 checks.append(f['path'])
with urllib.request.urlopen('https://wenmixiezuo.com/health',timeout=30) as r:
 health=json.load(r)['data']; assert health['releaseId']=='wm-v7-20260906-003247-ce17325'; assert health['status']=='ok'; assert health['worker']=='ready'; assert health['canStartModelTasks'] is True
with urllib.request.urlopen('https://admin.wenmixiezuo.com/v7/',timeout=30) as r:
 assert r.read()==(root/'v7/index.html').read_bytes(),'admin host entry changed'
protected=[]
for path in ('/api/v1/auth/me','/api/v1/v7/books'):
 try:
  with urllib.request.urlopen('https://wenmixiezuo.com'+path,timeout=30) as r: status=r.status
 except urllib.error.HTTPError as e: status=e.code
 assert status==401,(path,status)
 protected.append({'path':path,'status':status})
print(json.dumps({'passed':True,'static':manifest['releaseId'],'checkedFiles':checks,'apiRelease':health['releaseId'],'protected':protected,'adminHostUnchanged':True}))
PY
[[ $(systemctl show -p MainPID --value wenmi-api) == "$API_PID" ]]
[[ $(systemctl show -p MainPID --value wenmi-worker) == "$WORKER_PID" ]]
ln -s "$OLD" /opt/wenmi/releases/.r117-previous
mv -Tf /opt/wenmi/releases/.r117-previous /opt/wenmi/releases/previous
trap - ERR
printf 'static=%s\ncommit=%s\ncompleted=%s\napiPid=%s\nworkerPid=%s\n' "$ID" "$FIX" "$(date -u --iso-8601=seconds)" "$API_PID" "$WORKER_PID" >"$ROOT/deployment-passed.txt"
echo "R117_DEPLOYED static=$ID api_unchanged=$API_PID worker_unchanged=$WORKER_PID"
