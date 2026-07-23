# GLM5.2 运行时修复交付回执（2026-07-21）

## 修复范围与约束
- 仅修复当前已暴露的 BUG（R01–R07），按 handoff doc P0 顺序推进。
- 全程禁止：继续第13章、生成14–50章、运行50章脚本、调用任何真实模型测试。
- 全部用确定性离线测试验证；修复结束后正文生产保持停止，等待老板决定。
- 改动未 git commit，老板可看 diff 决定。

## Appendix B 交付回执（10问）

### 1. 哪些 P0/P1 已修，哪些未修及证据原因

**已修（核心逻辑 + 确定性测试 + typecheck 通过）：**

| 项 | 暴露BUG | 修复要点 | 测试 |
|---|---|---|---|
| P0-1 / R07 | 批量验证无总调用/Token 熔断 | `batch-circuit-breaker.mjs`（章/批 Token 与调用阈值熔断、`QUALITY_BLOCKED` 默认 manual_only 不自动恢复）；`run-real-50-chapter-validation.mjs` 加 offline 只读巡检模式，real 模式经 `batchStartupGate` 门禁 | 17 |
| P0-2 / R02 | 历史受阻任务污染成员状态 | `presence-service` CTE 按状态优先级去重，每 agent 一行，移除 blocked 污染；`App.tsx` `agentPresence` 不再把 blocked/interrupted 显示为"需要处理" | +3 |
| P0-3 / R01 | 可见消息泄漏 JSON 合同 + 讨论标题复述原话 | `effective-output-service` 双形态解析（根级字段 + `{version:1,format:'json_object',fields:{}}` 包装壳）；合同型 `discussion_summary` fallback 给中文提示而非塞围栏 JSON；讨论汇总标题用 `shortDiscussionTitle` 截断不复述老板整段原话 | +9 |
| P0-4 / R03 | 主编租约过期仍被当 stable，renew 无生产调用 | `editor-lease-service` 加 `heartbeatRenew`（心跳续租，chapter 主编综合入口已接入）+ `isLeaseExpired`/`describeLease`（过期显式化）+ `evaluateExpirySafety`/`safeRevertToChief`（有 working/未知调用不切人，无则安全回切） | +4 |
| P0-5 / R04 | 远程中断预留无调和入口 | `model-call-service` 加 `reconcileInterruptedCall`（找到已完成结果->按真实用量 settle+reusable；可证明未执行->retry_safe+release；无法查询->保持 awaiting_provider 不静默释放）+ `reportUnreconciledReservations`（无主预留巡检，不变式=0） | +4 |
| P0-6 / R05 | 上下文同源重复注入 | `context-pack-service` 同源去重：完整不可变版本已硬注入时排除同版本 `retrieval:manuscript` 派生块，记录 `duplicate_of_hard_source`；不同版本保留 | +1 |
| P0-7 / R06 | 事实点评自相矛盾仍触发 rewrite | `production-review-service` 加 `isSelfContradictoryFactFinding` 自洽门禁：事实席证据含"可共存/数学一致/不矛盾/仅新增/尚未确认"软化词却标硬冲突(major/blocker)->报告无效，不生成重写单（该席 blocked） | +1（三百步反例） |

**本轮新增接入（让 core 真正生效）：**
- P0-4 接入：`workspace` API 返回 `editor` 字段（`describeLease`，含 `expired`/`takeoverState`，前端可显示"西施接管中"而非把过期当 stable）；新增 `POST /api/v1/books/:bookId/editor/revert` 手动安全回切入口（`safeRevertToChief`，不满足安全边界返回原因不切）。
- P0-5 接入：`task-claimer.recoverExpired` 已自动把过期 working call 标 interrupted + awaiting_provider；新增 `GET /api/v1/books/:bookId/budgets/reconciliation`（无主预留巡检）+ `POST /api/v1/books/:bookId/model-calls/:requestId/reconcile`（手动调和入口）。
- P0-6 接入：`context-pack-service` dedup 改进为同时按 `version`(contentHash) 与 `sourceId` 根(manuscriptVersionId) 匹配，解决 `previous_chapter_manuscript` 无 version 而 `retrieval:manuscript` 用 version 的错配（+1 测试，共 5）。
- P1 R08：`chapter-batch-service` 批次遇 `blocked` 即 `failed` 终止 + 脚本 `batch-circuit-breaker` manual_only（已就绪，满足"QUALITY_BLOCKED 终止自动链"）。
- P1 R09：`task-service` 按 `idempotencyKey` 去重 + `conversation-service` 按 `messageId` 幂等 + `tool-call-service` 幂等（已就绪，满足"同一消息+scope+binding 幂等"）。
- P1 R10：新增 `text-encoding-diagnostics`（U+FFFD 替换符 / 连续6+问号判损坏）+ 接入 `POST /messages`、`POST /discussions` 拒绝损坏文本进模型（+5 测试）。

**仍待续（增强，非已暴露 BUG 必要修复）：**
- P0-7 结构化冲突对（claimA/claimB/sourceA/sourceB/subject/storyTime/unit/whyMutuallyExclusive）、首次新设定默认候选、文学席软判断引用位置、主编综合真实 rewrite_count（core `isSelfContradictoryFactFinding` 已挡三百步反例）。
- P0-4 discussion/conversation 主编入口续租、Worker 周期自动过期巡检。
- P0-5 套餐余额与书内预算分开显示、启动门禁（套餐未知默认 1-3 章）。
- P0-6 `ContextSource` 完整血缘字段、最小跨度替换完整源、跨书同哈希。
- 8 份文档同步：DECISIONS/AGENT_SYSTEM/LONGFORM_QUALITY 已在之前修改；API.md 已补新 endpoint（reconciliation/reconcile/editor revert/workspace editor）；ACCEPTANCE/COVERAGE_MATRIX/TASKS/USER_GUIDE 待续。

