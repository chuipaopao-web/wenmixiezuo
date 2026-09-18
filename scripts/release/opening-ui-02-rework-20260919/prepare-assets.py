import pathlib,json,hashlib,shutil,sys
# OPENING-UI-02返修 · 静态资源并入asset-store；Caddy asset-store块已存在则只备份不重插
static_id = pathlib.Path('/opt/wenmi-releases/wm-v7-20260919-033900-2861da92/static-id').read_text().strip()
r=pathlib.Path('/opt/wenmi/releases'); new=r/'versions'/static_id
store=r/'asset-store';store.mkdir(exist_ok=True)
count=0
for release in [r/'current',new]:
 for rel in ['assets','v7/assets']:
  source=release/rel
  if not source.is_dir():continue
  for file in source.rglob('*'):
   if not file.is_file():continue
   assert not file.is_symlink()
   target=store/rel/file.relative_to(source);target.parent.mkdir(parents=True,exist_ok=True)
   if target.exists():assert hashlib.sha256(target.read_bytes()).digest()==hashlib.sha256(file.read_bytes()).digest()
   else:shutil.copyfile(file,target)
   target.chmod(0o644);count+=1
for d in store.rglob('*'):
 if d.is_dir():d.chmod(0o755)
store.chmod(0o755)
p=pathlib.Path('/etc/caddy/Caddyfile');content=p.read_text()
root=pathlib.Path('/opt/wenmi-releases/wm-v7-20260919-033900-2861da92')
(root/'Caddyfile.before').write_text(content)
if 'root * /opt/wenmi/releases/asset-store' in content:
 (root/'Caddyfile.next').write_text(content)
 print(json.dumps({'immutableAssetFiles':count,'caddyAlreadyHasAssetStore':True}))
 sys.exit(0)
block='  handle /assets/* {\n    root * /opt/wenmi/releases/asset-store\n    file_server\n  }\n\n'
content=content.replace('  handle {',block+'  handle {',1)
assert '  handle /v7/* {' in content
content=content.replace('  handle /v7/* {','  handle /v7/assets/* {\n    root * /opt/wenmi/releases/asset-store\n    file_server\n  }\n\n'+block+'  handle /v7/* {',1)
(root/'Caddyfile.next').write_text(content)
print(json.dumps({'immutableAssetFiles':count,'caddyAlreadyHasAssetStore':False}))
