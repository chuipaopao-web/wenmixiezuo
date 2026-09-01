# 文秘写作 · 公网部署指南

本文档说明如何将文秘写作部署到香港云服务器：作者官网使用 `wenmixiezuo.com`，独立管理后台使用 `admin.wenmixiezuo.com`。

## 部署架构

```
用户浏览器 (HTTPS)
       │
       ▼
  Caddy 反向代理 (:443)          ← TLS 终止、安全头、请求大小限制
       │
       ├─ /api/*  ──→  API 服务 (127.0.0.1:43111)
       ├─ /health  ──→  API 健康检查
       └─ 其他      ──→  V7组合静态发布 (/opt/wenmi/releases/current)
                              │
                              ▼
                         Worker 服务 (独立进程)
                              │
                              ▼
                         SQLite (WAL 模式) + 不可变文件
```

- **Caddy**：反向代理 + TLS（Let's Encrypt 自动证书）+ 静态文件；限流由应用层 `@fastify/rate-limit` 提供（注册 3/5分钟、登录 10/5分钟、全局 100/分钟），Caddy 配置只使用内置模块，无需 xcaddy 编译插件
- **API**：Fastify 5，监听 `127.0.0.1:43111`，不直接暴露公网
- **Worker**：独立进程，写入运行心跳，并按开关追赶V7正式化outbox；不监听公网端口
- **数据库**：`node:sqlite` 内置 SQLite，WAL 模式，文件存储于 `data/database/`

## 前置条件

### 1. 服务器

- **操作系统**：Ubuntu 24.04 LTS（推荐）或 22.04 LTS
- **CPU**：4 核以上
- **内存**：4 GB 以上（推荐 8 GB）
- **磁盘**：40 GB 以上（系统 + 项目 + 数据库 + 备份）
- **网络**：公网 IP，端口 80 和 443 可访问

### 2. 域名

- 购买 `wenmixiezuo.com`（任意域名注册商）
- 将主域 `wenmixiezuo.com` 的 DNS A 记录指向服务器公网 IP
- 将子域 `admin.wenmixiezuo.com` 的 DNS A 记录指向同一服务器公网 IP
- 等待 DNS 生效（通常 5-30 分钟）

### 3. 软件依赖

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js 24（使用 NodeSource）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# 验证版本
node --version   # 应输出 v24.x.x
npm --version    # 应输出 11.x.x

# 安装 Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

# 安装 SQLite 命令行工具（用于备份）
sudo apt install -y sqlite3

# 安装其他工具
sudo apt install -y git curl unzip build-essential python3 psmisc
```

## 部署步骤

### 第一步：创建系统用户

```bash
sudo useradd -r -m -d /opt/wenmi -s /bin/bash wenmi
sudo usermod -aG wenmi wenmi
```

### 第二步：部署项目代码

```bash
# 克隆仓库（替换为实际仓库地址）
sudo mkdir -p /opt/wenmi
sudo chown wenmi:wenmi /opt/wenmi
sudo -u wenmi git clone https://github.com/chuipaopao-web/wenmixiezuo.git /opt/wenmi

# 或者从本机 rsync 上传
# rsync -avz --exclude 'node_modules' --exclude 'data' \
#   ./ wenmixiezuo.com:/opt/wenmi/
```

### 第三步：安装依赖并构建

```bash
cd /opt/wenmi
sudo -u wenmi npm ci --ignore-scripts
sudo -u wenmi npm run build
```

### 第四步：配置环境变量

```bash
# 复制模板
sudo -u wenmi cp deploy/.env.production.example deploy/.env.production

