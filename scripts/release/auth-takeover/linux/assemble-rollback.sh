#!/bin/bash
# AUTH-TAKEOVER-01 兼容回退闭包组装（已上线批次收尾入库版）
# 用法: sudo bash assemble-rollback.sh <OUT_DIR> <PROD_RELEASE_DIR> <ROLLBACK_PKG_DIR> [--test-roots]
#
# 结构：现网release独立副本（cp -a --reflink=auto，无共享可写inode；禁用cp -al硬链接副本）
#   + 仅替换 apps/api/dist 为已验证回退dist + 替换迁移目录 + 合规RELEASE_ID（先rm再写）。
#   副本符号链接核查：解析目标（readlink -f）必须在副本/回退包/预验目录内；
#   悬空链接按词法解析（realpath -m，不要求存在）判界——解析后仍在允许前缀内放行
#   （如现网自带的 legacy-opening/time-machine-core 自引用悬空链接），逃逸即拒绝；
#   绝对目标指向生产可变路径一律拒绝。
#   组装前后源全量内容/属主/权限对比（不截断）；副本与源inode隔离抽验。
#   正式启用为回退目标前必须完成wenmi隔离进程验证（见文件尾注）。
#  --test-roots: 仅供合成测试（跳过/opt/wenmi-releases根限制），生产禁止
set -eu

OUT="${1:?用法: assemble-rollback.sh <OUT_DIR> <PROD_RELEASE_DIR> <ROLLBACK_PKG_DIR> [--test-roots]}"
PROD_REL="${2:?缺现网release目录}"
RB="${3:?缺回退包目录}"
TEST_ROOTS=0
[ "${4:-}" = "--test-roots" ] && TEST_ROOTS=1

[ "$(id -u)" = 0 ] || { echo "需要sudo"; exit 1; }
[ -e "$OUT" ] && { echo "拒绝: 输出目录已存在"; exit 1; }
[ -f "$RB/manifest.json" ] || { echo "缺少回退manifest: $RB/manifest.json"; exit 1; }
if [ $TEST_ROOTS -eq 0 ]; then
  readlink -f "$OUT" | grep -q '^/opt/wenmi-releases/' || { echo "OUT必须在/opt/wenmi-releases下"; exit 1; }
fi

SRC_BLOCK=$(du -sB1 "$PROD_REL" | cut -f1)
AVAIL=$(df -PB1 "$(dirname "$OUT")" | awk 'NR==2{print $4}')
echo "源块级=$SRC_BLOCK 可用=$AVAIL（按最坏完整复制预算）"
[ "$AVAIL" -ge $((SRC_BLOCK + 314572800)) ] || { echo "预算不足（源+300MB余量）"; exit 1; }

snap_source() {  # 源全量内容+元数据快照（hash/属主/权限；不截断，覆盖全部文件）
  (cd "$PROD_REL" && find . -type f -printf '%p|%s|%U|%G|%m\n' | sort
   find "$PROD_REL" -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum)
}
SNAP=$(mktemp /tmp/rb-src-snap.XXXXXXXX)
trap 'rm -f "$SNAP"' EXIT
snap_source > "$SNAP"

echo "=== 1) 独立副本（reflink=auto，无共享可写inode） ==="
cp -a --reflink=auto "$PROD_REL" "$OUT"

echo "=== 2) 副本内替换 apps/api/dist 为已验证回退dist ==="
API_DIST="$OUT/source/apps/api/dist"
rm -rf "$API_DIST"
cp -a "$RB/dist" "$API_DIST"

echo "=== 3) 副本内替换迁移目录 ==="
MIG="$OUT/source/apps/api/src/infrastructure/db/migrations"
rm -rf "$MIG"
cp -a "$RB/apps/api/src/infrastructure/db/migrations" "$MIG"

echo "=== 4) 写入合规RELEASE_ID（先rm，绝不截断可能共享的inode） ==="
REL_ID="wm-auth-takeover-r1-$(date -u +%Y%m%d)-$(date -u +%H%M%S)-5eda171"
echo "$REL_ID" | grep -Eq '^wm-auth-takeover-r[1-9][0-9]*-[0-9]{8}-[0-9]{6}-[0-9a-f]{7,}$' \
  || { echo "RELEASE_ID不合规: $REL_ID"; exit 1; }
