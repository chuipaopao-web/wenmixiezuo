# 阶段1：项目与契约底座验收记录

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- 目标：建立独立三应用、公共契约、SQLite迁移器、确定性假模型、统一启动器与质量门禁。
- 不做什么：不实现小说业务领域；不接入真实付费模型；不触碰 `D:\AI智囊团`。
- 唯一写负责人：当前Codex。
- 允许文件：根工程配置、`scripts/`、`apps/web`、`apps/api`、`apps/worker`、`tests/foundation`、当前发布文档。
- 禁止文件：`D:\AI智囊团`、项目外目录、三个来源快照。
- 依赖：Node `24.16.0`、npm `11.13.0`、TypeScript `7.0.2`、Vite `8.1.5`、React `19.2.7`、Fastify `5.10.0`、Vitest `4.1.10`。
- 实现约束：Web/API只监听 `127.0.0.1`；API Key不落盘；运行数据只写被Git忽略的 `data`；Worker只写健康记录。
- 验收标准：三个应用可构建和统一启动；空库、重复与失败迁移安全；假模型确定且现金成本为0；发布、API与Schema可追溯。
- 测试命令：`npm run typecheck`、`npm test`、`npm run build`、两次 `npm run migrate`、`npm start` 后查询健康/Worker/Web。
- 失败停止条件：项目外写入、密钥落盘、非本机监听、迁移不可回滚或需要现金费用。
- 回滚方法：未提交工程文件可删除；已执行数据库只允许向前修复迁移；已提交内容使用后续修复提交。
- 独立复核人：当前Codex使用独立全量命令和真实启动探测复核。

## 实现摘要

- npm workspace锁定API、Worker和Web三个独立应用及确切依赖版本。
- 公共契约包含成功/错误响应、事件信封、ID、时间与标准错误码。
- SQLite启用WAL、外键、`synchronous=FULL`、`busy_timeout` 和迁移校验和保护。
- 确定性假模型相同输入返回相同输出、支持取消且现金成本恒为0。
- API提供 `/health`、`/api/v1/runtime/readiness` 和真实Worker心跳查询。
- 统一启动器先等待API健康，再启动Worker和Web；任一进程异常会收口本次进程树。
- SQLite发布任务账本位于 `data/control/release-ledger.sqlite`，包含阶段0至8的完整任务约束。

## 验收证据

| 门禁 | 命令/检查 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | API、Web、Worker与测试类型全部通过 |
| 自动测试 | `npm test` | 6个测试文件、12项测试全部通过 |
| 构建 | `npm run build` | API、Worker TypeScript和Web Vite生产构建通过 |
| 空库迁移 | 首次 `npm run migrate` | 应用 `0001_foundation.sql`，版本1 |
| 重复迁移 | 第二次 `npm run migrate` | 应用列表为空，版本仍为1 |
| 失败回滚 | `migration.test.ts` | 失败DDL无残表、无迁移登记 |
| 迁移防篡改 | `migration.test.ts` | 已执行SQL校验和变化被拒绝 |
| 本地运行 | 生产构建后 `npm start` | API `ok`、Worker `ready`、Web HTTP 200 |
| 监听门禁 | `Get-NetTCPConnection` | `43110`、`43111` 均仅监听 `127.0.0.1` |
| 假模型 | `mock-model.test.ts` | 确定输出、真实取消、现金费用0 |
| 数据边界 | `git status --ignored` 与 `.gitignore` | `data/` 不进入Git，未创建智囊团依赖 |

## 故障与修复记录

- 首次类型检查发现可选 `AbortSignal` 与严格可选属性不兼容；根因是显式传递 `undefined`，改为省略属性后全量通过。
- 首次真实启动发现Windows下直接生成 `npm.cmd` 返回 `EINVAL`；改为当前Node直接执行锁定的Vite CLI。
- 第二次启动发现Vite预览根目录仍指向项目根；显式传入 `apps/web` 后三进程真实启动通过。

## 风险与下一阶段

- 当前数据库仅含发布、事件和Worker健康基础表，尚未承载业务数据。
- 第二物理备份仍未配置，不能防止本机硬盘损坏。
- 阶段2将先建立Repository自动隔离与不可变文件安全，再允许Worker接触创作暂存结果。