# 编辑配置，填入真实的 API Key 和模型 ID
sudo -u wenmi nano deploy/.env.production
```

**必须配置的变量：**

| 变量 | 说明 |
|------|------|
| `WENMI_PUBLIC_ORIGIN` | `https://wenmixiezuo.com` |
| `WENMI_ADMIN_ORIGIN` | `https://admin.wenmixiezuo.com` |
| `WENMI_ARK_CODING_PLAN_API_KEY` | 火山方舟 Coding Plan API Key，供除高级编剧外的全部AI岗位使用 |
| `WENMI_ARK_CODING_PLAN_*_MODEL` | Coding Plan 各岗位模型 ID |
| `WENMI_ARK_AGENT_PLAN_API_KEY` | 火山方舟 Agent Plan API Key，供高级编剧 Kimi K3、视觉规划和套餐内 Seedream 封面使用 |
| `WENMI_ARK_IMAGE_API_KEY` | 可选的图像生成专用 API Key；配置后优先于 Agent Plan 凭据 |
| `WENMI_ARK_IMAGE_MODEL_ID` | 可选的图像生成模型 ID；未配置时使用当前默认 Seedream 封面模型 |
| `WENMI_WORKER_TOKEN` | 建议设置固定值（至少 32 字符） |

> 常规创作岗位统一使用 Coding Plan。高级编剧清照固定使用 Agent Plan 的 `kimi-k3`，只有作者主动选择时才调用。封面默认使用 Agent Plan 套餐已包含的 Seedream 权益；如配置 `WENMI_ARK_IMAGE_API_KEY`，则只对封面优先使用该专用凭据。系统不会把 Coding Plan 凭据用于图片，也不会自动切换到合同外的普通按量地址。所有 Key 都只保存在服务器环境变量中，不能进入数据库、日志、任务上下文、备份、导出或 Git。

GLM-5.2 与 GLM-5.3 使用 Coding Plan 共用凭证并登记在后台可配置模型目录，当前不默认绑定任何岗位；无需新增独立密钥。

### 第五步：运行数据库迁移

```bash
cd /opt/wenmi
sudo -u wenmi npm run migrate
```

### 第六步：配置 Caddy

```bash
# 安装 Caddy 配置
sudo cp /opt/wenmi/deploy/Caddyfile /etc/caddy/Caddyfile

# 创建日志目录
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy

# 验证配置
sudo caddy adapt --config /etc/caddy/Caddyfile

# 启动 Caddy
sudo systemctl enable caddy
sudo systemctl restart caddy
```

### 第七步：配置 systemd 服务

```bash
# 安装服务单元文件
sudo cp /opt/wenmi/deploy/wenmi-api.service /etc/systemd/system/
sudo cp /opt/wenmi/deploy/wenmi-worker.service /etc/systemd/system/

# 重新加载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl enable wenmi-api wenmi-worker
sudo systemctl start wenmi-api

# 等待 API 就绪后启动 Worker
sleep 5
sudo systemctl start wenmi-worker
```

V7写后维护由Worker独立追赶时，需要在Worker环境中显式设置`WENMI_V7_FORMALIZATION_ENABLED=true`。启用前确认API内部Worker令牌一致；关闭或重启Worker不会丢失正式化事件，恢复后从SQLite outbox继续。托管写完本链目前只在作者明确点击后由仍在运行的API进程继续，服务重启后不会自动恢复付费模型调用，作者可在任务页核对状态后再次激活。

### 第八步：配置自动备份

```bash
# 冻结脚本先做语法检查；生产安装时还必须与本次发布包 SHA-256 一致。
sudo -u wenmi /usr/bin/bash -n /opt/wenmi/deploy/backup.sh
sudo chown wenmi:wenmi /opt/wenmi/deploy/backup.sh
sudo chmod 640 /opt/wenmi/deploy/backup.sh
sudo sha256sum /opt/wenmi/deploy/backup.sh

# 日志必须位于 wenmi 可写目录。
sudo -u wenmi install -d -m 700 /opt/wenmi/data/logs
sudo -u wenmi touch /opt/wenmi/data/logs/backup.log
sudo -u wenmi chmod 600 /opt/wenmi/data/logs/backup.log

# 幂等替换旧备份 cron，并添加每日凌晨 3 点的真实命令。
(
  sudo -u wenmi crontab -l 2>/dev/null | grep -vF '/opt/wenmi/deploy/backup.sh'
  printf '%s\n' '0 3 * * * /usr/bin/timeout --signal=TERM --kill-after=2m 55m /usr/bin/bash /opt/wenmi/deploy/backup.sh >> /opt/wenmi/data/logs/backup.log 2>&1'
) | sudo -u wenmi crontab -
sudo -u wenmi crontab -l
```

