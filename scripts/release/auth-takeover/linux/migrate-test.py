#!/usr/bin/env python3
"""
AUTH-TAKEOVER-01 Phase 0: 0125独立迁移验证（返工4修正版）
在0124 schema合成库上验证：数据保留（逐字段）、重入幂等、失败原子性。
用法: python3 migrate-test.py <src_root>
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile

SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('SRC', '.')
MIG_DIR = os.path.join(SRC, 'apps/api/src/infrastructure/db/migrations')
DIST_MIG = os.path.join(SRC, 'apps/api/dist/infrastructure/db/migrations.js')
SEED_SALT = '0123456789abcdef0123456789abcdef'
# 确定性失败注入：SQLite除零不报错（返回NULL），必须用运行期错误"no such table"
FAIL_SQL = 'INSERT INTO __wm_migration_failure_injection__ VALUES (1);'

PASS = 0; FAIL = 0

def check(label, condition, detail=''):
    global PASS, FAIL
    if condition:
        PASS += 1; print(f'  ✓ {label} {detail}')
    else:
        FAIL += 1; print(f'  ✗ {label} {detail}')

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

def scrypt_v1_hash():
    r = subprocess.run(['node', '-e',
        "const {scryptSync}=require('node:crypto');"
        f"console.log(scryptSync('Old-Pass-123-456!','{SEED_SALT}',64,{{N:16384,r:8,p:1,maxmem:134217728}}).toString('hex'));"],
        capture_output=True, text=True)
    h = r.stdout.strip()
    if not h:
        raise RuntimeError('scrypt哈希计算失败: ' + r.stderr[-200:])
    return h

def seed_data(db_path, pw_hash):
    """在0124 schema库上种历史数据（列名按0045/0057实际schema）。"""
    db = sqlite3.connect(db_path)
    db.execute("INSERT INTO owners(owner_id,display_name,version,created_at,updated_at) VALUES(?,?,?,?,?)",
               ('mig-owner', '迁移Owner', 1, '2026-01-01', '2026-01-01'))
    db.execute("""INSERT INTO user_accounts(user_id,owner_id,email_normalized,display_name,
        password_salt,password_hash,role,status,created_at,updated_at,last_login_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        ('mig-user', 'mig-owner', 'mig@example.com', '迁移用户', SEED_SALT, pw_hash,
         'user', 'active', '2026-01-01', '2026-01-01', None))
    db.execute("INSERT INTO auth_sessions(session_id,user_id,token_hash,created_at,expires_at,last_seen_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)",
        ('mig-session', 'mig-user', 'a' * 64, '2026-01-01', '2027-01-01', '2026-01-01'))
    db.execute("""INSERT INTO user_memberships(user_id,owner_id,plan,token_quota,
        period_start,period_end,status,granted_by_user_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)""",
        ('mig-user', 'mig-owner', 'bronze', 200000, '2026-01-01', '2027-01-01',
         'active', 'mig-user', '2026-01-01', '2026-01-01'))
    db.execute("INSERT INTO auth_audit_events(audit_id,user_id,event_type,email_normalized,actor_user_id,recorded_at,details_json) VALUES(?,?,?,?,?,?,?)",
        ('mig-audit-1', 'mig-user', 'login_success', 'mig@example.com', 'mig-user',
         '2026-01-01', '{"seed":true}'))
    db.commit()
    db.close()

def snapshot(db_path):
    db = sqlite3.connect(db_path)
    data = {
        'accounts': db.execute("SELECT user_id,owner_id,email_normalized,display_name,password_salt,password_hash,role,status,created_at,updated_at FROM user_accounts").fetchall(),
        'owners': db.execute("SELECT * FROM owners").fetchall(),
        'sessions': db.execute("SELECT * FROM auth_sessions").fetchall(),
        'memberships': db.execute("SELECT * FROM user_memberships").fetchall(),
        'audit': db.execute("SELECT * FROM auth_audit_events").fetchall(),
    }
    db.close()
    return data

def copy_migrations(dst, include_0125=False):
    os.makedirs(dst, exist_ok=True)
    for f in sorted(os.listdir(MIG_DIR)):
        if f.endswith('.sql') and (include_0125 or f < '0125'):
            shutil.copy(os.path.join(MIG_DIR, f), os.path.join(dst, f))

