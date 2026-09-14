import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root='D:/wenmixiezuo',wt=root+'/.local/dispatch/worktrees/auth-takeover-01';
const {AccountAuthService:New}=await import(pathToFileURL(wt+'/apps/api/dist/infrastructure/security/account-auth-service.js'));
const {AccountAuthService:Old}=await import(pathToFileURL(root+'/apps/api/dist/infrastructure/security/account-auth-service.js'));
const hash=(p,s,n=16384,q=1)=>scryptSync(p,s,64,{N:n,r:8,p:q,maxmem:67108864}).toString('hex');
function setup(){const d=new DatabaseSync(':memory:');d.exec(`
CREATE TABLE user_accounts(user_id TEXT PRIMARY KEY,owner_id TEXT,email_normalized TEXT,display_name TEXT,password_salt TEXT,password_hash TEXT,password_format TEXT,password_n INTEGER,password_r INTEGER,password_p INTEGER,role TEXT,status TEXT,created_at TEXT,updated_at TEXT,last_login_at TEXT);
CREATE TABLE auth_sessions(session_id TEXT,user_id TEXT,token_hash TEXT,created_at TEXT,expires_at TEXT,last_seen_at TEXT,revoked_at TEXT);
CREATE TABLE auth_audit_events(audit_id TEXT,user_id TEXT,event_type TEXT,email_normalized TEXT,actor_user_id TEXT,recorded_at TEXT,details_json TEXT);
`);d.prepare('INSERT INTO user_accounts VALUES (?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?,?,?,?)').run('u','o','probe@example.com','test','legacy-salt',hash('Old-pass-123!','legacy-salt'),'user','active','2026-01-01','2026-01-01',null);return d;}
const evidence={};
{const d=setup();await new New(d,false,'o').login({email:'probe@example.com',password:'Old-pass-123!'});try{await new Old(d,false,'o').login({email:'probe@example.com',password:'Old-pass-123!'});evidence.rollback='unexpected-success';}catch(e){evidence.rollback=e.code??e.message;}evidence.upgradeLastLoginAt=d.prepare('SELECT last_login_at FROM user_accounts').get().last_login_at;d.close();}
{const d=setup(),s=new New(d,false,'o');const running=s.login({email:'probe@example.com',password:'Old-pass-123!'});
// Simulate a concurrent credential change while asynchronous login hashing is outstanding.
d.prepare("UPDATE user_accounts SET password_salt=?,password_hash=?,password_format='scrypt-v2',password_n=32768,password_r=8,password_p=3").run('new-salt',hash('New-pass-456!','new-salt',32768,3));
await running;try{await s.login({email:'probe@example.com',password:'New-pass-456!'});evidence.concurrentPasswordChange='preserved';}catch(e){evidence.concurrentPasswordChange=e.code??e.message;}try{await s.login({email:'probe@example.com',password:'Old-pass-123!'});evidence.oldPasswordRestored=true;}catch{evidence.oldPasswordRestored=false;}d.close();}
console.log(JSON.stringify(evidence,null,2));
