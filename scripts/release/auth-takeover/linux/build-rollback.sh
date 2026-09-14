#!/bin/bash
# AUTH-TAKEOVER-01 Linux回退目标构建（返工3修正版：archive输入+OUT拒绝覆盖+失败回收）
# 用法: SRC=/path/to/candidate BASE_TAR=/path/to/base.tar.gz bash scripts/release/auth-takeover/linux/build-rollback.sh [OUT]
# SRC=候选源码根；BASE_TAR=git archive 5edad171完整tar.gz；OUT=输出目录（存在则拒绝）
set -eu  # 不用pipefail：tar|grep管道可能因SIGPIPE返回非零

SRC="${SRC:?需要SRC=候选源码根}"
BASE_TAR="${BASE_TAR:?需要BASE_TAR=基准archive}"
OUT="${1:-$SRC/.local/rollback-target-linux}"
TMP=""

cleanup() {
  # 只清理本脚本创建的临时目录
  if [ -n "$TMP" ] && [ -d "$TMP" ] && [ -f "$TMP/.wenmi-rb-build-marker" ]; then
    rm -rf "$TMP"
    echo "临时目录已回收: $TMP"
  fi
}
trap cleanup EXIT

# 验证输入
[ -f "$SRC/package.json" ] || { echo "ERROR: SRC无效"; exit 1; }
[ -f "$BASE_TAR" ] || { echo "ERROR: BASE_TAR不存在: $BASE_TAR"; exit 1; }
# 验证tar内容含基准代码
tar tzf "$BASE_TAR" 2>/dev/null | grep -q "apps/api/package.json" || { echo "ERROR: BASE_TAR不含apps/api"; exit 1; }

# OUT存在则拒绝（不覆盖未知目录）
if [ -e "$OUT" ]; then
  echo "ERROR: 输出目录已存在，拒绝覆盖: $OUT（如需重建请先手动删除）"
  exit 1
fi

