"""Remove only rebuildable dependencies from superseded releases; default dry run."""
import os, pathlib, shutil, sys, json
root=pathlib.Path('/opt/wenmi-releases')
targets=[root/p for p in [
 'wm-v7-20260914-020000-c4de0001/source/node_modules',
 'wm-v7-20260914-020000-c4de0001/rollback-source/node_modules',
 'wm-v7-20260913-190000-a2090001/source/node_modules',
 'wm-v7-20260913-190000-a2090001/rollback-compatible/source/node_modules',
 'wm-v7-20260914-024500-2922953d/source/node_modules',
 'wm-v7-20260912-205500-6de600d5/source/node_modules']]
def beneath(p,t): return p==str(t) or p.startswith(str(t)+'/')
for t in targets:
 assert str(t.resolve())==str(t) and t.name=='node_modules' and root in t.parents
 if t.exists():
  assert (t.parent/'package-lock.json').is_file() and (t.parent/'package.json').is_file()
protected=['/opt/wenmi','/opt/wenmi-releases/wm-auth-takeover-r1-rollback-20260914-153000']
refs=[]
for base in protected:
 for parent,dirs,files in os.walk(base,followlinks=False):
  # Backups and author data cannot contain executable dependency links.
  if parent=='/opt/wenmi': dirs[:]=[d for d in dirs if d not in ['data']]
  for name in dirs+files:
   p=pathlib.Path(parent)/name
   if p.is_symlink(): refs.append((str(p),str(p.resolve())))
for proc in pathlib.Path('/proc').iterdir():
 if not proc.name.isdigit(): continue
 for p in [proc/'cwd',proc/'exe',*list((proc/'fd').glob('*'))]:
  try: refs.append((str(p),str(p.resolve())))
  except OSError: pass
 for fn in ['cmdline','maps']:
  try:
   value=(proc/fn).read_bytes().decode(errors='replace')
   for t in targets:
    if str(t) in value: raise RuntimeError('active process references '+str(t))
  except (FileNotFoundError,PermissionError,ProcessLookupError): pass
for link,value in refs:
 for t in targets:
  if beneath(value,t): raise RuntimeError('protected reference '+link+' -> '+value)
for base in ['/etc/systemd/system','/etc/caddy']:
 for p in pathlib.Path(base).rglob('*'):
  if not p.is_file(): continue
  try: content=p.read_text(errors='replace')
  except OSError: continue
  for t in targets:
   if str(t) in content: raise RuntimeError('service reference '+str(p))
for t in targets:
 if not t.exists(): continue
 size=sum(p.stat().st_size for p in t.rglob('*') if p.is_file() and not p.is_symlink())
 print(json.dumps({'path':str(t),'bytes':size,'action':'remove' if '--execute' in sys.argv else 'preview'}),flush=True)
 if '--execute' in sys.argv: shutil.rmtree(t)
print('availableBytes='+str(shutil.disk_usage('/opt').free))