每次运行在 `backups/.staging` 生成唯一暂存集，SQLite 完整性、外键、归档结构和 `file_registry` 中全部 `active/archived` 作者文件的路径、大小、SHA-256 均通过后，先把无标记目录原子移入 `daily`，回读成功后才原子写入 `.complete`。因此日常发现程序只读 `daily/weekly` 的非隐藏一级目录并要求标记有效，不扫描 `.staging`。同日运行不会覆盖早先恢复点；周日按服务器本地时区复制同一套完整内容。

脚本内部全局上限为 50 分钟，外层再以 55 分钟和 `--kill-after=2m` 兜底。备份完成后必须至少保留 5 GiB；生产脚本会硬拒绝更低值，只有 `WENMI_BACKUP_TEST_MODE=true` 且数据目录位于 `/tmp` 或 `/var/tmp` 时才能降低。脚本不自动删除任何历史备份；异机副本、恢复演练、最小保留套数和删除预览没有独立验收前，即使设置旧的 retention 环境变量也会拒绝运行。

上线后要实际手动运行一次，并核对脚本 SHA、`backup.log`、完整集权限（目录 `700`、文件 `600`）、三项 payload SHA-256、marker 中的 run ID/校验文件哈希和 `.complete` 发现范围。下一次 03:00 后再次核对新鲜度；“最新完整集超过 26 小时”必须进入自动运维告警，不能只依赖人工查看。第二物理介质或异机副本和实际恢复演练完成前，本机备份只能算部署回滚点，不能宣称具备灾难恢复能力。

### 第九步：验证部署

```bash
# 检查 Caddy 状态
sudo systemctl status caddy

# 检查 API 状态
sudo systemctl status wenmi-api
curl -s http://127.0.0.1:43111/health | python3 -m json.tool

# 检查 Worker 状态
sudo systemctl status wenmi-worker

# 检查 HTTPS 访问
curl -s https://wenmixiezuo.com/health | python3 -m json.tool
curl -s https://admin.wenmixiezuo.com/health | python3 -m json.tool
```

## 日常运维

### 查看日志

```bash
# API 日志
sudo journalctl -u wenmi-api -f -n 100

# Worker 日志
sudo journalctl -u wenmi-worker -f -n 100

# Caddy 访问日志
sudo tail -f /var/log/caddy/wenmi-access.log

# 备份日志
sudo tail -f /opt/wenmi/data/logs/backup.log
```

### 重启服务

```bash
# 先停 Worker（等待当前任务完成）
sudo systemctl stop wenmi-worker
# 再停 API
sudo systemctl stop wenmi-api
# 启动 API
sudo systemctl start wenmi-api
# 再启动 Worker
sleep 5
sudo systemctl start wenmi-worker
```

### 更新部署

服务器在线目录不含`.git`。所有构建先在公网不可见的 `/opt/wenmi-releases/<commit>` 完成，在线目录只做经过验证的原子切换。

#### Web-only（不改API、Worker、迁移）

1. 本机运行相关Web测试、Web类型检查/构建和文档检查；提交后用LF归档上传暂存目录。
2. 运行 `npm run build:v7:static-release`，再运行 `npm run verify:v7:static-release`；作者端位于组合包根，独立后台位于 `/v7/`。
3. 把已校验的内容目录上传到 `/opt/wenmi/releases/versions/<release-id>`，不得覆盖当前版本目录。
4. 在服务器执行 `sudo -u wenmi /opt/wenmi/current/deploy/activate-v7-static.sh <release-id>`。脚本再次核验清单，原子切换 `current`，并保留 `previous` 指针。
5. 验证主站、后台、深链接、登录和目标页面。失败时用同一命令激活 `previous` 指向的 releaseId。Web-only 不重启API/Worker、不改数据库，因此不等待在途任务清零。

#### API / Worker / 数据迁移

