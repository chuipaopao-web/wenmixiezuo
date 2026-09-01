#!/usr/bin/env bash
# 文秘写作 SQLite 与作者文件完整备份集。
#
# 定时任务必须显式用 bash 运行，并写入 wenmi 可写的日志目录：
#   0 3 * * * /usr/bin/timeout --signal=TERM --kill-after=2m 55m /usr/bin/bash /opt/wenmi/deploy/backup.sh >> /opt/wenmi/data/logs/backup.log 2>&1
#
# 每次运行生成唯一目录；数据库、作者文件、校验和、清单全部通过后才原子发布。
# 本脚本不自动删除任何历史备份。异机副本、恢复演练和删除预览未完成前，不得开启清理。

set -Eeuo pipefail
umask 077

GLOBAL_TIMEOUT_SECONDS="${WENMI_BACKUP_GLOBAL_TIMEOUT_SECONDS:-3000}"
KILL_AFTER_SECONDS="${WENMI_BACKUP_KILL_AFTER_SECONDS:-120}"
if [[ "${WENMI_BACKUP_DEADLINE_ACTIVE:-}" != "1" ]]; then
  [[ "${GLOBAL_TIMEOUT_SECONDS}" =~ ^(0|[1-9][0-9]*)$ ]] || {
    printf 'WENMI_BACKUP_GLOBAL_TIMEOUT_SECONDS 必须是非负整数\n' >&2
    exit 64
  }
  [[ "${KILL_AFTER_SECONDS}" =~ ^(0|[1-9][0-9]*)$ ]] || {
    printf 'WENMI_BACKUP_KILL_AFTER_SECONDS 必须是非负整数\n' >&2
    exit 64
  }
  (( ${#GLOBAL_TIMEOUT_SECONDS} <= 18 && GLOBAL_TIMEOUT_SECONDS >= 60 )) || {
    printf '全局备份超时不能低于60秒且不能超过18位整数\n' >&2
    exit 64
  }
  (( ${#KILL_AFTER_SECONDS} <= 18 && KILL_AFTER_SECONDS >= 1 )) || {
    printf '强制结束等待不能低于1秒且不能超过18位整数\n' >&2
    exit 64
  }
  exec /usr/bin/timeout --signal=TERM --kill-after="${KILL_AFTER_SECONDS}s" \
    "${GLOBAL_TIMEOUT_SECONDS}s" /usr/bin/env WENMI_BACKUP_DEADLINE_ACTIVE=1 \
    /usr/bin/bash "$0" "$@"
fi

PROJECT_ROOT="${WENMI_PROJECT_ROOT:-/opt/wenmi}"
DATA_DIR="${WENMI_DATA_DIR:-${PROJECT_ROOT}/data}"
BACKUP_DIR="${DATA_DIR}/backups"
DAILY_DIR="${BACKUP_DIR}/daily"
WEEKLY_DIR="${BACKUP_DIR}/weekly"
BACKUP_STAGING_DIR="${BACKUP_DIR}/.staging"
DB_PATH="${DATA_DIR}/database/wenmi.sqlite"
RUN_DAY="$(date +%Y%m%d)"
RUN_ID="${WENMI_BACKUP_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
DAY_OF_WEEK="${WENMI_BACKUP_DAY_OF_WEEK:-$(date +%u)}"
MIN_FREE_RESERVE_BYTES="${WENMI_BACKUP_MIN_FREE_RESERVE_BYTES:-5368709120}"
PRODUCTION_MIN_FREE_RESERVE_BYTES=5368709120
COMMAND_TIMEOUT_SECONDS="${WENMI_BACKUP_COMMAND_TIMEOUT_SECONDS:-2700}"
STALE_TEMP_MINUTES="${WENMI_BACKUP_STALE_TEMP_MINUTES:-1440}"
RETENTION_ENABLED="${WENMI_BACKUP_RETENTION_ENABLED:-false}"
TEST_MODE="${WENMI_BACKUP_TEST_MODE:-false}"
TEST_FAIL_STAGE="${WENMI_BACKUP_TEST_FAIL_STAGE:-}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "备份失败：$*"
  exit 1
}

require_unsigned_integer() {
  local name="$1"
  local value="$2"
  [[ "${value}" =~ ^(0|[1-9][0-9]*)$ ]] || fail "${name} 必须是非负整数，且不能带前导零"
  (( ${#value} <= 18 )) || fail "${name} 不能超过18位整数"
}

test_fail() {
  local stage="$1"
  [[ "${TEST_FAIL_STAGE}" != "${stage}" ]] || fail "测试故障注入：${stage}"
}

validate_registered_files() {
  local snapshot_database="$1"
  local data_root="$2"
  local archive_path="$3"
  local mode="$4"
  python3 - "${snapshot_database}" "${data_root}" "${archive_path}" "${mode}" <<'PY'
import hashlib
import os
from pathlib import Path, PurePosixPath
import sqlite3
import stat
import sys
import tarfile
from urllib.parse import quote

snapshot_path = Path(sys.argv[1]).resolve(strict=True)
data_root = Path(sys.argv[2]).resolve(strict=True)
archive_arg = sys.argv[3]
mode = sys.argv[4]
if mode not in {"source", "archive", "source-and-archive"}:
    raise SystemExit(f"未知的作者文件校验模式：{mode}")
check_source = mode in {"source", "source-and-archive"}
check_archive = mode in {"archive", "source-and-archive"}
allowed_roots = {"books", "staging", "archives", "imports"}


def clean_relative_path(raw: object) -> PurePosixPath:
    if not isinstance(raw, str) or not raw or "\\" in raw or "\x00" in raw:
        raise SystemExit("file_registry 存在空路径或非 POSIX 路径")
    path = PurePosixPath(raw)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise SystemExit(f"file_registry 存在越界路径：{raw}")
    if path.parts[0] not in allowed_roots:
        raise SystemExit(f"file_registry 路径未被作者文件归档覆盖：{raw}")
    return path


def sha256_stream(stream: object) -> str:
    digest = hashlib.sha256()
    while True:
        chunk = stream.read(1024 * 1024)
        if not chunk:
            return digest.hexdigest()
        digest.update(chunk)


uri = f"file:{quote(str(snapshot_path), safe='/')}?mode=ro"
connection = sqlite3.connect(uri, uri=True)
try:
    rows = connection.execute(
        """
        SELECT relative_path, size_bytes, lower(content_hash)
        FROM file_registry
        WHERE status IN ('active', 'archived')
        ORDER BY relative_path
        """
    ).fetchall()
finally:
    connection.close()

expected: dict[str, tuple[int, str]] = {}
for raw_path, raw_size, raw_hash in rows:
    relative = clean_relative_path(raw_path)
    size = int(raw_size)
    content_hash = str(raw_hash)
    if size < 0 or len(content_hash) != 64 or any(character not in "0123456789abcdef" for character in content_hash):
        raise SystemExit(f"file_registry 大小或哈希非法：{relative.as_posix()}")
    name = relative.as_posix()
    if name in expected:
        raise SystemExit(f"file_registry 路径重复：{name}")
    expected[name] = (size, content_hash)

if check_source:
    for name, (expected_size, expected_hash) in expected.items():
        source = data_root.joinpath(*PurePosixPath(name).parts)
        lexical = Path(os.path.abspath(source))
        try:
            resolved = source.resolve(strict=True)
        except FileNotFoundError:
            raise SystemExit(f"登记的作者文件不存在：{name}")
        if resolved != lexical or source.is_symlink():
            raise SystemExit(f"登记的作者文件经过符号链接：{name}")
        before = os.stat(source, follow_symlinks=False)
        if not stat.S_ISREG(before.st_mode):
            raise SystemExit(f"登记的作者文件不是普通文件：{name}")
        with source.open("rb") as stream:
            actual_hash = sha256_stream(stream)
        after = os.stat(source, follow_symlinks=False)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ):
            raise SystemExit(f"作者文件在备份期间发生变化：{name}")
        if after.st_size != expected_size or actual_hash != expected_hash:
            raise SystemExit(f"作者文件与数据库登记不一致：{name}")

if check_archive:
    archive_members: dict[str, tarfile.TarInfo] = {}
    with tarfile.open(archive_arg, mode="r:gz") as archive:
        for member in archive.getmembers():
            relative = clean_relative_path(member.name.rstrip("/"))
            name = relative.as_posix()
            if member.issym() or member.islnk():
                raise SystemExit(f"作者文件归档含链接：{name}")
            if not (member.isdir() or member.isreg()):
                raise SystemExit(f"作者文件归档含特殊文件：{name}")
            if member.isreg():
                if name in archive_members:
                    raise SystemExit(f"作者文件归档路径重复：{name}")
                archive_members[name] = member
        for name, (expected_size, expected_hash) in expected.items():
            member = archive_members.get(name)
            if member is None:
                raise SystemExit(f"作者文件归档缺少登记文件：{name}")
            if member.size != expected_size:
                raise SystemExit(f"作者文件归档大小不匹配：{name}")
            stream = archive.extractfile(member)
            if stream is None:
                raise SystemExit(f"作者文件归档无法读取：{name}")
            with stream:
                actual_hash = sha256_stream(stream)
            if actual_hash != expected_hash:
                raise SystemExit(f"作者文件归档哈希不匹配：{name}")

print(f"registered_files_verified={len(expected)} mode={mode}")
PY
}

verify_payload() {
  local set_dir="$1"
  local payload_name
  for payload_name in wenmi.sqlite author-files.tar.gz manifest.txt checksums.sha256; do
    [[ -f "${set_dir}/${payload_name}" && ! -L "${set_dir}/${payload_name}" ]] || return 1
  done
  [[ "$(wc -l < "${set_dir}/checksums.sha256")" == "3" ]] || return 1
  for payload_name in wenmi.sqlite author-files.tar.gz manifest.txt; do
    grep -Eq "^[0-9a-f]{64}  ${payload_name}$" "${set_dir}/checksums.sha256" || return 1
  done
  grep -Fxq 'format=wenmi-backup-set-v2' "${set_dir}/manifest.txt" || return 1
  grep -Fxq "run_id=${RUN_ID}" "${set_dir}/manifest.txt" || return 1
  (
    cd "${set_dir}"
    sha256sum --strict -c checksums.sha256 >/dev/null
  ) || return 1
  [[ "$(sqlite3 -readonly -noheader "${set_dir}/wenmi.sqlite" 'PRAGMA integrity_check;')" == "ok" ]] || return 1
  [[ -z "$(sqlite3 -readonly -noheader "${set_dir}/wenmi.sqlite" 'PRAGMA foreign_key_check;')" ]] || return 1
  tar -tzf "${set_dir}/author-files.tar.gz" >/dev/null || return 1
  validate_registered_files "${set_dir}/wenmi.sqlite" "${DATA_DIR}" \
    "${set_dir}/author-files.tar.gz" archive >/dev/null || return 1
}

verify_complete_marker() {
  local set_dir="$1"
  local expected_run_id="$2"
  local marker="${set_dir}/.complete"
  local checksum_digest
  [[ -f "${marker}" && ! -L "${marker}" ]] || return 1
  [[ "$(wc -l < "${marker}")" == "3" ]] || return 1
  [[ "$(grep -c '^run_id=' "${marker}")" == "1" ]] || return 1
  [[ "$(grep -c '^completed_at=' "${marker}")" == "1" ]] || return 1
  [[ "$(grep -c '^checksums_sha256=' "${marker}")" == "1" ]] || return 1
  grep -Fxq "run_id=${expected_run_id}" "${marker}" || return 1
  grep -Eq '^completed_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "${marker}" || return 1
  checksum_digest="$(sha256sum "${set_dir}/checksums.sha256" | awk '{ print $1 }')"
  grep -Fxq "checksums_sha256=${checksum_digest}" "${marker}" || return 1
}

write_complete_marker() {
  local set_dir="$1"
  local marker_temp="${set_dir}/.complete.next"
  local checksum_digest
  checksum_digest="$(sha256sum "${set_dir}/checksums.sha256" | awk '{ print $1 }')"
  {
    printf 'run_id=%s\n' "${RUN_ID}"
    printf 'completed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'checksums_sha256=%s\n' "${checksum_digest}"
  } > "${marker_temp}"
  chmod 600 "${marker_temp}"
  sync -f "${marker_temp}"
  mv -f "${marker_temp}" "${set_dir}/.complete"
  sync -f "${set_dir}"
}

for required_command in sqlite3 flock sha256sum tar df du stat mktemp mv find awk grep install basename chmod cp date timeout sync wc python3 realpath; do
  command -v "${required_command}" >/dev/null 2>&1 || fail "缺少命令 ${required_command}"
done

[[ -f "${DB_PATH}" ]] || fail "数据库不存在：${DB_PATH}"
[[ "${RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "WENMI_BACKUP_RUN_ID 必须以字母或数字开头，且只能包含安全字符"
require_unsigned_integer WENMI_BACKUP_GLOBAL_TIMEOUT_SECONDS "${GLOBAL_TIMEOUT_SECONDS}"
require_unsigned_integer WENMI_BACKUP_KILL_AFTER_SECONDS "${KILL_AFTER_SECONDS}"
require_unsigned_integer WENMI_BACKUP_MIN_FREE_RESERVE_BYTES "${MIN_FREE_RESERVE_BYTES}"
require_unsigned_integer WENMI_BACKUP_COMMAND_TIMEOUT_SECONDS "${COMMAND_TIMEOUT_SECONDS}"
require_unsigned_integer WENMI_BACKUP_STALE_TEMP_MINUTES "${STALE_TEMP_MINUTES}"
[[ "${DAY_OF_WEEK}" =~ ^[1-7]$ ]] || fail "WENMI_BACKUP_DAY_OF_WEEK 必须是1至7"
[[ "${TEST_MODE}" == "true" || "${TEST_MODE}" == "false" ]] || fail "WENMI_BACKUP_TEST_MODE 只能是 true 或 false"
(( GLOBAL_TIMEOUT_SECONDS >= 60 )) || fail "全局备份超时不能低于60秒"
(( KILL_AFTER_SECONDS >= 1 )) || fail "强制结束等待不能低于1秒"
(( COMMAND_TIMEOUT_SECONDS >= 60 )) || fail "单项备份超时不能低于60秒"
(( COMMAND_TIMEOUT_SECONDS < GLOBAL_TIMEOUT_SECONDS )) || fail "单项备份超时必须小于全局备份超时"
DATA_DIR_CANONICAL="$(realpath -m -- "${DATA_DIR}")"
[[ -d "${DATA_DIR_CANONICAL}" ]] || fail "数据目录不存在：${DATA_DIR_CANONICAL}"
# 调用者可能从仅 admin 可读的工作目录通过 sudo 启动。GNU find 会尝试
# 恢复初始目录并因此误报扫描失败；备份逻辑固定从可读的数据根目录运行。
cd "${DATA_DIR_CANONICAL}"
if (( MIN_FREE_RESERVE_BYTES < PRODUCTION_MIN_FREE_RESERVE_BYTES )); then
  [[ "${TEST_MODE}" == "true" ]] || fail "生产备份完成后必须至少保留5GiB，不能降低 WENMI_BACKUP_MIN_FREE_RESERVE_BYTES"
  case "${DATA_DIR_CANONICAL}" in
    /tmp/*|/var/tmp/*) ;;
    *) fail "降低空间预留只允许在 /tmp 或 /var/tmp 的隔离测试目录中使用" ;;
  esac
fi
if [[ -n "${TEST_FAIL_STAGE}" && "${TEST_MODE}" != "true" ]]; then
  fail "故障注入只允许在明确的隔离测试模式中使用"
fi
[[ "${RETENTION_ENABLED}" != "true" ]] || fail "自动删除仍被安全门禁禁用；请先完成异机副本、恢复演练和删除预览"

install -d -m 700 "${BACKUP_DIR}" "${DAILY_DIR}" "${WEEKLY_DIR}" "${BACKUP_STAGING_DIR}"

LOCK_PATH="${BACKUP_DIR}/.backup.lock"
exec 9>"${LOCK_PATH}"
flock -n 9 || fail "另一次备份仍在运行"

# 只清理锁保护下、隔离暂存区内、超过安全年龄且名称精确匹配的未发布目录。
cleanup_stale_temp_dirs() {
  local prefix="$1"
  local candidate
  for candidate in "${BACKUP_STAGING_DIR}"/"${prefix}"*; do
    [[ -d "${candidate}" && ! -L "${candidate}" ]] || continue
    if find "${candidate}" -maxdepth 0 -mmin "+${STALE_TEMP_MINUTES}" -print -quit | grep -q .; then
      find "${candidate}" -depth -delete
    fi
  done
}
cleanup_stale_temp_dirs '.wenmi-run-'
cleanup_stale_temp_dirs '.wenmi-week-'

archive_names=()
archive_bytes=0
for archive_name in books staging archives imports; do
  archive_path="${DATA_DIR}/${archive_name}"
  if [[ -d "${archive_path}" ]] && find "${archive_path}" -mindepth 1 -print -quit | grep -q .; then
    archive_names+=("${archive_name}")
    current_bytes="$(du -sb "${archive_path}" | awk '{ print $1 }')"
    require_unsigned_integer "目录 ${archive_path} 大小" "${current_bytes}"
    archive_bytes=$((archive_bytes + current_bytes))
  fi
done

db_bytes="$(stat -c '%s' "${DB_PATH}")"
wal_bytes=0
if [[ -f "${DB_PATH}-wal" ]]; then
  wal_bytes="$(stat -c '%s' "${DB_PATH}-wal")"
fi
available_bytes="$(df -PB1 "${BACKUP_DIR}" | awk 'NR == 2 { print $4 }')"
require_unsigned_integer 数据库大小 "${db_bytes}"
require_unsigned_integer WAL大小 "${wal_bytes}"
require_unsigned_integer 可用空间 "${available_bytes}"

# 预留 SQLite 临时空间、WAL 增长、tar 元数据/压缩波动和发布后的最低安全余量。
snapshot_bytes=$((db_bytes * 2 + wal_bytes * 2 + archive_bytes + archive_bytes / 4 + 268435456))
if [[ "${DAY_OF_WEEK}" == "7" ]]; then
  snapshot_bytes=$((snapshot_bytes + db_bytes + archive_bytes + archive_bytes / 4 + 134217728))
fi
required_bytes=$((snapshot_bytes + MIN_FREE_RESERVE_BYTES))
(( available_bytes >= required_bytes ))   || fail "剩余空间不足：可用 ${available_bytes} 字节，完整备份后至少保留 ${MIN_FREE_RESERVE_BYTES} 字节，本次至少需要 ${required_bytes} 字节"

RUN_DIR="${DAILY_DIR}/${RUN_ID}"
WEEK_RUN_DIR="${WEEKLY_DIR}/${RUN_ID}"
[[ ! -e "${RUN_DIR}" ]] || fail "目标备份集已存在，不允许覆盖：${RUN_DIR}"
if [[ "${DAY_OF_WEEK}" == "7" ]]; then
  [[ ! -e "${WEEK_RUN_DIR}" ]] || fail "每周目标备份集已存在，不允许覆盖：${WEEK_RUN_DIR}"
fi

TEMP_DIR="$(mktemp -d "${BACKUP_STAGING_DIR}/.wenmi-run-${RUN_ID}.XXXXXX")"
WEEK_TEMP=""
PUBLISHED_DAILY=""
PUBLISHED_WEEKLY=""
cleanup() {
  if [[ -n "${TEMP_DIR:-}" && -d "${TEMP_DIR}" && ! -L "${TEMP_DIR}" ]]; then
    case "${TEMP_DIR}" in
      "${BACKUP_STAGING_DIR}"/.wenmi-run-*) find "${TEMP_DIR}" -depth -delete 2>/dev/null || true ;;
    esac
  fi
  if [[ -n "${WEEK_TEMP:-}" && -d "${WEEK_TEMP}" && ! -L "${WEEK_TEMP}" ]]; then
    case "${WEEK_TEMP}" in
      "${BACKUP_STAGING_DIR}"/.wenmi-week-*) find "${WEEK_TEMP}" -depth -delete 2>/dev/null || true ;;
    esac
  fi
  if [[ -n "${PUBLISHED_DAILY:-}" && -d "${PUBLISHED_DAILY}" && ! -e "${PUBLISHED_DAILY}/.complete" ]]; then
    [[ "${PUBLISHED_DAILY}" == "${RUN_DIR}" && ! -L "${PUBLISHED_DAILY}" ]] \
      && find "${PUBLISHED_DAILY}" -depth -delete 2>/dev/null || true
  fi
  if [[ -n "${PUBLISHED_WEEKLY:-}" && -d "${PUBLISHED_WEEKLY}" && ! -e "${PUBLISHED_WEEKLY}/.complete" ]]; then
    [[ "${PUBLISHED_WEEKLY}" == "${WEEK_RUN_DIR}" && ! -L "${PUBLISHED_WEEKLY}" ]] \
      && find "${PUBLISHED_WEEKLY}" -depth -delete 2>/dev/null || true
  fi
}
trap cleanup EXIT

DB_TEMP="${TEMP_DIR}/wenmi.sqlite"
FILES_TEMP="${TEMP_DIR}/author-files.tar.gz"
MANIFEST_TEMP="${TEMP_DIR}/manifest.txt"
CHECKSUMS_TEMP="${TEMP_DIR}/checksums.sha256"

[[ "${DB_TEMP}" != *"'"* ]] || fail "备份路径包含不允许的单引号"
log "开始生成数据库一致性副本：${RUN_ID}"
timeout --signal=TERM --kill-after="${KILL_AFTER_SECONDS}s" "${COMMAND_TIMEOUT_SECONDS}s" \
  sqlite3 -cmd '.timeout 30000' "${DB_PATH}" "VACUUM INTO '${DB_TEMP}';"
test_fail after_database

[[ "$(sqlite3 -readonly -noheader "${DB_TEMP}" 'PRAGMA integrity_check;')" == "ok" ]] \
  || fail "数据库备份 integrity_check 未通过"
[[ -z "$(sqlite3 -readonly -noheader "${DB_TEMP}" 'PRAGMA foreign_key_check;')" ]] \
  || fail "数据库备份存在外键异常"
validate_registered_files "${DB_TEMP}" "${DATA_DIR_CANONICAL}" "" source
registered_file_count="$(sqlite3 -readonly -noheader "${DB_TEMP}" \
  "SELECT COUNT(*) FROM file_registry WHERE status IN ('active', 'archived');")"
require_unsigned_integer 登记作者文件数量 "${registered_file_count}"

if (( ${#archive_names[@]} > 0 )); then
  log "开始备份作者原件和附件目录：${archive_names[*]}"
  timeout --signal=TERM --kill-after="${KILL_AFTER_SECONDS}s" "${COMMAND_TIMEOUT_SECONDS}s" \
    tar --one-file-system -czf "${FILES_TEMP}" -C "${DATA_DIR_CANONICAL}" -- "${archive_names[@]}"
  archive_list="$(IFS=,; printf '%s' "${archive_names[*]}")"
else
  log "当前没有作者文件目录，生成可校验的空归档"
  tar -czf "${FILES_TEMP}" --files-from /dev/null
  archive_list="none"
fi
validate_registered_files "${DB_TEMP}" "${DATA_DIR_CANONICAL}" "${FILES_TEMP}" source-and-archive
test_fail after_archive

{
  printf 'format=wenmi-backup-set-v2\n'
  printf 'run_id=%s\n' "${RUN_ID}"
  printf 'run_day=%s\n' "${RUN_DAY}"
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'database=wenmi.sqlite\n'
  printf 'author_files=author-files.tar.gz\n'
  printf 'author_roots=%s\n' "${archive_list}"
  printf 'registered_file_count=%s\n' "${registered_file_count}"
  printf 'database_snapshot=sqlite-vacuum-into\n'
  printf 'author_files_snapshot=database-file-registry-verified-sequential\n'
  printf 'retention=disabled\n'
} > "${MANIFEST_TEMP}"

(
  cd "${TEMP_DIR}"
  sha256sum wenmi.sqlite author-files.tar.gz manifest.txt > checksums.sha256
)
chmod 600 "${DB_TEMP}" "${FILES_TEMP}" "${MANIFEST_TEMP}" "${CHECKSUMS_TEMP}"
verify_payload "${TEMP_DIR}" || fail "临时备份集完整性校验失败"
test_fail before_publish

for payload in "${DB_TEMP}" "${FILES_TEMP}" "${MANIFEST_TEMP}" "${CHECKSUMS_TEMP}"; do
  sync -f "${payload}"
done
sync -f "${TEMP_DIR}"

# 先把无完成标记的目录原子移入 daily，再回读并最后发布完成标记。
mv -T -- "${TEMP_DIR}" "${RUN_DIR}"
TEMP_DIR=""
PUBLISHED_DAILY="${RUN_DIR}"
sync -f "${DAILY_DIR}"
test_fail after_daily_publish
verify_payload "${RUN_DIR}" || fail "发布后的每日备份集回读校验失败：${RUN_DIR}"
write_complete_marker "${RUN_DIR}"
if ! verify_complete_marker "${RUN_DIR}" "${RUN_ID}"; then
  find "${RUN_DIR}" -maxdepth 1 -type f -name '.complete' -delete
  fail "每日备份集完成标记校验失败：${RUN_DIR}"
fi
log "每日完整备份集已发布：${RUN_DIR}"

if [[ "${DAY_OF_WEEK}" == "7" ]]; then
  WEEK_TEMP="$(mktemp -d "${BACKUP_STAGING_DIR}/.wenmi-week-${RUN_ID}.XXXXXX")"
  cp -a "${RUN_DIR}/." "${WEEK_TEMP}/"
  find "${WEEK_TEMP}" -maxdepth 1 -type f -name '.complete' -delete
  verify_payload "${WEEK_TEMP}" || fail "每周临时备份集完整性校验失败"
  for payload_name in wenmi.sqlite author-files.tar.gz manifest.txt checksums.sha256; do
    sync -f "${WEEK_TEMP}/${payload_name}"
  done
  sync -f "${WEEK_TEMP}"
  test_fail before_weekly_publish
  mv -T -- "${WEEK_TEMP}" "${WEEK_RUN_DIR}"
  WEEK_TEMP=""
  PUBLISHED_WEEKLY="${WEEK_RUN_DIR}"
  sync -f "${WEEKLY_DIR}"
  verify_payload "${WEEK_RUN_DIR}" || fail "发布后的每周备份集回读校验失败：${WEEK_RUN_DIR}"
  write_complete_marker "${WEEK_RUN_DIR}"
  if ! verify_complete_marker "${WEEK_RUN_DIR}" "${RUN_ID}"; then
    find "${WEEK_RUN_DIR}" -maxdepth 1 -type f -name '.complete' -delete
    fail "每周备份集完成标记校验失败：${WEEK_RUN_DIR}"
  fi
  log "每周完整备份集已发布：${WEEK_RUN_DIR}"
fi

daily_count="$(find "${DAILY_DIR}" -mindepth 2 -maxdepth 2 -type f -name '.complete' ! -path '*/.*/*' | wc -l | awk '{ print $1 }')"
weekly_count="$(find "${WEEKLY_DIR}" -mindepth 2 -maxdepth 2 -type f -name '.complete' ! -path '*/.*/*' | wc -l | awk '{ print $1 }')"
backup_size="$(du -sh "${RUN_DIR}" | awk '{ print $1 }')"
log "备份完成：${RUN_ID}，完整集 ${backup_size}，登记作者文件 ${registered_file_count} 个，每日 ${daily_count} 份，每周 ${weekly_count} 份；未删除任何历史备份"