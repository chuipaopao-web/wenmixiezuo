#!/bin/bash
# AUTH-TAKEOVER-01 Linux候选构建脚本（返工3修正版）
# 用法: SRC=/path/to/source bash scripts/release/auth-takeover/linux/build-candidate.sh
# SRC必须为绝对路径且含package.json+package-lock.json，脚本验证后才开始。
set -euo pipefail

# ── 根路径：显式参数，不猜相对路径 ──
SRC="${SRC:?用法: SRC=/path/to/source bash $0}"
SRC="$(cd "$SRC" && pwd)"

# 验证根路径
if [ ! -f "$SRC/package.json" ] || [ ! -f "$SRC/package-lock.json" ]; then
  echo "ERROR: $SRC 不是有效的项目根（缺少package.json或package-lock.json）"; exit 1
fi
if ! grep -q '"wenmi-writing"' "$SRC/package.json" 2>/dev/null && ! grep -q '"name"' "$SRC/package.json" 2>/dev/null; then
  echo "ERROR: $SRC/package.json 不含项目名"; exit 1
fi
if [ -f "$SRC/.wenmi-prod-marker" ]; then
  echo "ERROR: 拒绝在生产目录上构建（prod-marker）"; exit 1
fi
# 现网实际位于 /opt/wenmi-releases/<release>/source（由 /opt/wenmi/* 符号链接解析指向），
# 只拒绝 /opt/wenmi 前缀不够；必须对现网每个符号链接的 realpath 做双向包含比对。
SRC_REAL=$(readlink -f "$SRC") || { echo "ERROR: 无法解析SRC真实路径"; exit 1; }
for prod_link in /opt/wenmi/*; do
  [ -L "$prod_link" ] || continue
  prod_real=$(readlink -f "$prod_link") || continue
  case "$SRC_REAL" in
    "$prod_real"|"$prod_real"/*) echo "ERROR: 拒绝在生产目录上构建: $SRC_REAL 解析为现网 $prod_real"; exit 1 ;;
  esac
  case "$prod_real" in
    "$SRC_REAL"/*) echo "ERROR: 拒绝在现网上级目录构建: $SRC_REAL 包含现网 $prod_real"; exit 1 ;;
  esac
done

TSC="node $SRC/node_modules/typescript/bin/tsc"
LOG="$SRC/.local/build-candidate.log"

echo "=== Linux候选构建 ===" | tee "$LOG"
echo "源码根: $SRC" | tee -a "$LOG"
echo "Node: $(node --version)  npm: $(npm --version)" | tee -a "$LOG"
echo "开始: $(date -Iseconds)" | tee -a "$LOG"

# ── Step 1: npm ci ──
echo "--- npm ci ---" | tee -a "$LOG"
cd "$SRC"
npm ci --ignore-scripts >> "$LOG" 2>&1
NPM_CI_EXIT=$?
echo "npm ci exit=$NPM_CI_EXIT" | tee -a "$LOG"

# 验证workspace链接
echo "--- workspace链接 ---" | tee -a "$LOG"
for pkg in api contracts worker agent-catalog opening-runtime time-machine-core v7-admin-console v7-author-app v7-backend; do
  target=$(readlink "node_modules/@wenmi/$pkg" 2>/dev/null || echo "NOT-LINKED")
  echo "  @wenmi/$pkg -> $target" | tee -a "$LOG"
done

# ── Step 2: 构建依赖链（不吞错，完整输出） ──
build_pkg() {
  local dir=$1 name=$2 must_succeed=$3
  echo "--- [$name] ---" | tee -a "$LOG"
  local full="$SRC/$dir"
  if [ ! -d "$full" ]; then
    echo "  目录不存在: $full" | tee -a "$LOG"
    if [ "$must_succeed" = "required" ]; then return 1; fi
    return 0
  fi
  cd "$full"
  rm -rf dist
  $TSC -p tsconfig.build.json >> "$LOG" 2>&1
  local exit_code=$?
  echo "  exit=$exit_code" | tee -a "$LOG"
  if [ $exit_code -ne 0 ] && [ "$must_succeed" = "required" ]; then
    echo "  编译诊断（最后20行）:" | tee -a "$LOG"
    tail -20 "$LOG" | tee -a "$LOG"
    return $exit_code
  fi
}

build_pkg apps/contracts contracts required
build_pkg coauthoring/v7-backend v7-backend required 2>/dev/null || build_pkg coauthoring-v7/backend v7-backend required
build_pkg rebuild/packages/backend/src/legacy-opening opening-runtime required
build_pkg rebuild/packages/time-machine-core time-machine-core required
build_pkg apps/api api required
build_pkg apps/worker worker required

# ── Step 3: 验证产物 ──
echo "--- 产物验证 ---" | tee -a "$LOG"
for f in apps/api/dist/main.js apps/api/dist/identity/identity-service.js apps/worker/dist/main.js apps/contracts/dist/index.js; do
  if [ -f "$SRC/$f" ]; then
    hash=$(sha256sum "$SRC/$f" | cut -d' ' -f1)
    echo "  ✓ $f sha256=$hash" | tee -a "$LOG"
  else
    echo "  ✗ $f MISSING" | tee -a "$LOG"
    exit 1
  fi
done

# ── Step 4: API typecheck ──
echo "--- API typecheck ---" | tee -a "$LOG"
cd "$SRC/apps/api"
$TSC -p tsconfig.json --noEmit >> "$LOG" 2>&1
TYPECHECK_EXIT=$?
echo "  typecheck exit=$TYPECHECK_EXIT" | tee -a "$LOG"

# ── Step 5: 全包hash manifest ──
echo "--- 全包manifest ---" | tee -a "$LOG"
cd "$SRC"
python3 -c "
import hashlib, json, os
def sha(p):
    with open(p,'rb') as f: return hashlib.sha256(f.read()).hexdigest()
def tree(d):
    return sorted([{'path':os.path.relpath(os.path.join(r,n),d).replace(os.sep,'/'),'sha256':sha(os.path.join(r,n))}
                   for r,ds,ns in os.walk(d) for n in ns], key=lambda x:x['path'])
pkgs = {}
for name, d in [('api','apps/api'),('worker','apps/worker'),('contracts','apps/contracts'),('v7-backend','coauthoring-v7/backend')]:
    dist = os.path.join('$SRC', d, 'dist')
    if os.path.isdir(dist):
        files = tree(dist)
        pkgs[name] = {'fileCount': len(files), 'files': files}
manifest = {'builtAt': __import__('datetime').datetime.utcnow().isoformat()+'Z', 'packages': pkgs}
with open('$SRC/.local/build-candidate-manifest.json','w') as f: json.dump(manifest,f,indent=2)
for name,v in pkgs.items(): print(f'  {name}: {v[\"fileCount\"]}files')
"

echo "--- 磁盘 ---" | tee -a "$LOG"
df -h / | tail -1 | tee -a "$LOG"
echo "=== 构建完成 $(date -Iseconds) ===" | tee -a "$LOG"
echo "日志: $LOG"