1. 本机按 `docs/DEVELOPMENT_WORKFLOW.md` 的风险门槛运行受影响测试、类型检查和构建；只有数据库迁移、权限或账号隔离、跨服务恢复、核心创作工作流结构变化，或老板明确要求时才运行完整 `npm run verify:full`。使用 `git -c core.autocrlf=false -c core.eol=lf archive` 生成发布包。
2. 在唯一暂存目录完成受影响服务构建和迁移预检；迁移只向后兼容，已合并迁移字节变化立即停止。
3. 正式迁移前备份数据库。查询 `tasks`，`working`、`queued`、`pending`、`waiting_confirmation` 连续30秒为0，并在每次重启前立即复核；只等待，不取消/暂停/改写作者任务。
4. 逐个原子切换并重启受影响服务，每一步检查active、日志、健康和任务恢复；失败立即回滚，不继续扩大。
5. API、Worker 和 V7 静态包必须来自同一冻结源码；重建后再通过版本目录切换Web，验证登录、会员、书籍隔离和核心链路。旧版本目录保留到验收结束。

暂存、备份和切换路径带提交号，不复用未核验旧目录。发布命令逐步执行并逐步看结果。

#### 当前自动发布通道

- 生产运维账号为 `admin@wenmixiezuo.com`，通过受限公钥登录后使用 `sudo` 完成发布；服务器不依赖 GitHub 拉取。
- 本机部署私钥路径为 `C:\Users\MSIK\.ssh\wenmi-prod-20260824-ed25519`。私钥内容不得进入命令输出、Git、发布包、日志、数据库、备份或任何审计清单；只允许 SSH 客户端在本机读取。
- 每次发布都从已提交且通过门禁的本地源码生成 LF 归档，上传到新的 `/opt/wenmi-releases/<release-id>`，先在公网不可见目录预检，再按在途任务、备份和逐服务切换门禁上线。
- 自动通道可替老板完成常规零现金发布；若公钥失效、需要新登录/新密钥、生产恢复或永久删除作者数据，仍按安全门禁停止。

### 手动备份

```bash
sudo -u wenmi /usr/bin/timeout --signal=TERM --kill-after=2m 55m \
  /usr/bin/bash /opt/wenmi/deploy/backup.sh

# 只发现 daily 下非隐藏的一级目录；.staging 和无 .complete 目录永不进入恢复清单。
sudo -u wenmi find /opt/wenmi/data/backups/daily \
  -mindepth 1 -maxdepth 1 -type d ! -name '.*' \
  -exec test -f '{}/.complete' ';' -printf '%T@ %p\n' | sort -nr
```

### 恢复备份

生产恢复会覆盖当前状态，必须先完成影响预览、确认在途任务为零，并取得本次明确恢复授权。以下命令必须作为一个完整 Bash 块执行；它先验证唯一备份目录、marker、三项 payload 校验和、完整数据库和归档安全，再只把作者文件解压到隔离区。只有数据库会在授权步骤被替换；`books/staging/archives/imports` 不会自动覆盖。任一步失败时，如果服务已经停止，脚本会在数据库已替换时先回滚到本次 `before-restore` 副本，再尝试恢复原 API/Worker；自动回滚失败时保持服务停止并要求人工处理。

