# 长篇终局增量设计冻结记录

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`（预留，尚未激活）
- `design_review_id`：`DR-20260719-01`
- 日期：2026-07-19
- 基线commit：设计轮开始时 `4f145e4`
- 历史正式release：`wm-v1-20260716-220959-d5dd704d`
- 当前证据等级：E0

## 授权和范围

本轮只授权整理文档和项目规则。由当前Codex单独完成，不调用其他开发Agent；未修改业务源码、既有迁移、运行数据和活动 `RELEASE_ID`，未安装依赖、下载模型或启动服务，未修改、停止或重启 `D:\AI智囊团`。

## 冻结成果

- 总设计：`docs/PRE_DEVELOPMENT_DESIGN_FREEZE.md`
- 运行状态机：`docs/RUNTIME_WORKFLOWS.md`
- 安全与运维：`docs/SECURITY_AND_OPERATIONS.md`
- 独立评测：`docs/EVALUATION_PROTOCOL.md`
- 八阶段施工：`docs/superpowers/plans/2026-07-19-final-longform-platform-implementation.md`
- 决定：`DEC-020`
- Skill审计：`docs/DESIGN_GOVERNANCE_AUDIT.md#11-dr-20260719-01-开工设计冻结复核`

## 已冻结的实施边界

1. SQLite和不可变文件保持唯一权威；FTS、结构化事实、Wiki/关系、阶段摘要和LanceDB是可重建投影。
2. 新Schema使用0010至0016向前新增；迁移不运行模型、嵌入或全量回填。
3. 每书按outbox回填、非活动快照验证、影子读和原子策略/快照指针切换；失败切回旧指针。
4. 四路检索采用硬门禁、结构/FTS/向量/关系意图路由、H/E/I三车道、同源簇和最小原文闭环。
5. 四种模式、五级输入、先预留输出、岗位最小包、完整生成后软审校保护创造性。
6. 本机短会话、精确Host/Origin、隔离导入、SSRF、秘密脱敏、epoch取消栅栏和真实状态进入release阻断门禁。
7. 工作台保持浅绿可调、176/190px窄栏、中心优先、右栏仅成员；任务/资料/连续性/检索/设置为二级页面。
8. 容量、正确性、运行、创造性和纵向文学质量按E0—E4分开声明。

## 开工条件

老板发出明确开工指令后：

1. 将本预留ID写入活动 `RELEASE_ID`；
2. 在 `TASKS.md` 创建阶段1任务；
3. 保存开工时Git/环境/旧首版全量回归证据；
4. 严格按最终实施计划连续八阶段开发；
5. 每阶段通过门禁并提交证据后自动进入下一阶段。

在此之前，本目录不能被描述为活动release，本文不能被描述为运行验收。

## 设计轮验证结果

- 两份长篇Skill审计均通过：`PRE_DEVELOPMENT_DESIGN_FREEZE.md` 和 `DESIGN_GOVERNANCE_AUDIT.md`。
- 文档引用检查通过；全部当前Markdown未发现UTF-8替换字符；活动 `RELEASE_ID` 仍是历史首版。
- `git diff --check` 通过，只有仓库既有的Windows CRLF提示。
- 首次在受限执行层运行 `npm run verify` 时，类型检查通过，但测试进程连接自身 `127.0.0.1` 临时端口被环境以 `EACCES` 拒绝，连锁产生SSE、HTTP取消和Worker等待3项失败；没有修改测试或业务代码。
- 允许本机回环后用同一命令重跑通过：63个测试文件、132项测试全部通过；API/Web/Worker类型检查和生产构建通过，Web产物约295.65 kB、gzip约89.04 kB。
- 在 `C:\Users\momo\AppData\Local\Temp\wenmi-design-freeze-migrate-20260719-0106` 隔离目录运行迁移：第一次从空库应用0001至0009并到Schema 9，第二次 `applied: []`；正式 `data` 未修改。
- 本轮只修改文档和账本；没有业务源码、依赖锁、既有迁移或运行数据变更。