rm -f "$OUT/RELEASE_ID"
printf '%s\n' "$REL_ID" > "$OUT/RELEASE_ID"
rm -f "$OUT/source/RELEASE_ID" 2>/dev/null || true
printf '%s\n' "$REL_ID" > "$OUT/source/RELEASE_ID"

echo "=== 5) 副本符号链接核查 ==="
# 解析目标：能解析用解析值；悬空用词法解析（realpath -m）。两者都必须落在允许前缀内。
BAD_LINKS=$(find "$OUT" -type l -printf '%p|%l\n' | while IFS='|' read -r lp target; do
  t=$(readlink -f "$lp" 2>/dev/null || true)
  if [ -z "$t" ]; then
    case "$target" in
      /*) t=$(realpath -m -- "$target" 2>/dev/null || echo ESCAPED-ABSOLUTE) ;;
      *)  t=$(realpath -m -- "$(dirname "$lp")/$target" 2>/dev/null || echo ESCAPED-RELATIVE) ;;
    esac
  fi
  case "$t" in
    "$OUT"*) : ;;
    "$RB"*) : ;;
    /opt/wenmi-releases/wm-auth-takeover01-preflight/*) : ;;
    /opt/wenmi-releases/wm-v7-20260914-151504-a7614958/*) : ;;
    *) echo "$lp -> $t (raw=$target)" ;;
  esac
done)
if [ -n "$BAD_LINKS" ]; then echo "发现越界符号链接:"; echo "$BAD_LINKS" | head -5; exit 1; fi

echo "=== 6) 副本归属调整（仅副本；源不动） ==="
chown -R wenmi:wenmi "$OUT" 2>/dev/null || chown -R "$(stat -c '%U:%G' "$PROD_REL")" "$OUT"

echo "=== 7) 源不变性验证（内容hash/属主/权限全量对比快照，不截断） ==="
snap_source > "$SNAP.after"
if cmp -s "$SNAP" "$SNAP.after"; then
  echo "  源不变: PASS"
else
  echo "  源不变: FAIL!!（复制/替换/改写影响了源）"; diff "$SNAP" "$SNAP.after" | head -5; exit 1
fi

echo "=== 8) 副本与源inode隔离抽验 ==="
ISOL=1
for f in RELEASE_ID source/apps/worker/dist/main.js source/package.json; do
  [ -f "$PROD_REL/$f" ] && [ -f "$OUT/$f" ] || continue
  si=$(stat -c %i "$PROD_REL/$f"); oi=$(stat -c %i "$OUT/$f")
  [ "$si" = "$oi" ] && { echo "  inode共享!! $f ($si)"; ISOL=0; }
done
[ $ISOL -eq 1 ] && echo "  inode隔离: PASS" || exit 1

echo "=== 9) 与回退manifest逐文件核对（dist+迁移） ==="
python3 - "$OUT" "$RB" <<'PY'
import hashlib, json, os, sys
out, rb = sys.argv[1], sys.argv[2]
m = json.load(open(os.path.join(rb, 'manifest.json')))
def sha(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()
bad = [f"{s}/{f['path']}" for s, root in
       [('dist', os.path.join(out, 'source/apps/api/dist')),
        ('migrations', os.path.join(out, 'source/apps/api/src/infrastructure/db/migrations'))]
       for f in m[s]
       if not os.path.isfile(os.path.join(root, f['path'])) or sha(os.path.join(root, f['path'])) != f['sha256']]
print(f'核对: dist {len(m["dist"])} + 迁移 {len(m["migrations"])} 文件')
if bad:
    print('不一致:', bad[:5]); sys.exit(1)
print('ROLLBACK-ASSEMBLY: PASS')
PY

echo ""
echo "组装完成: $OUT (RELEASE_ID=$REL_ID)"
echo "启用为回退目标前必须完成并留存：wenmi隔离进程验证——"
echo "  0125已迁移库上以wenmi+env白名单启动副本API，验证 health=200、v1登录=200、"
echo "  v2(scrypt-v2)登录=200、POST /auth/password/change=404、POST /auth/sessions/revoke-others=404"
echo "  （参照 space-release-execute phase4b2；验证脚本自身需带会话cookie与匹配的origin头）"