```bash
# 先填写从“手动备份”清单中人工核对过的唯一目录名，再整块执行。
BACKUP_RUN=YYYYMMDDTHHMMSSZ-PID
set -Eeuo pipefail

[[ "${BACKUP_RUN}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || {
  echo "BACKUP_RUN 含有不安全字符" >&2
  exit 64
}
BACKUP_BASE=/opt/wenmi/data/backups/daily
BACKUP_BASE_REAL="$(sudo -u wenmi realpath -e -- "${BACKUP_BASE}")"
BACKUP_SET_INPUT="${BACKUP_BASE}/${BACKUP_RUN}"
sudo -u wenmi test -d "${BACKUP_SET_INPUT}"
sudo -u wenmi test ! -L "${BACKUP_SET_INPUT}"
BACKUP_SET="$(sudo -u wenmi realpath -e -- "${BACKUP_SET_INPUT}")"
[[ "${BACKUP_SET}" == "${BACKUP_BASE_REAL}/${BACKUP_RUN}" ]] || {
  echo "备份目录不是真实 daily 一级目录" >&2
  exit 65
}

MARKER="${BACKUP_SET}/.complete"
for payload in .complete wenmi.sqlite author-files.tar.gz manifest.txt checksums.sha256; do
  sudo -u wenmi test -f "${BACKUP_SET}/${payload}"
  sudo -u wenmi test ! -L "${BACKUP_SET}/${payload}"
done
sudo -u wenmi test "$(sudo -u wenmi wc -l < "${MARKER}")" = 3
sudo -u wenmi test "$(sudo -u wenmi grep -c '^run_id=' "${MARKER}")" = 1
sudo -u wenmi test "$(sudo -u wenmi grep -c '^completed_at=' "${MARKER}")" = 1
sudo -u wenmi test "$(sudo -u wenmi grep -c '^checksums_sha256=' "${MARKER}")" = 1
sudo -u wenmi grep -Fxq "run_id=${BACKUP_RUN}" "${MARKER}"
sudo -u wenmi grep -Eq '^completed_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "${MARKER}"
CHECKSUMS_HASH="$(sudo -u wenmi sha256sum "${BACKUP_SET}/checksums.sha256" | sudo -u wenmi awk '{ print $1 }')"
sudo -u wenmi grep -Fxq "checksums_sha256=${CHECKSUMS_HASH}" "${MARKER}"

sudo -u wenmi test "$(sudo -u wenmi wc -l < "${BACKUP_SET}/checksums.sha256")" = 3
for payload in wenmi.sqlite author-files.tar.gz manifest.txt; do
  sudo -u wenmi grep -Eq "^[0-9a-f]{64}  ${payload}$" "${BACKUP_SET}/checksums.sha256"
done
sudo -u wenmi bash -c 'cd "$1" && sha256sum --strict -c checksums.sha256' _ "${BACKUP_SET}"
sudo -u wenmi grep -Fxq 'format=wenmi-backup-set-v2' "${BACKUP_SET}/manifest.txt"
sudo -u wenmi grep -Fxq "run_id=${BACKUP_RUN}" "${BACKUP_SET}/manifest.txt"
sudo -u wenmi test "$(sudo -u wenmi sqlite3 -readonly -noheader "${BACKUP_SET}/wenmi.sqlite" 'PRAGMA integrity_check;')" = ok
sudo -u wenmi test -z "$(sudo -u wenmi sqlite3 -readonly -noheader "${BACKUP_SET}/wenmi.sqlite" 'PRAGMA foreign_key_check;')"

# 只检查归档成员，不解压：拒绝绝对路径、..、反斜杠、符号/硬链接和特殊文件。
sudo -u wenmi python3 - "${BACKUP_SET}/author-files.tar.gz" <<'PY'
from pathlib import PurePosixPath
import sys
import tarfile

allowed_roots = {"books", "staging", "archives", "imports"}
with tarfile.open(sys.argv[1], mode="r:gz") as archive:
    for member in archive.getmembers():
        raw = member.name.rstrip("/")
        if not raw or "\\" in raw or "\x00" in raw:
            raise SystemExit("归档含空路径或非 POSIX 路径")
        path = PurePosixPath(raw)
        if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
            raise SystemExit(f"归档含越界路径：{raw}")
        if path.parts[0] not in allowed_roots:
            raise SystemExit(f"归档含合同外根目录：{raw}")
        if member.issym() or member.islnk():
            raise SystemExit(f"归档含链接：{raw}")
        if not (member.isdir() or member.isreg()):
            raise SystemExit(f"归档含特殊文件：{raw}")
print("archive_members_safe=true")
PY

# 创建不可复用的隔离恢复目录；mktemp 保证重跑不会覆盖旧目录。
RESTORE_BASE=/opt/wenmi/data/restore-staging
sudo -u wenmi install -d -m 700 "${RESTORE_BASE}"
RESTORE_ROOT="$(sudo -u wenmi mktemp -d "${RESTORE_BASE}/restore-${BACKUP_RUN}.XXXXXXXX")"
RESTORE_FILES="${RESTORE_ROOT}/files"
sudo -u wenmi install -d -m 700 "${RESTORE_FILES}"
sudo -u wenmi install -m 600 "${BACKUP_SET}/wenmi.sqlite" "${RESTORE_ROOT}/wenmi.sqlite"
sudo -u wenmi tar --extract --gzip --file="${BACKUP_SET}/author-files.tar.gz" \
  --directory="${RESTORE_FILES}" --no-same-owner --no-same-permissions
sudo -u wenmi bash -c 'cd "$1" && sha256sum --strict -c checksums.sha256' _ "${BACKUP_SET}"
sudo -u wenmi test "$(sudo -u wenmi sqlite3 -readonly -noheader "${RESTORE_ROOT}/wenmi.sqlite" 'PRAGMA integrity_check;')" = ok
sudo -u wenmi test -z "$(sudo -u wenmi sqlite3 -readonly -noheader "${RESTORE_ROOT}/wenmi.sqlite" 'PRAGMA foreign_key_check;')"

# 用恢复数据库的 file_registry 再核对解压后的 active/archived 作者文件。
sudo -u wenmi python3 - "${RESTORE_ROOT}/wenmi.sqlite" "${RESTORE_FILES}" <<'PY'
import hashlib
import os
from pathlib import Path, PurePosixPath
import sqlite3
import stat
import sys

snapshot = Path(sys.argv[1]).resolve(strict=True)
files_root = Path(sys.argv[2]).resolve(strict=True)
allowed_roots = {"books", "staging", "archives", "imports"}
connection = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
try:
    rows = connection.execute(
        "SELECT relative_path,size_bytes,lower(content_hash) FROM file_registry "
        "WHERE status IN ('active','archived') ORDER BY relative_path"
    ).fetchall()
finally:
    connection.close()
for raw, expected_size, expected_hash in rows:
    if not isinstance(raw, str) or not raw or "\\" in raw or "\x00" in raw:
        raise SystemExit("file_registry 路径非法")
    relative = PurePosixPath(raw)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise SystemExit(f"file_registry 路径越界：{raw}")
    if relative.parts[0] not in allowed_roots:
        raise SystemExit(f"file_registry 根目录未归档：{raw}")
    target = files_root.joinpath(*relative.parts)
    lexical = Path(os.path.abspath(target))
    resolved = target.resolve(strict=True)
    metadata = os.stat(target, follow_symlinks=False)
    if resolved != lexical or target.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        raise SystemExit(f"恢复文件不是隔离目录内普通文件：{raw}")
    digest = hashlib.sha256()
    with target.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    if metadata.st_size != int(expected_size) or digest.hexdigest() != str(expected_hash):
        raise SystemExit(f"恢复文件大小或哈希不匹配：{raw}")
print(f"restored_registered_files_verified={len(rows)}")
PY

DATABASE_DIR=/opt/wenmi/data/database
DATABASE="${DATABASE_DIR}/wenmi.sqlite"
SERVICES_STOPPED=0
DATABASE_REPLACED=0
BEFORE_DIR=""
DATABASE_NEXT=""

rollback_database() {
  local rollback_next
  rollback_next="$(sudo -u wenmi mktemp "${DATABASE_DIR}/.rollback-next.XXXXXXXX")" || return 1
  sudo -u wenmi install -m 600 "${BEFORE_DIR}/wenmi.sqlite" "${rollback_next}" || return 1
  sudo -u wenmi sync -f "${rollback_next}" || return 1
  sudo -u wenmi find "${DATABASE_DIR}" -maxdepth 1 -type f \
    \( -name 'wenmi.sqlite-wal' -o -name 'wenmi.sqlite-shm' \) -delete || return 1
  sudo -u wenmi mv -Tf "${rollback_next}" "${DATABASE}" || return 1
  for suffix in -wal -shm; do
    if sudo -u wenmi test -f "${BEFORE_DIR}/wenmi.sqlite${suffix}"; then
      sudo -u wenmi install -m 600 "${BEFORE_DIR}/wenmi.sqlite${suffix}" "${DATABASE}${suffix}" || return 1
    fi
  done
  sudo -u wenmi sync -f "${DATABASE_DIR}" || return 1
}

on_restore_exit() {
  local exit_code=$?
  local rollback_ok=1
  trap - EXIT
  if [[ "${exit_code}" != "0" && "${SERVICES_STOPPED}" == "1" ]]; then
    set +e
    sudo systemctl stop wenmi-worker wenmi-api || rollback_ok=0
    if sudo fuser -v "${DATABASE}" "${DATABASE}-wal" "${DATABASE}-shm"; then
      rollback_ok=0
    fi
    if [[ -n "${DATABASE_NEXT}" ]]; then
      sudo -u wenmi test ! -e "${DATABASE_NEXT}" || sudo -u wenmi find "${DATABASE_NEXT}" -maxdepth 0 -type f -delete
    fi
    if [[ "${DATABASE_REPLACED}" == "1" && "${rollback_ok}" == "1" ]]; then
      rollback_database || rollback_ok=0
    fi
    if [[ "${rollback_ok}" == "1" ]]; then
      sudo systemctl start wenmi-api
      sleep 5
      sudo systemctl start wenmi-worker
      echo "恢复失败，已回滚数据库并尝试恢复原服务。" >&2
    else
      echo "恢复失败且自动回滚未通过；服务保持停止，必须人工处理。" >&2
    fi
  fi
  exit "${exit_code}"
}
trap on_restore_exit EXIT

# 到这里才停服。先停 Worker，再停 API，并确认主库没有活动句柄。
SERVICES_STOPPED=1
sudo systemctl stop wenmi-worker
sudo systemctl stop wenmi-api
if sudo fuser -v "${DATABASE}" "${DATABASE}-wal" "${DATABASE}-shm"; then
  echo "数据库仍有活动句柄，停止恢复并先查明进程。" >&2
  exit 1
fi

# mktemp 创建唯一 before-restore 目录；逐文件复制、比对字节与 SHA-256，再检查完整库。
BEFORE_DIR="$(sudo -u wenmi mktemp -d "${DATABASE_DIR}/before-restore-${BACKUP_RUN}.XXXXXXXX")"
for source in "${DATABASE}" "${DATABASE}-wal" "${DATABASE}-shm"; do
  if sudo -u wenmi test -f "${source}"; then
    destination="${BEFORE_DIR}/$(basename "${source}")"
    sudo -u wenmi install -m 600 "${source}" "${destination}"
    sudo -u wenmi cmp -s "${source}" "${destination}"
    source_hash="$(sudo -u wenmi sha256sum "${source}" | sudo -u wenmi awk '{ print $1 }')"
    copied_hash="$(sudo -u wenmi sha256sum "${destination}" | sudo -u wenmi awk '{ print $1 }')"
    [[ "${source_hash}" == "${copied_hash}" ]]
  fi
done
sudo -u wenmi test "$(sudo -u wenmi sqlite3 -readonly -noheader "${BEFORE_DIR}/wenmi.sqlite" 'PRAGMA integrity_check;')" = ok
sudo -u wenmi test -z "$(sudo -u wenmi sqlite3 -readonly -noheader "${BEFORE_DIR}/wenmi.sqlite" 'PRAGMA foreign_key_check;')"

# 只有取得本次恢复授权后才替换数据库；旧 WAL/SHM 已在唯一 before-restore 目录中保留。
DATABASE_NEXT="$(sudo -u wenmi mktemp "${DATABASE_DIR}/.restore-next.XXXXXXXX")"
sudo -u wenmi install -m 600 "${RESTORE_ROOT}/wenmi.sqlite" "${DATABASE_NEXT}"
sudo -u wenmi sync -f "${DATABASE_NEXT}"
sudo -u wenmi find "${DATABASE_DIR}" -maxdepth 1 -type f \
  \( -name 'wenmi.sqlite-wal' -o -name 'wenmi.sqlite-shm' \) -delete
sudo -u wenmi mv -Tf "${DATABASE_NEXT}" "${DATABASE}"
DATABASE_NEXT=""
DATABASE_REPLACED=1
sudo -u wenmi sync -f "${DATABASE_DIR}"
sudo -u wenmi test "$(sudo -u wenmi sqlite3 -readonly -noheader "${DATABASE}" 'PRAGMA integrity_check;')" = ok
sudo -u wenmi test -z "$(sudo -u wenmi sqlite3 -readonly -noheader "${DATABASE}" 'PRAGMA foreign_key_check;')"

# 作者文件仍只在 RESTORE_ROOT/files。任何上线目录覆盖/删除需同一次授权和单独影响预览。
sudo systemctl start wenmi-api
sleep 5
sudo systemctl is-active --quiet wenmi-api
sudo systemctl start wenmi-worker
sudo systemctl is-active --quiet wenmi-worker
curl -fsS http://127.0.0.1:43111/health | python3 -m json.tool
SERVICES_STOPPED=0
printf 'restore_database=passed\nrestore_staging=%s\nbefore_restore=%s\n' "${RESTORE_ROOT}" "${BEFORE_DIR}"
```
## 安全清单

