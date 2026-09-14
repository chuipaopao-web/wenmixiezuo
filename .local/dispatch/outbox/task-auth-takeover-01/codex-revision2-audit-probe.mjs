import {DatabaseSync} from 'node:sqlite';
import {scryptSync} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const wt='D:/wenmixiezuo/.local/dispatch/worktrees/auth-takeover-01';
const {IdentityService}=await import(pathToFileURL(wt+'/apps/api/dist/identity/identity-service.js'));
const d=new DatabaseSync(':memory:');d.exec(`
CREATE TABLE user_accounts(user_id TEXT PRIMARY KEY,owner_id TEXT,email_normalized TEXT,display_name TEXT,password_salt TEXT,password_hash TEXT,password_format TEXT,password_n INTEGER,password_r INTEGER,password_p INTEGER,credential_version INTEGER NOT NULL DEFAULT 0,role TEXT,status TEXT,created_at TEXT,updated_at TEXT,last_login_at TEXT);
CREATE TABLE auth_sessions(session_id TEXT,user_id TEXT,token_hash TEXT,created_at TEXT,expires_at TEXT,last_seen_at TEXT,revoked_at TEXT);
CREATE TABLE auth_audit_events(audit_id TEXT,user_id TEXT,event_type TEXT,email_normalized TEXT,actor_user_id TEXT,recorded_at TEXT,details_json TEXT);
`);
const salt='0123456789abcdef0123456789abcdef';
const hash=scryptSync('Old-pass-123!',salt,64,{N:16384,r:8,p:1,maxmem:67108864}).toString('hex');
d.prepare('INSERT INTO user_accounts VALUES (?,?,?,?,?,?,NULL,NULL,NULL,NULL,0,?,?,?,?,?)').run('u','o','probe@example.com','test',salt,hash,'user','active','2026-01-01','2026-01-01',null);
const s=new IdentityService(d,false,'o'),out={};
try{await s.login({email:'probe@example.com',password:'Wrong-pass-123!'});}catch(e){out.wrongLogin=e.code;}
out.persistedLoginFailures=d.prepare("SELECT count(*) n FROM auth_audit_events WHERE event_type='login_failed'").get().n;
const session=await s.login({email:'probe@example.com',password:'Old-pass-123!'});const context=s.authenticate(session.cookie.split(';')[0]);
try{await s.changePassword({context,currentPassword:'Wrong-pass-123!',nextPassword:'New-pass-456!'});}catch(e){out.wrongChange=e.code;}
out.persistedPasswordChangeFailures=d.prepare("SELECT count(*) n FROM auth_audit_events WHERE event_type='password_change_failed'").get().n;
console.log(JSON.stringify(out,null,2));d.close();
