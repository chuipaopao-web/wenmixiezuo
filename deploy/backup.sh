#!/usr/bin/env bash
# 文秘写作数据库备份脚本
#
# 用法：/opt/wenmi/deploy/backup.sh
# 定时：0 3 * * * /opt/wenmi/deploy/backup.sh >> /var/log/wenmi-backup.log 2>&1
#
# 备份策略：
#   - 每日凌晨 3 点执行
#   - 保留最近 7 天的每日备份
#   - 保留最近 4 周的每周备份（周日生成）
#   - 备份包含 SQLite 数据库 + 不可变原文/附件目录
#   - 备份文件保存到 /opt/wenmi/data/backups/

set -euo pipefail

PROJECT_ROOT="${WENMI_PROJECT_ROOT:-/opt/wenmi}"
DATA_DIR="${PROJECT_ROOT}/data"
BACKUP_DIR="${DATA_DIR}/backups"
DB_PATH="${DATA_DIR}/database/wenmi.sqlite"
BOOKS_DIR="${DATA_DIR}/books"
STAGING_DIR="${DATA_DIR}/staging"
ARCHIVES_DIR="${DATA_DIR}/archives"
IMPORTS_DIR="${DATA_DIR}/imports"

TODAY="$(date +%Y%m%d)"
DAY_OF_WEEK="$(date +%u)"  # 1=Mon, 7=Sun

# ---- 确保备份目录存在 ----
mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/weekly"

# ---- 数据库在线备份（使用 sqlite3 .backup 保证一致性） ----
DB_BACKUP="${BACKUP_DIR}/daily/wenmi-${TODAY}.sqlite"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始备份数据库到 ${DB_BACKUP}"

sqlite3 "${DB_PATH}" "VACUUM INTO '${DB_BACKUP}'"

# 生成 SHA-256 校验和
sha256sum "${DB_BACKUP}" > "${DB_BACKUP}.sha256"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 数据库备份完成，校验和已保存"

# ---- 文件备份（不可变原件、附件、导入） ----
FILES_BACKUP="${BACKUP_DIR}/daily/wenmi-files-${TODAY}.tar.gz"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始备份文件到 ${FILES_BACKUP}"

# 只备份存在且非空的目录
archive_dirs=()
for dir in "${BOOKS_DIR}" "${STAGING_DIR}" "${ARCHIVES_DIR}" "${IMPORTS_DIR}"; do
  if [ -d "${dir}" ] && [ -n "$(ls -A "${dir}" 2>/dev/null)" ]; then
    archive_dirs+=("${dir}")
  fi
done

if [ ${#archive_dirs[@]} -gt 0 ]; then
  tar -czf "${FILES_BACKUP}" -C "${DATA_DIR}" \
    $(for d in "${archive_dirs[@]}"; do realpath --relative-to="${DATA_DIR}" "${d}"; done)
  sha256sum "${FILES_BACKUP}" > "${FILES_BACKUP}.sha256"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 文件备份完成"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 没有需要备份的文件目录"
fi

# ---- 清理过期每日备份（保留 7 天） ----
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 清理过期每日备份..."
find "${BACKUP_DIR}/daily" -name "wenmi-*.sqlite" -mtime +7 -delete 2>/dev/null || true
find "${BACKUP_DIR}/daily" -name "wenmi-*.sqlite.sha256" -mtime +7 -delete 2>/dev/null || true
find "${BACKUP_DIR}/daily" -name "wenmi-files-*.tar.gz" -mtime +7 -delete 2>/dev/null || true
find "${BACKUP_DIR}/daily" -name "wenmi-files-*.tar.gz.sha256" -mtime +7 -delete 2>/dev/null || true

# ---- 每周备份（周日执行，保留 4 周） ----
if [ "${DAY_OF_WEEK}" = "7" ]; then
  WEEK_BACKUP="${BACKUP_DIR}/weekly/wenmi-${TODAY}.sqlite"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 生成每周备份 ${WEEK_BACKUP}"
  cp "${DB_BACKUP}" "${WEEK_BACKUP}"
  cp "${DB_BACKUP}.sha256" "${WEEK_BACKUP}.sha256"

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 清理过期每周备份..."
  find "${BACKUP_DIR}/weekly" -name "wenmi-*.sqlite" -mtime +28 -delete 2>/dev/null || true
  find "${BACKUP_DIR}/weekly" -name "wenmi-*.sqlite.sha256" -mtime +28 -delete 2>/dev/null || true
fi

# ---- 备份摘要 ----
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份完成"
echo "  数据库: $(du -h "${DB_BACKUP}" 2>/dev/null | cut -f1 || echo 'N/A')"
echo "  每日备份数: $(find "${BACKUP_DIR}/daily" -name 'wenmi-*.sqlite' | wc -l)"
echo "  每周备份数: $(find "${BACKUP_DIR}/weekly" -name 'wenmi-*.sqlite' | wc -l)"
echo "---"