# 验证OUT路径不在生产
case "$OUT" in
  /opt/wenmi/|/opt/wenmi/*) echo "ERROR: 拒绝在生产目录输出"; exit 1 ;;
esac
# 现网实际位于 /opt/wenmi-releases/<release>/source（由 /opt/wenmi/* 符号链接解析指向），
# 仅拒绝 /opt/wenmi 前缀不够；SRC（构建期会被重定向@wenmi链接）与OUT都必须与
# 现网每个符号链接的 realpath 做双向包含比对。
SRC_REAL=$(readlink -f "$SRC") || { echo "ERROR: 无法解析SRC真实路径"; exit 1; }
OUT_REAL=$(readlink -f "$(dirname "$OUT")")/$(basename "$OUT")
for prod_link in /opt/wenmi/*; do
  [ -L "$prod_link" ] || continue
  prod_real=$(readlink -f "$prod_link") || continue
  for target in "$SRC_REAL" "$OUT_REAL"; do
    case "$target" in
      "$prod_real"|"$prod_real"/*) echo "ERROR: 拒绝生产路径: $target ≈ 现网 $prod_real"; exit 1 ;;
    esac
    case "$prod_real" in
      "$target"/*) echo "ERROR: 拒绝现网上级路径: $target 包含现网 $prod_real"; exit 1 ;;
    esac
  done
done

TSC="node $SRC/node_modules/typescript/bin/tsc"
TMP=$(mktemp -d /tmp/auth-rb-build-XXXXXX)
echo "$TMP" > "$TMP/.wenmi-rb-build-marker"  # 归属标记

echo "=== Linux回退目标构建 ==="
echo "基准tar: $BASE_TAR"
echo "输出: $OUT"
echo "临时: $TMP"

# ── Step 1: 解压基准 ──
mkdir -p "$TMP/src"
tar xzf "$BASE_TAR" -C "$TMP/src"

# ── Step 2: 补丁+迁移+构建（python全权处理） ──
python3 - "$TMP" "$SRC" "$OUT" "$TSC" << 'PYEOF'
import sys, os, subprocess, hashlib, json, shutil

tmp, src, out, tsc_cmd = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
rb_src = os.path.join(tmp, 'src')
auth = os.path.join(rb_src, 'apps/api/src/infrastructure/security/account-auth-service.ts')
assert os.path.isfile(auth), f'基准缺少account-auth-service: {auth}'

# ── 补丁（确定性文本替换） ──
with open(auth) as f: original = f.read()
a1 = '  password_salt: string;\n  password_hash: string;\n'
assert a1 in original, 'anchor1 missing'
p = original.replace(a1, a1 + '  password_format: string | null;\n  password_n: number | null;\n  password_r: number | null;\n  password_p: number | null;\n')
a2 = "    const salt = account?.password_salt ?? '00000000000000000000000000000000';\n    const supplied = await derivePasswordHash(password.slice(0, MAX_PASSWORD_LENGTH), salt);"
assert a2 in p, 'anchor2 missing'
r2 = """    // ROLLBACK-TARGET: dual-format credential read (NULL=v1, scrypt-v2=stored bounded params).
    const fallbackSalt = account?.password_salt ?? '00000000000000000000000000000000';
    const params = account !== undefined && account.password_format === 'scrypt-v2'
      && account.password_n !== null && account.password_r !== null && account.password_p !== null
      && account.password_n > 0 && account.password_n <= 1_048_576
      && account.password_r > 0 && account.password_r <= 64
      && account.password_p > 0 && account.password_p <= 64
      ? { N: account.password_n, r: account.password_r, p: account.password_p }
      : { N: 16_384, r: 8, p: 1 };
    const supplied = await derivePasswordHash(password.slice(0, MAX_PASSWORD_LENGTH), fallbackSalt, params);"""
p = p.replace(a2, r2)
a3 = 'function derivePasswordHash(password: string, salt: string): Promise<string> {\n  return new Promise((resolve, reject) => {\n    scrypt(password, salt, PASSWORD_BYTES, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }'
assert a3 in p, 'anchor3 missing'
r3 = 'function derivePasswordHash(password: string, salt: string, params: { N: number; r: number; p: number } = { N: 16_384, r: 8, p: 1 }): Promise<string> {\n  return new Promise((resolve, reject) => {\n    scrypt(password, salt, PASSWORD_BYTES, { N: params.N, r: params.r, p: params.p, maxmem: 128 * 1024 * 1024 }'
p = p.replace(a3, r3)
with open(auth, 'w') as f: f.write(p)
print('PATCH-APPLIED')

# 补丁diff（作为证据保存）
diff = subprocess.run(['diff', '-u', '/dev/null', auth], capture_output=True, text=True)
with open(os.path.join(tmp, 'patch-diff.txt'), 'w') as f:
    f.write(diff.stdout[-4000:])

# ── 0125迁移 ──
mig_dir = os.path.join(rb_src, 'apps/api/src/infrastructure/db/migrations')
shutil.copy(os.path.join(src, 'apps/api/src/infrastructure/db/migrations/0125_password_scrypt_v2.sql'), mig_dir)
print('0125-COPIED')

# ── node_modules链接 ──
nm = os.path.join(rb_src, 'node_modules')
if os.path.islink(nm): os.unlink(nm)
elif os.path.isdir(nm): shutil.rmtree(nm)
os.symlink(os.path.join(src, 'node_modules'), nm)

# 临时@wenmi重定向（构建完后恢复）
saved_links = {}
for pkg in ['api', 'contracts']:
    link = os.path.join(src, 'node_modules/@wenmi', pkg)
    saved_links[pkg] = os.path.realpath(link)
    if os.path.islink(link): os.unlink(link)
    os.symlink(os.path.join(rb_src, 'apps', pkg), link)
print('WENMI-REDIRECTED')

# ── 构建（全部required，不吞错） ──
for name, dirpath in [('contracts','apps/contracts'),('v7-backend','coauthoring-v7/backend'),('api','apps/api')]:
    full = os.path.join(rb_src, dirpath)
    dist = os.path.join(full, 'dist')
    if os.path.isdir(dist): shutil.rmtree(dist)
    r = subprocess.run(tsc_cmd.split() + ['-p', 'tsconfig.build.json'], cwd=full, capture_output=True, text=True)
    print(f'{name}: exit={r.returncode}')
    if r.returncode != 0:
        print(f'STDOUT: {r.stdout[-500:]}')
        print(f'STDERR: {r.stderr[-500:]}')
        # 恢复链接后再退出
        for pkg2, orig in saved_links.items():
            link2 = os.path.join(src, 'node_modules/@wenmi', pkg2)
            if os.path.islink(link2): os.unlink(link2)
            os.symlink(orig, link2)
        sys.exit(1)

# 恢复@wenmi
for pkg, orig in saved_links.items():
    link = os.path.join(src, 'node_modules/@wenmi', pkg)
    if os.path.islink(link): os.unlink(link)
    os.symlink(orig, link)
print('WENMI-RESTORED')

# ── 打包 ──
os.makedirs(out)
shutil.copytree(os.path.join(rb_src, 'apps/api/dist'), os.path.join(out, 'dist'))
os.makedirs(os.path.join(out, 'apps/api/src/infrastructure/db/migrations'))
for f in os.listdir(mig_dir):
    if f.endswith('.sql'):
        shutil.copy(os.path.join(mig_dir, f), os.path.join(out, 'apps/api/src/infrastructure/db/migrations'))

# 保存补丁diff到输出
shutil.copy(os.path.join(tmp, 'patch-diff.txt'), os.path.join(out, 'patch-diff.txt'))

# ── RELEASE_ID ──
with open(os.path.join(out, 'RELEASE_ID'), 'w') as f:
    f.write('wm-auth-takeover-r1-20260914-120000-5eda171')

# ── Manifest（完整hash） ──
def sha(path):
    with open(path, 'rb') as f: return hashlib.sha256(f.read()).hexdigest()
def tree(d):
    return sorted([{'path': os.path.relpath(os.path.join(r,n), d).replace(os.sep,'/'), 'sha256': sha(os.path.join(r,n))}
                   for r,ds,ns in os.walk(d) for n in ns], key=lambda x: x['path'])

dist_files = tree(os.path.join(out, 'dist'))
mig_files = tree(os.path.join(out, 'apps/api/src/infrastructure/db/migrations'))
manifest = {
    'marker': 'auth-takeover-rollback-target-linux',
    'sourceCommit': '5edad171',
    'sourceInput': 'git archive tar.gz',
    'builtOn': 'linux',
    'nodeVersion': subprocess.run(['node','--version'], capture_output=True, text=True).stdout.strip(),
    'patchFile': 'patch-diff.txt',
    'patchSummary': 'dual-format login + explicit derivePasswordHash params + 0125 migration',
    'distFileCount': len(dist_files),
    'migrationFileCount': len(mig_files),
    'dist': dist_files,
    'migrations': mig_files,
    'dependencies': 'shared with candidate node_modules (lockfile-consistent)',
    'rollbackBehavior': {
        'newEndpoints': 'POST /auth/password/change and /auth/sessions/revoke-others return 404',
        'passwordFormats': 'v1 (NULL params) and v2 (scrypt-v2 stored params) both verify',
        'sessions': 'auth_sessions schema unchanged'
    }
}
with open(os.path.join(out, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
print(f'MANIFEST: dist={len(dist_files)}files migrations={len(mig_files)}files')
print(f'main.js sha256={sha(os.path.join(out, "dist/main.js"))}')
PYEOF

RB_EXIT=$?
if [ $RB_EXIT -ne 0 ]; then
  echo "构建失败，回收临时目录"
  # python脚本内部已恢复@wenmi，trap会清理TMP
  # 删除已创建的输出目录
  rm -rf "$OUT"
  exit $RB_EXIT
fi

echo "=== 回退目标构建完成: $OUT ==="
echo "manifest: $OUT/manifest.json"
echo "补丁diff: $OUT/patch-diff.txt"
