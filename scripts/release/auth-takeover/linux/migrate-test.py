#!/usr/bin/env python3
"""
AUTH-TAKEOVER-01 Phase 0: 0125独立迁移验证（返工4版）
在0124 schema合成库上验证：数据保留（逐字段）、重入幂等、失败原子性。
用法: python3 migrate-test.py <src_root> <candidate_migrations_dir>
"""
import hashlib, json, os, shutil, sqlite3, subprocess, sys, tempfile

SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('SRC', '.')
MIG_DIR = os.path.join(SRC, 'apps/api/src/infrastructure/db/migrations')
DIST_MIG = os.path.join(SRC, 'apps/api/dist/infrastructure/db/migrations.js')

PASS = 0; FAIL = 0; RESULTS = []

def check(label, condition, detail=''):
    global PASS, FAIL
    if condition:
        PASS += 1; RESULTS.append(('PASS', label, detail))
        print(f'  ✓ {label} {detail}')
    else:
        FAIL += 1; RESULTS.append(('FAIL', label, detail))
        print(f'  ✗ {label} {detail}')

def run_migrations(db_path, migrations_dir):
    """Call Node.js runMigrations against a SQLite database."""
    code = f'''
import {{ DatabaseSync }} from 'node:sqlite';
import {{ runMigrations }} from '{DIST_MIG}';
import {{ resolve }} from 'node:path';
const db = new DatabaseSync('{db_path}');
const result = runMigrations(db, resolve('{migrations_dir}'));
console.log(JSON.stringify(result));
db.close();
'''
    r = subprocess.run(['node', '--input-type=module', '-e', code], capture_output=True, text=True, cwd=SRC)
    if r.returncode != 0:
        return False, r.stderr[-500:]
    return True, r.stdout.strip()

def get_schema(db, table):
    return {row[1]: row[2] for row in db.execute(f'PRAGMA table_info({table})').fetchall()}

