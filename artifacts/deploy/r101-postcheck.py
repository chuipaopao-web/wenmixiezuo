import json,hashlib,pathlib,sqlite3,urllib.request,urllib.error,time
root=pathlib.Path('/opt/wenmi-releases/wm-v7-20260905-223221-1f9e475')
expected=root.name
static=pathlib.Path('/opt/wenmi/releases/current').resolve()
manifest=json.loads((static/'release-manifest.json').read_text())
checks=[]
for f in manifest['files']:
    path=f['path']; domain='https://admin.wenmixiezuo.com/' if path.startswith('v7/') else 'https://wenmixiezuo.com/'
    start=time.monotonic()
    with urllib.request.urlopen(domain+path,timeout=20) as r:
        data=r.read(); assert r.status==200
    assert hashlib.sha256(data).hexdigest()==f['sha256'],path
    checks.append({'path':path,'status':200,'seconds':round(time.monotonic()-start,3)})
with urllib.request.urlopen('https://wenmixiezuo.com/health',timeout=20) as r: health=json.load(r)['data']
assert health['releaseId']==expected and health['status']=='ok' and health['worker']=='ready' and health['canStartModelTasks']
for path in ['/api/v1/auth/me','/api/v1/admin/overview']:
    try:
        urllib.request.urlopen('https://wenmixiezuo.com'+path,timeout=20)
        raise AssertionError('unprotected route')
    except urllib.error.HTTPError as e:
        assert e.code==401
        checks.append({'path':path,'status':401})
db=sqlite3.connect('file:/opt/wenmi/data/database/wenmi.sqlite?mode=ro',uri=True)
rows=db.execute('SELECT name,checksum FROM schema_migrations').fetchall(); assert len(rows)==107
for name,digest in rows: assert hashlib.sha256((root/'source/apps/api/src/infrastructure/db/migrations'/name).read_bytes()).hexdigest()==digest.lower()
assert db.execute('PRAGMA quick_check').fetchone()[0]=='ok'
assert not db.execute('PRAGMA foreign_key_check').fetchall()
result={'passed':True,'release':expected,'static':manifest['releaseId'],'checks':checks,'migrationCount':len(rows),'database':'ok'}
(root/'postcheck.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
