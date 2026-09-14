#!/bin/bash
# AUTH-TAKEOVER-01 Linux回退目标构建脚本
# 从基准5edad171独立构建+双格式补丁+0125迁移
# 用法: 在候选源码根执行 bash scripts/release/auth-takeover/linux/build-rollback.sh [输出目录]
set -euo pipefail

SRC="$(pwd)"
GIT=$(which git)
TSC="node $SRC/node_modules/typescript/bin/tsc"
BASE_COMMIT="5edad171"
AUTH_PATH="apps/api/src/infrastructure/security/account-auth-service.ts"
OUT="${1:-$SRC/.local/rollback-target-linux}"
TMP=$(mktemp -d /tmp/auth-rb-build-XXXXXX)

echo "=== Linux回退目标构建 ==="
echo "基准: $BASE_COMMIT"
echo "输出: $OUT"
echo "临时: $TMP"

echo "--- Step 1: git worktree detach基准 ---"
"$GIT" worktree add --detach "$TMP/src" "$BASE_COMMIT" 2>&1 | tail -1

echo "--- Step 2: 应用双格式补丁（确定性文本替换） ---"
AUTH_FILE="$TMP/src/$AUTH_PATH"
python3 -c "
import sys
with open('$AUTH_FILE', 'r') as f:
    original = f.read()

# 补丁1: AccountRow加4列
anchor1 = '  password_salt: string;\n  password_hash: string;\n'
assert anchor1 in original, 'anchor1 missing'
patched = original.replace(anchor1, anchor1 + '  password_format: string | null;\n  password_n: number | null;\n  password_r: number | null;\n  password_p: number | null;\n')

# 补丁2: login双格式读取
anchor2 = \"    const salt = account?.password_salt ?? '00000000000000000000000000000000';\n    const supplied = await derivePasswordHash(password.slice(0, MAX_PASSWORD_LENGTH), salt);\"
assert anchor2 in patched, 'anchor2 missing'
replacement2 = '''    // ROLLBACK-TARGET: dual-format credential read (NULL=v1, scrypt-v2=stored bounded params).
    const fallbackSalt = account?.password_salt ?? '00000000000000000000000000000000';
    const params = account !== undefined && account.password_format === 'scrypt-v2'
      && account.password_n !== null && account.password_r !== null && account.password_p !== null
      && account.password_n > 0 && account.password_n <= 1_048_576
      && account.password_r > 0 && account.password_r <= 64
      && account.password_p > 0 && account.password_p <= 64
      ? { N: account.password_n, r: account.password_r, p: account.password_p }
      : { N: 16_384, r: 8, p: 1 };
    const supplied = await derivePasswordHash(password.slice(0, MAX_PASSWORD_LENGTH), fallbackSalt, params);'''
patched = patched.replace(anchor2, replacement2)

# 补丁3: derivePasswordHash接受显式参数
anchor3 = 'function derivePasswordHash(password: string, salt: string): Promise<string> {\n  return new Promise((resolve, reject) => {\n    scrypt(password, salt, PASSWORD_BYTES, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }'
assert anchor3 in patched, 'anchor3 missing'
replacement3 = 'function derivePasswordHash(password: string, salt: string, params: { N: number; r: number; p: number } = { N: 16_384, r: 8, p: 1 }): Promise<string> {\n  return new Promise((resolve, reject) => {\n    scrypt(password, salt, PASSWORD_BYTES, { N: params.N, r: params.r, p: params.p, maxmem: 128 * 1024 * 1024 }'
patched = patched.replace(anchor3, replacement3)

with open('$AUTH_FILE', 'w') as f:
    f.write(patched)
print('patch applied')
"

echo "--- Step 3: 复制0125迁移 ---"
cp "$SRC/apps/api/src/infrastructure/db/migrations/0125_password_scrypt_v2.sql" "$TMP/src/apps/api/src/infrastructure/db/migrations/"

echo "--- Step 4: 构建依赖包 ---"
# contracts
cd "$TMP/src/apps/contracts"
rm -rf dist && $TSC -p tsconfig.build.json 2>&1 | head -3
echo "  contracts exit=$?"

# v7-backend（需要agent-catalog源码）
# 先复制agent-catalog（源码级包）
cp -r "$SRC/rebuild/packages/agent-catalog/"*.js "$SRC/rebuild/packages/agent-catalog/"*.d.ts "$TMP/src/node_modules/@wenmi/agent-catalog/" 2>/dev/null || {
  mkdir -p "$TMP/src/node_modules/@wenmi/agent-catalog"
  cp "$SRC/rebuild/packages/agent-catalog/"*.js "$SRC/rebuild/packages/agent-catalog/"*.d.ts "$TMP/src/node_modules/@wenmi/agent-catalog/"
}

cd "$TMP/src/coauthoring-v7/backend"
rm -rf dist && $TSC -p tsconfig.build.json 2>&1 | head -3
echo "  v7-backend exit=$?"

echo "--- Step 5: 构建API（回退目标） ---"
cd "$TMP/src/apps/api"
rm -rf dist && $TSC -p tsconfig.build.json 2>&1 | head -5
echo "  api exit=$?"
test -f dist/main.js && echo "  API-DIST-OK" || { echo "  API-DIST-FAIL"; exit 1; }

echo "--- Step 6: 打包 ---"
mkdir -p "$OUT"
cp -r dist "$OUT/dist"
mkdir -p "$OUT/apps/api/src/infrastructure/db/migrations"
cp "$TMP/src/apps/api/src/infrastructure/db/migrations/"*.sql "$OUT/apps/api/src/infrastructure/db/migrations/"

echo "--- Step 7: Manifest ---"
cd "$OUT"
python3 -c "
import hashlib, json, os
def hash_file(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()

def hash_tree(directory):
    files = []
    for root, dirs, names in os.walk(directory):
        for name in sorted(names):
            path = os.path.join(root, name)
            rel = os.path.relpath(path, directory).replace(os.sep, '/')
            files.append({'path': rel, 'sha256': hash_file(path)})
    return sorted(files, key=lambda x: x['path'])

manifest = {
    'marker': 'auth-takeover-rollback-target-linux',
    'sourceCommit': '$BASE_COMMIT',
    'builtOn': 'linux',
    'nodeVersion': '$(node --version)',
    'patchSummary': 'AccountAuthService dual-format read + 0125 migration',
    'createdAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
    'dist': hash_tree('dist'),
    'migrations': hash_tree('apps/api/src/infrastructure/db/migrations'),
    'distFileCount': len(hash_tree('dist')),
    'migrationFileCount': len(hash_tree('apps/api/src/infrastructure/db/migrations')),
}
with open('manifest.json', 'w') as f:
    json.dump(manifest, f, indent=2)
print(f'dist={manifest[\"distFileCount\"]}files migrations={manifest[\"migrationFileCount\"]}files')
print(f'api main.js sha256={hash_file(\"dist/main.js\")}')
"

echo "--- Step 8: 清理worktree ---"
"$GIT" worktree remove --force "$TMP/src" 2>/dev/null || true
rm -rf "$TMP"

echo "=== 回退目标构建完成: $OUT ==="