def main():
    tmp = tempfile.mkdtemp(prefix='auth-mig4-')
    db_path = os.path.join(tmp, 'test.sqlite')
    mig_0124 = os.path.join(tmp, 'mig-0124')

    # 只复制0001-0124（排除0125）
    os.makedirs(mig_0124)
    for f in sorted(os.listdir(MIG_DIR)):
        if f.endswith('.sql') and f < '0125':
            shutil.copy(os.path.join(MIG_DIR, f), os.path.join(mig_0124, f))
    print(f'0124 migrations: {len(os.listdir(mig_0124))} files')

    # ── Step 1: 创建0124库 ──
    ok, out = run_migrations(db_path, mig_0124)
    check('P0-0a 创建0124库', ok, out[:100] if ok else out)
    if not ok: return finish(tmp)

    db = sqlite3.connect(db_path)
    cols = get_schema(db, 'user_accounts')
    check('P0-0b 无password_format列', 'password_format' not in cols, str(list(cols.keys())[:8]))
    check('P0-0c 无credential_version列', 'credential_version' not in cols)

    # ── Step 2: 种历史数据（按0045/0057实际schema） ──
    import hashlib as hl
    salt = '0123456789abcdef0123456789abcdef'
    # 用标准scrypt v1参数计算哈希
    import subprocess as sp
    hash_result = sp.run(['node', '-e', f'''
const {{scryptSync}}=require('node:crypto');
console.log(scryptSync('Old-Pass-123-456!','{salt}',64,{{N:16384,r:8,p:1,maxmem:134217728}}).toString('hex'));
'''], capture_output=True, text=True)
    pw_hash = hash_result.stdout.strip()

    db.execute("INSERT INTO owners(owner_id,display_name,version,created_at,updated_at) VALUES(?,?,?,?,?)",
               ('mig-owner','迁移Owner',1,'2026-01-01','2026-01-01'))
    db.execute("""INSERT INTO user_accounts(user_id,owner_id,email_normalized,display_name,
        password_salt,password_hash,role,status,created_at,updated_at,last_login_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        ('mig-user','mig-owner','mig@example.com','迁移用户',salt,pw_hash,'user','active','2026-01-01','2026-01-01',None))
    db.execute("INSERT INTO auth_sessions(session_id,user_id,token_hash,created_at,expires_at,last_seen_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)",
        ('mig-session','mig-user','a'*64,'2026-01-01','2027-01-01','2026-01-01'))
    # 按实际schema（0057）：granted_by_user_id必填FK
    db.execute("""INSERT INTO user_memberships(user_id,owner_id,plan,token_quota,
        period_start,period_end,status,granted_by_user_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)""",
        ('mig-user','mig-owner','bronze',200000,'2026-01-01','2027-01-01','active','mig-user','2026-01-01','2026-01-01'))
    db.execute("INSERT INTO auth_audit_events(audit_id,user_id,event_type,email_normalized,actor_user_id,recorded_at,details_json) VALUES(?,?,?,?,?,?,?)",
        ('mig-audit-1','mig-user','login_success','mig@example.com','mig-user','2026-01-01','{"seed":true}'))
    db.commit()

    # 记录迁移前完整数据
    pre_data = {
        'accounts': db.execute("SELECT user_id,owner_id,email_normalized,display_name,password_salt,password_hash,role,status,created_at,updated_at FROM user_accounts").fetchall(),
        'owners': db.execute("SELECT * FROM owners").fetchall(),
        'sessions': db.execute("SELECT * FROM auth_sessions").fetchall(),
        'memberships': db.execute("SELECT * FROM user_memberships").fetchall(),
        'audit': db.execute("SELECT * FROM auth_audit_events").fetchall(),
    }
    pre_audit_count = len(pre_data['audit'])
    db.close()
    print(f'Seed: {len(pre_data["accounts"])} accounts, {len(pre_data["owners"])} owners, {len(pre_data["sessions"])} sessions, {len(pre_data["memberships"])} memberships, {pre_audit_count} audit')

    # ── Step 3: 应用0125 ──
    ok, out = run_migrations(db_path, MIG_DIR)
    check('P0-1a 0125应用成功', ok, out[:200])
    if not ok: return finish(tmp)

    db = sqlite3.connect(db_path)

    # 逐字段比较
    post_accounts = db.execute("SELECT user_id,owner_id,email_normalized,display_name,password_salt,password_hash,role,status,created_at,updated_at FROM user_accounts").fetchall()
    check('P0-1b 账号逐字段一致', post_accounts == pre_data['accounts'],
          f'pre={pre_data["accounts"][0][:3]} post={post_accounts[0][:3] if post_accounts else "EMPTY"}')

    post_owners = db.execute("SELECT * FROM owners").fetchall()
    check('P0-1c owner逐字段一致', post_owners == pre_data['owners'])

    post_sessions = db.execute("SELECT * FROM auth_sessions").fetchall()
    check('P0-1d 会话逐字段一致', post_sessions == pre_data['sessions'])

    post_memberships = db.execute("SELECT * FROM user_memberships").fetchall()
    check('P0-2a 权益逐字段一致', post_memberships == pre_data['memberships'],
          f'pre={pre_data["memberships"][0][:4]} post={post_memberships[0][:4] if post_memberships else "EMPTY"}')

    post_audit = db.execute("SELECT user_id,event_type,email_normalized,actor_user_id,recorded_at,details_json FROM auth_audit_events").fetchall()
    check('P0-2b 旧审计记录保留', len(post_audit) >= pre_audit_count,
          f'pre_count={pre_audit_count} post_count={len(post_audit)}')

    # 新列存在
    cols = get_schema(db, 'user_accounts')
    check('P0-3a password_format列已加', 'password_format' in cols)
    check('P0-3b credential_version列已加', 'credential_version' in cols)

    # 重入
    ok2, out2 = run_migrations(db_path, MIG_DIR)
    if ok2:
        import json as j
        result = j.loads(out2)
        check('P0-4 重入幂等(applied=0)', result.get('applied') == [], f'applied={result.get("applied")}')
    else:
        check('P0-4 重入幂等', False, out2[:200])
    db.close()

    # ── Step 4: 失败注入（auth_audit_events_v2 INSERT） ──
    fail_db = os.path.join(tmp, 'fail.sqlite')
    ok, _ = run_migrations(fail_db, mig_0124)
    if not ok:
        check('P0-5a 失败注入前置库', False, '0124库创建失败')
        return finish(tmp)

    fail_mig = os.path.join(tmp, 'mig-fail')
    os.makedirs(fail_mig)
    for f in sorted(os.listdir(MIG_DIR)):
        if f.endswith('.sql') and f < '0125':
            shutil.copy(os.path.join(MIG_DIR, f), os.path.join(fail_mig, f))
    # 复制0125并在INSERT INTO auth_audit_events_v2前注入失败SQL
    with open(os.path.join(MIG_DIR, '0125_password_scrypt_v2.sql')) as f:
        sql_0125 = f.read()
    # 在INSERT INTO auth_audit_events_v2之前注入确定失败的语句
    # 0125重建audit表：CREATE v2 → INSERT INTO v2 SELECT → DROP旧 → RENAME
    # 在INSERT前注入SELECT 1/0让整个迁移失败
    injected = sql_0125.replace(
        'INSERT INTO auth_audit_events_v2 SELECT * FROM auth_audit_events;',
        'SELECT 1/0 AS forced_failure;\nINSERT INTO auth_audit_events_v2 SELECT * FROM auth_audit_events;'
    )
    if injected == sql_0125:
        # 如果没找到精确匹配，在文件末尾的DROP之前注入
        injected = sql_0125 + '\nSELECT 1/0 AS forced_failure_at_end;'
    with open(os.path.join(fail_mig, '0125_password_scrypt_v2.sql'), 'w') as f:
        f.write(injected)

    ok3, out3 = run_migrations(fail_db, fail_mig)
    check('P0-5b 注入后迁移确实失败', not ok3, f'exit={ok3} err={out3[:200] if not ok3 else "unexpected success"}')

    # 验证无半成品
    fdb = sqlite3.connect(fail_db)
    f_cols = get_schema(fdb, 'user_accounts')
    has_partial = 'password_format' in f_cols or 'credential_version' in f_cols
    check('P0-5c 失败后无半成品列', not has_partial, f'cols={list(f_cols.keys())[-5:]}')

    # v2临时表不应存在
    v2_tables = fdb.execute("SELECT name FROM sqlite_master WHERE name LIKE 'auth_audit_events_v2%' OR name LIKE '%_v2'").fetchall()
    check('P0-5d 失败后无残留临时表', len(v2_tables) == 0, f'tables={v2_tables}')

    # 0125不应在schema_migrations中
    applied = fdb.execute("SELECT name FROM schema_migrations WHERE name LIKE '%0125%'").fetchall()
    check('P0-5e 0125未登记', len(applied) == 0, f'applied={applied}')

    # 原表完整
    orig_count = fdb.execute("SELECT COUNT(*) FROM auth_audit_events").fetchone()[0]
    check('P0-5f 原审计表完整', orig_count == 0, f'count={orig_count}')  # 空库seed前=0

    # 移除故障后迁移成功
    ok4, _ = run_migrations(fail_db, MIG_DIR)  # 用正式迁移目录（无注入）
    check('P0-5g 移除故障后迁移成功', ok4)
    fdb.close()

    return finish(tmp)

def finish(tmp):
    shutil.rmtree(tmp, ignore_errors=True)
    total = PASS + FAIL
    print(f'\nPhase0 RESULT: {PASS}/{total} PASS, {FAIL} FAIL')
    sys.exit(FAIL)

if __name__ == '__main__':
    main()