def main():
    tmp = tempfile.mkdtemp(prefix='auth-mig4-')
    db_path = os.path.join(tmp, 'test.sqlite')
    mig_0124 = os.path.join(tmp, 'mig-0124')

    copy_migrations(mig_0124)
    print(f'0124 migrations: {len(os.listdir(mig_0124))} files')

    # ── Step 1: 创建0124库 ──
    ok, out = run_migrations(db_path, mig_0124)
    check('P0-0a 创建0124库', ok, out[:100] if ok else out)
    if not ok:
        return finish(tmp)

    db = sqlite3.connect(db_path)
    cols = get_schema(db, 'user_accounts')
    check('P0-0b 无password_format列', 'password_format' not in cols, str(list(cols.keys())[:8]))
    check('P0-0c 无credential_version列', 'credential_version' not in cols)
    db.close()

    # ── Step 2: 种历史数据 ──
    pw_hash = scrypt_v1_hash()
    seed_data(db_path, pw_hash)
    pre_data = snapshot(db_path)
    print(f'Seed: {len(pre_data["accounts"])} accounts, {len(pre_data["owners"])} owners, '
          f'{len(pre_data["sessions"])} sessions, {len(pre_data["memberships"])} memberships, {len(pre_data["audit"])} audit')

    # ── Step 3: 应用0125并逐字段比较 ──
    ok, out = run_migrations(db_path, MIG_DIR)
    check('P0-1a 0125应用成功', ok, out[:200])
    if not ok:
        return finish(tmp)

    post_data = snapshot(db_path)
    db = sqlite3.connect(db_path)
    cols = get_schema(db, 'user_accounts')
    db.close()
    check('P0-1b 账号逐字段一致', post_data['accounts'] == pre_data['accounts'],
          f"pre={pre_data['accounts'][0][:3]} post={post_data['accounts'][0][:3] if post_data['accounts'] else 'EMPTY'}")
    check('P0-1c owner逐字段一致', post_data['owners'] == pre_data['owners'])
    check('P0-1d 会话逐字段一致', post_data['sessions'] == pre_data['sessions'])
    check('P0-2a 权益逐字段一致', post_data['memberships'] == pre_data['memberships'],
          f"pre={pre_data['memberships'][0][:4]} post={post_data['memberships'][0][:4] if post_data['memberships'] else 'EMPTY'}")
    check('P0-2b 旧审计记录保留', len(post_data['audit']) >= len(pre_data['audit']),
          f'pre_count={len(pre_data["audit"])} post_count={len(post_data["audit"])}')
    check('P0-3a password_format列已加', 'password_format' in cols)
    check('P0-3b credential_version列已加', 'credential_version' in cols)

    # 重入幂等
    ok2, out2 = run_migrations(db_path, MIG_DIR)
    if ok2:
        result = json.loads(out2)
        check('P0-4 重入幂等(applied=0)', result.get('applied') == [], f'applied={result.get("applied")}')
    else:
        check('P0-4 重入幂等(applied=0)', False, out2[:200])

    # ── Step 4: 失败原子性（真实运行期错误注入，库内有种子数据） ──
    fail_db = os.path.join(tmp, 'fail.sqlite')
    ok, out = run_migrations(fail_db, mig_0124)
    if not ok:
        check('P0-5a 失败注入前置库', False, out[:200])
        return finish(tmp)
    seed_data(fail_db, pw_hash)

    fail_mig = os.path.join(tmp, 'mig-fail')
    copy_migrations(fail_mig, include_0125=True)
    with open(os.path.join(MIG_DIR, '0125_password_scrypt_v2.sql')) as f:
        sql_0125 = f.read()
    # 在INSERT INTO auth_audit_events_v2前注入确定失败语句（no such table → 迁移器ROLLBACK）
    injected = sql_0125.replace(
        'INSERT INTO auth_audit_events_v2 SELECT * FROM auth_audit_events;',
        FAIL_SQL + '\nINSERT INTO auth_audit_events_v2 SELECT * FROM auth_audit_events;')
    if injected == sql_0125:
        injected = sql_0125 + '\n' + FAIL_SQL
    with open(os.path.join(fail_mig, '0125_password_scrypt_v2.sql'), 'w') as f:
        f.write(injected)
    check('P0-5a 失败注入就位', FAIL_SQL in injected)

    ok3, out3 = run_migrations(fail_db, fail_mig)
    check('P0-5b 注入后迁移确实失败', not ok3, f'ok={ok3} err={out3[:160] if not ok3 else "unexpected success"}')

    fdb = sqlite3.connect(fail_db)
    f_cols = get_schema(fdb, 'user_accounts')
    check('P0-5c 失败后无半成品列',
          'password_format' not in f_cols and 'credential_version' not in f_cols,
          f'cols={list(f_cols.keys())[-5:]}')
    v2_tables = fdb.execute("SELECT name FROM sqlite_master WHERE type='table' AND substr(name,-3)='_v2'").fetchall()
    check('P0-5d 失败后无残留v2表', len(v2_tables) == 0, f'tables={v2_tables}')
    applied = fdb.execute("SELECT name FROM schema_migrations WHERE name LIKE '%0125%'").fetchall()
    check('P0-5e 0125未登记', len(applied) == 0, f'applied={applied}')
    orig_count = fdb.execute("SELECT COUNT(*) FROM auth_audit_events").fetchone()[0]
    check('P0-5f 种子审计行完好', orig_count == 1, f'count={orig_count}')
    fdb.close()

    # 移除故障后迁移成功，且种子审计行经v2重建仍保留
    ok4, _ = run_migrations(fail_db, MIG_DIR)
    fdb = sqlite3.connect(fail_db)
    post_cnt = fdb.execute("SELECT COUNT(*) FROM auth_audit_events").fetchone()[0]
    check('P0-5g 移除故障后迁移成功(审计保留)', ok4 and post_cnt == 1, f'ok={ok4} count={post_cnt}')
    fdb.close()

    return finish(tmp)

def finish(tmp):
    shutil.rmtree(tmp, ignore_errors=True)
    total = PASS + FAIL
    print(f'\nPhase0 RESULT: {PASS}/{total} PASS, {FAIL} FAIL')
    sys.exit(FAIL)

if __name__ == '__main__':
    main()