部署完成后，逐项确认以下安全检查：

- [ ] 作者官网 HTTPS 正常（`curl -I https://wenmixiezuo.com` 返回 200）
- [ ] 独立后台 HTTPS 正常（`curl -I https://admin.wenmixiezuo.com` 返回 200）
- [ ] 主域只显示作者创作台，后台子域只显示管理登录/工作台
- [ ] HTTP 自动跳转到 HTTPS
- [ ] API 端口 `43111` 不对外暴露（`curl http://服务器公网IP:43111/health` 不可达）
- [ ] 注册接口限流生效（短时间内连续注册 3 次后被拒绝）
- [ ] 登录接口限流生效
- [ ] Cookie 设置了 `HttpOnly`、`SameSite=Lax`、`Secure`
- [ ] 安全响应头存在（`X-Content-Type-Options`、`X-Frame-Options` 等）
- [ ] 错误信息不泄露内部路径或密钥
- [ ] `.env.production` 文件权限为 `600`（`ls -la /opt/wenmi/deploy/.env.production`）
- [ ] 备份脚本已加入 cron 且正常执行
- [ ] 第二物理备份已配置（不同磁盘或远程存储）

## 成本估算

| 项目 | 月费（美元） | 年费（美元） |
|------|-------------|-------------|
| 香港云服务器（4C8G） | ~$25-40 | ~$300-480 |
| 域名 wenmixiezuo.com | ~$1-2 | ~$12-15 |
| Let's Encrypt 证书 | 免费 | 免费 |
| 火山方舟模型 API | 按量计费 | 取决于创作量 |
| **合计（不含模型）** | **~$26-42** | **~$312-495** |

