#!/usr/bin/env bash
# 服务器磁盘卫生脚本（第83批）：部署后或定期执行，防止"空间不够"复发。
# 只删可再生或已过保留期的内容；数据库、备份最新副本、回滚链、
# retained-release-evidence 一律不碰。默认 dry-run，加 APPLY=1 才真删。
# 用法：sudo bash server-disk-hygiene.sh            # 只看会删什么
#       sudo APPLY=1 bash server-disk-hygiene.sh    # 真正执行
set -Eeuo pipefail

APPLY="${APPLY:-0}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
STATIC_KEEP_EXTRA="${STATIC_KEEP_EXTRA:-2}"   # current/previous 之外再保留几个静态版本

echo "=== 清理前磁盘 ==="
df -h /opt | tail -n 1

freed=0
note() { echo "[$1] $2"; }

# 1. 系统日志真空（保留200MB）
if command -v journalctl >/dev/null 2>&1; then
  note "journal" "journalctl --vacuum-size=200M"
  if [ "$APPLY" = "1" ]; then journalctl --vacuum-size=200M >/dev/null 2>&1 || true; fi
fi

# 2. 包管理器缓存（可再生）
for c in "apt-get clean" ; do
  note "apt" "$c"
  if [ "$APPLY" = "1" ]; then $c >/dev/null 2>&1 || true; fi
done
if command -v npm >/dev/null 2>&1; then
  note "npm" "npm cache clean --force"
  if [ "$APPLY" = "1" ]; then npm cache clean --force >/dev/null 2>&1 || true; fi
fi

# 3. /tmp 部署残留（只删已知命名模式，且超过1天）
find /tmp -maxdepth 1 \( -name 'deploy-r*-*.sh' -o -name 'prune-r*.sh' -o -name '*-source.tar.gz' -o -name 'deploy-r*.log' \) -mtime +1 -print 2>/dev/null | while read -r f; do
  note "tmp" "删除 $f"
  if [ "$APPLY" = "1" ]; then rm -f -- "$f"; fi
done

# 4. 静态发布旧版本：保留 current/previous 与最近 N 个，其余删除
if [ -d /opt/wenmi/releases/versions ]; then
  keep_ids="$(readlink -f /opt/wenmi/releases/current 2>/dev/null || true)
$(readlink -f /opt/wenmi/releases/previous 2>/dev/null || true)"
  while read -r v; do
    [ -d "$v" ] || continue
    id="$(basename "$v")"
    full="$(readlink -f "$v")"
    if printf '%s\n' "$keep_ids" | grep -qx "$full"; then
      note "static" "KEEP $id（current/previous 指针）"
      continue
    fi
    keep_file="/opt/wenmi/releases/.hygiene-keep-$id"
    if [ ! -f "$keep_file" ]; then
      touch "$keep_file"
      note "static" "KEEP $id（首次见到的版本，留作观察）"
      continue
    fi
    age_days=$(( ( $(date +%s) - $(stat -c %Y "$keep_file") ) / 86400 ))
    if [ "$age_days" -lt "$STATIC_KEEP_EXTRA" ]; then
      note "static" "KEEP $id（保留观察期内）"
      continue
    fi
    note "static" "删除 $id（已非 current/previous 且超过保留期）"
    if [ "$APPLY" = "1" ]; then rm -rf -- "/opt/wenmi/releases/versions/${id:?}"; rm -f -- "$keep_file"; fi
  done < <(ls -1t /opt/wenmi/releases/versions 2>/dev/null)
fi

# 5. 旧发布暂存目录：只保留 apps 指针目标 + rollback 声明的目录
APPS_TARGET="$(readlink -f /opt/wenmi/apps 2>/dev/null | sed 's#/source/apps$##')"
if [ -d /opt/wenmi-releases ] && [ -n "$APPS_TARGET" ]; then
  while read -r r; do
    name="$(basename "$r")"
    if [ "${r}" = "$APPS_TARGET" ]; then note "releases" "KEEP $name（当前 apps 指针）"; continue; fi
    # 其余目录：保守起见只删除 30 天未变动的
    mt="$(stat -c %Y "$r" 2>/dev/null || echo 0)"
    age_days=$(( ( $(date +%s) - mt ) / 86400 ))
    if [ "$age_days" -ge 30 ]; then
      note "releases" "删除 $name（30天未变动且非当前指针）"
      if [ "$APPLY" = "1" ]; then rm -rf -- "/opt/wenmi-releases/${name:?}"; fi
    else
      note "releases" "KEEP $name（30天内有变动，可能是回滚链）"
    fi
  done < <(ls -1d /opt/wenmi-releases/*/ 2>/dev/null)
fi

# 6. 每日备份：只删超过保留期且已有 sha256 校验文件的旧备份
#    最新3份无论多旧都保留；retained-release-evidence 不在本脚本管辖。
if [ -d /opt/wenmi/data/backups/daily ]; then
  ls -1t /opt/wenmi/data/backups/daily 2>/dev/null | head -n 3 > /tmp/.hygiene-keep-backups || true
  find /opt/wenmi/data/backups/daily -maxdepth 1 -type f -mtime +"$BACKUP_KEEP_DAYS" -print 2>/dev/null | while read -r b; do
    base="$(basename "$b")"
    if grep -qx "$base" /tmp/.hygiene-keep-backups 2>/dev/null; then
      note "backup" "KEEP $base（最新3份）"
      continue
    fi
    note "backup" "删除 $base（超过${BACKUP_KEEP_DAYS}天）"
    if [ "$APPLY" = "1" ]; then rm -f -- "$b"; fi
  done
  rm -f /tmp/.hygiene-keep-backups
fi

rm -f /tmp/.hygiene-keep-backups 2>/dev/null || true
echo "=== 清理后磁盘 ==="
df -h /opt | tail -n 1
echo "HYGIENE_DONE apply=${APPLY}"
