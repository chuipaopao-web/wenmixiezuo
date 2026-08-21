# 文秘写作 · 部署文件

本目录包含公网部署所需的所有基础设施文件。

## 文件清单

| 文件 | 用途 | 部署路径 |
|------|------|----------|
| `Caddyfile` | 作者主站与 `admin.wenmixiezuo.com` 管理子域的TLS、同源API代理和静态文件配置 | `/etc/caddy/Caddyfile` |
| `wenmi-api.service` | API systemd 服务单元 | `/etc/systemd/system/` |
| `wenmi-worker.service` | Worker systemd 服务单元 | `/etc/systemd/system/` |
| `backup.sh` | SQLite 数据库自动备份脚本 | `/opt/wenmi/deploy/backup.sh` |
| `.env.production.example` | 生产环境变量模板 | 复制为 `deploy/.env.production` 并填入真实值 |

## 部署步骤

完整部署步骤见 [docs/DEPLOY.md](../docs/DEPLOY.md)。

## 注意事项

- `.env.production` 包含模型 API Key，**切勿提交到 Git 仓库**
- 部署前将 `.env.production.example` 复制为 `.env.production` 并填入真实凭证
- 所有文件都已适配 Ubuntu 24.04 LTS，其他发行版可能需要调整路径