### 2. 是否发起过任何真实模型调用
否。全部测试用 deterministic 适配器或合成夹具，未调用任何真实模型 API、未读取密钥。

### 3. 574 次历史调用 / 6781553 已用 Token / 253494 预留如何保留或调和
- 历史数据未改动（只读核验 baseline 一致：574 调用、6781553 已用 Token、canon_revision=12、第13章未结算）。
- 253494 预留：P0-5 新增 `reconcileInterruptedCall` 调和入口，可对 `awaiting_provider` 的中断调用按本地证据调和。未对现有 253494 预留实际逐个执行调和（火山方舟套餐请求级用量查询能力未知，需老板授权；`reportUnreconciledReservations` 可巡检无主预留是否为 0）。

### 4. 第1-12章正史哈希和 canon_revision=12 是否保持
是。本次仅改 api 层逻辑 + 测试，未碰 chapters/canon 表数据。

### 5. 第13章是否仍为未结算草稿
是。未改动第13章状态。

### 6. 活动主编是谁、租约是否有效、回切策略如何验证
- 活动主编：西施（editor_epoch=2，未改动）。
- 租约：原 `lease_expires_at` 已过期但 `takeover_state=stable`（即暴露BUG）。P0-4 后 `isLeaseExpired`/`describeLease` 显式标记 expired；chapter 主编综合入口 `heartbeatRenew` 已续租。
- 回切策略：`evaluateExpirySafety`（有 working/未知调用->safeToRevert=false 不切）+ `safeRevertToChief`（无进行中调用且原主编模型可用->原子回切）。4 测试验证：续租延长、过期显式化、过期+working 不抢占、安全回切、旧 epoch 晚到拒绝。

### 7. 无活动任务时 11 名成员是否各只有一条真实状态
是。`presence-service` CTE 去重。3 测试验证：20 条历史 blocked 不污染、同一 agent 多活动任务只一行并优先 working、跨书不互相污染。

### 8. 包装 JSON 是否能离线回放成自然中文
是。`effective-output` 双形态解析（根级 + `{version:1,format:'json_object',fields:{}}` 包装）+ 合同 fallback 中文兜底。5 新测试覆盖包装 JSON/围栏/坏 JSON/字段越界/空 answer/内部键不可见。

### 9. 三百步自相矛盾报告是否被拒绝形成硬重写单
是。`isSelfContradictoryFactFinding` 检测事实席证据含软化词却标硬冲突->报告无效->不触发 rewrite（该席 blocked）。三百步反例测试：evidence="…两者在数学上与语义上是一致的" + issueType="正史冲突" + major -> `isSelfContradictoryFactFinding=true`，`decideProductionReviewOutcome` 返回 `{rewrite:false, blocked:true}`。

### 10. 类型、目标测试、全量测试、构建、迁移、运行、恢复、验收的命令和完整结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 全过（api + web + worker + tests，0 错误） |
| 文档8.2 目标测试（11 文件） | 93 passed |
| `npm run test`（全量） | 351 passed（116 文件全过；web 测试已修复，见下） |
| `npm run build` | 全过（api tsc + web vite + worker tsc） |
| `npm run migrate`（临时空库副本） | 全过（24 migrations applied，currentVersion=24，未碰活动数据） |
| `npm run acceptance` | acceptance-audit 功能检查全过（版本边界/产品名/桌面入口/USER_GUIDE）；"工作树干净"项因修复未提交改动失败（预期，commit 后即过） |
| API+Worker 启动 / 任务取消恢复 / 只读 DB 核验 / PRAGMA foreign_key_check | 未跑（需启动服务，待老板授权） |

**web 测试已修复**：原 20 项失败均为 web 组件测试（`tests/foundation/web-app.test.tsx`、`tests/integration/experience/workspace-ui.test.tsx`），错误 `React invalid-hook-call / Cannot read properties of null (reading 'useState')`，根因是 React 双副本（见下）。2026-07-21 经破坏性重装后全部转绿，全量 351/351 通过。

**web 失败根因与修复（已解决）**：`@testing-library/react` 经 pnpm 软链把 `react-dom` 解析到 `.pnpm/react-dom@19.2.7_react@19.2.7` 副本，而 `App.tsx` 的 `react` 走顶层 npm hoist 副本，形成 React 双副本（`node_modules` pnpm/npm 混装：`package.json` 声明 `packageManager: npm@11.13.0` 但 `.pnpm` 残留）。曾尝试 4 种非破坏性 config 修复均无法穿透 require 链。**2026-07-21 经老板批准执行破坏性重装**：停掉 wenmixiezuo 4 个运行进程（API/Worker/Vite preview/start.mjs，占用原生二进制句柄）-> `rmdir /s /q node_modules`（含 .pnpm）-> `npm install`（27s，320 包，零报错，package-lock.json 未变）。重装后 `.pnpm` 清除、react 19.2.7 单副本，web 测试 21/21 全过，全量 351/351 全过。残留未跟踪文件 `pnpm-lock.yaml`（pnpm 遗留）待清理决策。

**待跑项**：API/Worker 启动、任务取消恢复、只读 DB 核验、PRAGMA foreign_key_check 需启动服务，待老板授权。

## 生产状态
正文生产保持停止，等待老板决定。本次未继续第13章、未生成14–50章、未运行50章脚本、未调用真实模型。
