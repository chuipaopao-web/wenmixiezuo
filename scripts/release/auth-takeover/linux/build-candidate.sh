#!/bin/bash
# AUTH-TAKEOVER-01 Linux候选干净构建脚本
# 用法: 在项目源码根目录执行 bash scripts/release/auth-takeover/linux/build-candidate.sh
# 前提: 已上传源码（含package-lock.json）到目标目录
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../../.." && pwd)/../../.."
SRC=$(cd "$SRC" && pwd)  # resolve to project root
TSC="node $SRC/node_modules/typescript/bin/tsc"

echo "=== Linux候选干净构建 ==="
echo "源码根: $SRC"
echo "Node: $(node --version)  npm: $(npm --version)"

echo "--- Step 1: npm ci（lockfile安装，正确workspace链接） ---"
cd "$SRC"
npm ci --ignore-scripts 2>&1 | tail -3
NPM_CI_EXIT=$?
echo "npm ci exit=$NPM_CI_EXIT"

echo "--- Step 2: 验证workspace链接 ---"
for pkg in api contracts worker agent-catalog opening-runtime time-machine-core v7-admin-console v7-author-app v7-backend; do
  target=$(readlink "node_modules/@wenmi/$pkg" 2>/dev/null || echo "NOT-LINKED")
  echo "  @wenmi/$pkg -> $target"
done

echo "--- Step 3: 构建依赖链（干净重建） ---"
build_pkg() {
  local dir=$1 name=$2
  echo "  [$name] "
  cd "$SRC/$dir"
  rm -rf dist
  $TSC -p tsconfig.build.json 2>&1 | head -5
  local exit_code=$?
  echo "  [$name] exit=$exit_code"
  return $exit_code
}

build_pkg apps/contracts contracts
build_pkg coauthoring-v7/backend v7-backend
build_pkg rebuild/packages/backend/src/legacy-opening opening-runtime || echo "  (opening-runtime may lack build config)"
build_pkg rebuild/packages/time-machine-core time-machine-core
build_pkg apps/api api
build_pkg apps/worker worker

echo "--- Step 4: API typecheck ---"
cd "$SRC/apps/api"
$TSC -p tsconfig.json --noEmit 2>&1 | head -5
echo "  typecheck exit=$?"

echo "--- Step 5: 产物hash ---"
cd "$SRC"
echo "dist hashes (sha256):"
sha256sum apps/api/dist/main.js apps/api/dist/identity/identity-service.js apps/worker/dist/main.js apps/contracts/dist/index.js 2>/dev/null

echo "--- Step 6: 磁盘 ---"
df -h / | tail -1
du -sh "$SRC" 2>/dev/null

echo "=== 构建完成 ==="