模型 API 费用取决于实际使用量。每章正文（约 3,000-5,000 字）的模型调用费用约为 ¥0.5-3.0 人民币，包含设定、规划、正文、审查和点评的全流程。

## 故障排查

### Caddy 启动失败

```bash
# 检查端口占用
sudo ss -tlnp | grep -E ':80|:443'

# 检查配置语法
sudo caddy adapt --config /etc/caddy/Caddyfile

# 查看 Caddy 日志
sudo journalctl -u caddy -n 50
```

### API 启动失败

```bash
# 查看 API 日志
sudo journalctl -u wenmi-api -n 50

# 手动运行测试
cd /opt/wenmi
sudo -u wenmi node apps/api/dist/main.js
```

### Worker 无法连接 API

```bash
# 确认 API 已启动
curl -s http://127.0.0.1:43111/health

# 确认 Worker Token 一致
# API 启动时从环境变量读取 WENMI_WORKER_TOKEN
# Worker 启动时从同一环境变量文件读取
```

### HTTPS 证书问题

Let's Encrypt 证书在 Caddy 启动时自动申请和续期。如果证书申请失败：

```bash
# 确认域名 DNS 已指向服务器 IP
dig wenmixiezuo.com +short
dig admin.wenmixiezuo.com +short

# 确认端口 80 可公网访问
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```
