# 阶段1：安全入口与能力探针

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- `design_review_id`：`DR-20260719-09`
- 唯一开发者：当前Codex；未调用其他开发Agent
- 结果：通过

## 设计复核与修正

1. 发现 `docs/API.md` 的旧健康响应描述与安全规格冲突：旧文档让 `/health` 返回数据库和模型细节，安全规格要求最小响应。现统一为 `/health` 只返回服务状态、release和时间，详细脱敏能力只从受会话保护的 `/api/v1/capabilities` 返回。
2. 浏览器会话、Worker身份和模型凭证原先边界不完整。现分别使用每次API启动轮换的256位会话秘密、启动器只在进程内传递的独立Worker Token、已有环境变量模型凭证；三者不互换、不写库、不进URL。
3. 能力探测不再把“依赖计划安装”当“当前可用”。SQLite FTS5/JSON、CPU、内存、数据盘、LanceDB/推理依赖和离线资产哈希均返回真实探测结果；当前向量依赖尚未安装时明确降级为不可用。
4. 关闭Fastify原始请求行日志并对未处理异常只记录类型，避免恶意查询串、Cookie、路径或上游原始错误进入日志。

## 实现结果

- 精确 `127.0.0.1:43111` Host、精确Web Origin、Fetch Metadata、JSON写入、CORS凭证和安全响应头。
- `POST /api/v1/runtime/session` 签发 `HttpOnly; SameSite=Strict; Path=/api/v1` 的30分钟Cookie；API重启后旧Cookie失效；SSE不接受URL Token。
- Worker入口要求独立常量时间比较Token；桌面启动器为API和Worker生成同一内存Token，Web永远拿不到该Token。
- Web自动建立会话、携带Cookie并在401时只重建一次会话，不使用localStorage或URL凭证。
- `/api/v1/capabilities` 返回脱敏运行、SQLite、依赖、离线模型资产、套餐模型公开映射和降级原因；设置页显示真实Node/SQLite/FTS5/向量状态。
- 启动脚本增加只供验收使用的 `WENMI_RUNTIME_SMOKE=1` 自检路径，完成API、会话、Worker、能力接口和Web真实三进程验证后自行清理进程。

## 验证证据

- `npm run verify`：三工作区与测试类型检查通过；66个测试文件、139项测试通过；API/Web/Worker生产构建通过。
- 新增安全/能力目标集：7/7通过；覆盖错误Host/Origin、跨站写、非JSON、无Cookie、重启失效、URL Token、Worker错误Token、最小health、哈希资产和脱敏能力响应。
- 隔离空库：应用0001—0009到Schema 9；第二次迁移 `applied: []`。
- 现有数据：连续两次迁移均 `applied: []`、Schema 9；未执行生产恢复、永久删除或旧迁移改写。
- 真实构建产物运行：`WENMI_MODEL_MODE=deterministic WENMI_RUNTIME_SMOKE=1 npm start` 通过；API `43111`、Web `43110`、Worker心跳、HttpOnly会话、Node v24.16.0、SQLite FTS5和能力降级均为真实结果；自检后两端口无残留监听。
- 故障/恢复：会话重启失效、Worker错误Token拒绝、SSE无Cookie拒绝和旧领域/Worker/取消链回归全部通过。
- `git diff --check` 与变更秘密模式扫描通过；未读取、修改、停止或重启 `D:\AI智囊团`。

本阶段只证明安全入口、运行探测和历史功能零退化；向量、离线嵌入和本地工具模型在阶段3安装并通过资产/许可证门禁前仍明确显示不可用。
