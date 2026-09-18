import os,pathlib,sys,re,shlex,subprocess
p=pathlib.Path('/opt/wenmi/deploy/.env.production')
lines=p.read_text().splitlines()
def values():
 out={}
 for l in lines:
  if not l.strip() or l.lstrip().startswith('#') or '=' not in l:continue
  k,v=l.split('=',1);parts=shlex.split(v,comments=False)
  out[k.strip()]=' '.join(parts)
 return out
def update(changes):
 present=set();out=[]
 for l in lines:
  k=l.split('=',1)[0].strip() if '=' in l and not l.lstrip().startswith('#') else ''
  if k in changes:
   if k not in present:out.append(k+'='+changes[k]);present.add(k)
  else:out.append(l)
 out += [k+'='+v for k,v in changes.items() if k not in present]
 q=p.with_name('.env.production.s1-next');q.write_text('\n'.join(out)+'\n');os.chmod(q,0o600)
 stat=p.stat();os.chown(q,stat.st_uid,stat.st_gid);os.replace(q,p)
if sys.argv[1]=='agent':
 key=sys.stdin.read().strip()
 if not re.fullmatch(r'[A-Za-z0-9_-]{20,160}',key):raise RuntimeError('invalid credential format')
 update({'WENMI_ARK_AGENT_PLAN_API_KEY':key,'WENMI_ARK_AGENT_PLAN_BASE_URL':'https://ark.cn-beijing.volces.com/api/plan','WENMI_MODEL_MODE':'subscription-plan','WENMI_TIME_MACHINE_CONTEXT_WINDOW':'64000'})
 print('Agent Plan environment configured; credential not logged')
elif sys.argv[1]=='project':
 root=pathlib.Path(sys.argv[2]).resolve();assert pathlib.Path('/opt/wenmi-releases') in root.parents
 assert (root/'RELEASE_ID').is_file()
 update({'WENMI_PROJECT_ROOT':str(root)})
 print('project root configured')
elif sys.argv[1]=='exec':
 env=os.environ.copy();env.update(values())
 sys.exit(subprocess.run(sys.argv[2:],env=env).returncode)
else:raise RuntimeError('unknown action')
