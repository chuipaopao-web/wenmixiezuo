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
       └─ 其他      ──→  静态文件 (apps/web/dist)
                              │
                              ▼
                         Worker 服务 (独立进程)
                              │
                              ▼
                         SQLite (WAL 模式)
                         LanceDB (向量检索)
```

- **Caddy**：反向代理 + TLS（Let's Encrypt 自动证书）+ 静态文件；限流由应用层 `@fastify/rate-limit` 提供（注册 3/5分钟、登录 10/5分钟、全局 100/分钟），Caddy 配置只使用内置模块，无需 xcaddy 编译插件
- **API**：Fastify 5，监听 `127.0.0.1:43111`，不直接暴露公网
- **Worker**：独立进程，监听 `127.0.0.1:43111` 内部端点，执行模型任务
- **数据库**：`node:sqlite` 内置 SQLite，WAL 模式，文件存储于 `data/database/`

## 前置条件

### 1. 服务器

- **操作系统**：Ubuntu 24.04 LTS（推荐）或 22.04 LTS
- **CPU**：4 核以上（LanceDB 向量索引需要）
- **内存**：4 GB 以上（推荐 8 GB，模型推理时 `@huggingface/transformers` 需要）
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
sudo apt install -y git curl unzip build-essential
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
| `WENMI_ARK_AGENT_PLAN_API_KEY` | 火山方舟 Agent Plan API Key，只供高级编剧 Kimi K3 使用 |
| `WENMI_WORKER_TOKEN` | 建议设置固定值（至少 32 字符） |

> 常规创作岗位统一使用 Coding Plan。高级编剧清照固定使用 Agent Plan 的 `kimi-k3`，只有作者主动选择时才调用；未配置 Agent Plan 时仅该席位不可用。两类 Key 都只保存在服务器环境变量中，不能进入数据库、日志、任务上下文、备份、导出或 Git。

GLM-5.2 与 GLM-5.3 使用 Coding Plan 共用凭证并登记在后台可配置模型目录，当前不默认绑定任何岗位；无需新增独立密钥。

### 第五步：运行数据库迁移

```bash
cd /opt/wenmi
sudo -u wenmi npm run migrate
```

### 第六步：安装本地嵌入模型（可选但推荐）

```bash
cd /opt/wenmi
sudo -u wenmi npm run models:install
```

### 第七步：配置 Caddy

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

### 第八步：配置 systemd 服务

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

### 第九步：配置自动备份

```bash
# 确保备份脚本可执行
sudo chmod +x /opt/wenmi/deploy/backup.sh

# 添加 cron 定时任务（每日凌晨 3 点）
sudo -u wenmi crontab -e
# 添加以下行：
# 0 3 * * * /opt/wenmi/deploy/backup.sh >> /var/log/wenmi-backup.log 2>&1
```

### 第十步：验证部署

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
sudo tail -f /var/log/wenmi-backup.log
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
2. 在暂存目录构建Web，验证入口和哈希资源；不得先覆盖当前在线 `apps/web/dist`。
3. 把新哈希JS/CSS作为新增资源放入在线静态目录，保留旧哈希资源；备份旧`index.html`后原子替换入口。
4. 验证首页、新资源、登录、目标页面和旧入口回滚。此流程不重启API/Worker、不改数据库，因此不等待在途任务清零。

#### API / Worker / 数据迁移

1. 本机按 `docs/DEVELOPMENT_WORKFLOW.md` 的风险门槛运行受影响测试、类型检查和构建；只有数据库迁移、权限或账号隔离、跨服务恢复、核心创作工作流结构变化，或老板明确要求时才运行完整 `npm run verify:full`。使用 `git -c core.autocrlf=false -c core.eol=lf archive` 生成发布包。
2. 在唯一暂存目录完成受影响服务构建和迁移预检；迁移只向后兼容，已合并迁移字节变化立即停止。
3. 正式迁移前备份数据库。查询 `tasks`，`working`、`queued`、`pending`、`waiting_confirmation` 连续30秒为0，并在每次重启前立即复核；只等待，不取消/暂停/改写作者任务。
4. 逐个原子切换并重启受影响服务，每一步检查active、日志、健康和任务恢复；失败立即回滚，不继续扩大。
5. 最后切换需要更新的Web入口，验证旧缓存兼容、登录、书籍隔离和核心链路。旧构建保留到验收结束。

暂存、备份和切换路径带提交号，不复用未核验旧目录。发布命令逐步执行并逐步看结果。

### 手动备份

```bash
sudo -u wenmi /opt/wenmi/deploy/backup.sh
```

### 恢复备份

```bash
# 1. 停止服务
sudo systemctl stop wenmi-worker wenmi-api

# 2. 校验备份文件
sha256sum -c /opt/wenmi/data/backups/daily/wenmi-YYYYMMDD.sqlite.sha256

# 3. 替换数据库
sudo -u wenmi cp /opt/wenmi/data/database/wenmi.sqlite \
  /opt/wenmi/data/database/wenmi.sqlite.before-restore
sudo -u wenmi cp /opt/wenmi/data/backups/daily/wenmi-YYYYMMDD.sqlite \
  /opt/wenmi/data/database/wenmi.sqlite

# 4. 恢复文件
sudo -u wenmi tar -xzf /opt/wenmi/data/backups/daily/wenmi-files-YYYYMMDD.tar.gz \
  -C /opt/wenmi/data/

# 5. 启动服务
sudo systemctl start wenmi-api
sleep 5
sudo systemctl start wenmi-worker

# 6. 验证健康检查
curl -s http://127.0.0.1:43111/health | python3 -m json.tool
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