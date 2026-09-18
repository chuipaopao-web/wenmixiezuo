import pathlib,json,hashlib,shutil
r=pathlib.Path('/opt/wenmi/releases'); new=r/'versions/8612537aae8d01aab4d6'
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
root=pathlib.Path('/opt/wenmi-releases/wm-v7-20260918-161500-e1310473')
(root/'Caddyfile.before').write_text(content)
block='  handle /assets/* {\n    root * /opt/wenmi/releases/asset-store\n    file_server\n  }\n\n'
assert 'root * /opt/wenmi/releases/asset-store' not in content
content=content.replace('  handle {',block+'  handle {',1)
assert '  handle /v7/* {' in content
content=content.replace('  handle /v7/* {','  handle /v7/assets/* {\n    root * /opt/wenmi/releases/asset-store\n    file_server\n  }\n\n'+block+'  handle /v7/* {',1)
(root/'Caddyfile.next').write_text(content)
print(json.dumps({'immutableAssetFiles':count,'configPrepared':True}))
