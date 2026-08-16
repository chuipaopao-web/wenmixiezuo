# 文秘写作 · 第二轮全面复查报告（2026-08-16）

> 审查人：Claude（接手开发后第二轮全量复查）
> 方式：通读全部代码 + 关键交互路径逐条验证；本轮 5 个专项代理中 4 个因火山方舟配额 429 中断，改由本人亲自复核（只读），覆盖 worker 运行时 / 任务并发 / 前端流程 / 文档一致性 / 会员账号
> 范围：承接 `REVIEW_REPORT_2026-08-16.md`（首轮 11 项已按拍板修复/搁置），重点排查**生产已发生的事故**、**流程交互**、**权限与付费**的残留问题
> 结论：**只审查记录，未修改任何代码**。发现 1 个生产事故级 + 1 个高危（付费绕过）+ 5 个中/低 + 3 个打磨项，请逐条拍板后再修。

---

## 一、结论速览

| 级别 | 数量 | 说明 |
|---|---|---|
| CRITICAL（线上事故） | 1 | 一个真实用户的"团队讨论"任务 17 次重试全失败，错误对用户和运维都不可见 |
| MAJOR（付费绕过） | 1 | 会员算力耗尽/过期后，可绕过门禁无限重试/恢复任务继续消耗算力 |
| MINOR（体验/一致性） | 5 | 到期原因标注不准、搜索通配符、内测说明自动解锁空档、暂停任务无法从任务中心恢复、重试文案误导 |
| NIT（打磨/文档） | 3 | 报告内并发数值过时、grant 事务外计算、基线 #5 与代码现状矛盾 |

**本轮确认正常**：worker 三循环并发（8 上限 32）与按书互斥在事务上是安全的；无自动重试风暴（17 次全是用户手点）；SSE 单一游标无丢事件/重放；所有建任务路径都走有门禁的 `TaskService.create`；guardAi 覆盖全部 AI 触发面板 + 服务端 403 兜底；管理分页筛选会重置 offset。

---

## 二、CRITICAL · 线上事故：讨论任务重试 17 次全失败且原因不可见

**位置**：生产任务 `7306f545-8f7e-46f4-9bfd-0cec90080e44`（discussion，2026-08-15 09:02 创建）+ 错误映射链路 `apps/api/src/http/server.ts:273-282`、`apps/api/src/infrastructure/models/model-adapter.ts:32-43`、`apps/api/src/application/discussions/discussion-pipeline-service.ts:646-681`、`apps/worker/src/executors/chapter-task-executor.ts:51-53`

**已确认的事实**：
- 任务共尝试 17 次全部失败，`error_code=DISCUSSION_FAILED`，`phase='collecting'`。尝试呈爆发式分布（01:11 两次 18 秒内连击 8 次；今天 06:21 UTC 又 2 次），worker 日志逐条显示 `章节执行API失败：400 INVALID_REQUEST_BODY`。
- **错误链路（已逐环验证）**：provider 对这次请求返回 400 → `ArkPlanModelAdapter` 抛 `ModelAdapterError(message, failureClass, retryable, statusCode=400)` → 讨论管道 catch 把任务置为 failed（`DISCUSSION_FAILED`）并**原样 rethrow** → `server.ts` 错误处理器看到"非 DomainError 但带 400-499 statusCode"→ 映射成通用 `INVALID_REQUEST_BODY` → worker 只见 `400 INVALID_REQUEST_BODY`。
- **后果**：真实的 provider 错误消息（最可能是"提示词超长/上下文超出"）在用户端、worker 日志端**全部消失**。API 只在 500 时记日志，4xx 静默。运维想排查也无从下手。
- **用户视角**：任务详情弹窗显示"继续重试"，说明文案承诺"已完成的内容会继续保留，只处理尚未完成的部分"——用户据此连点 17 次，每次都 2 秒内同样失败，毫无进展。

**建议（择一或组合）**：
- a) **错误透明**：`ModelAdapterError` 的 message（已脱敏、已截断 240 字符）透传到 worker 返回/日志，并在 `model_calls` 增加 `error_detail` 列落库，让用户与运维都能看到"火山方舟Coding Plan返回400：prompt 超长…"；
- b) **重试护栏**：`retryFailed` 对 `error_code` 为确定型 provider 400（`request_failure`、不可重试）限次或提示"该错误无法通过重试解决，请联系管理员"，避免无效连击；
- c) **根治**：确认 400 的具体原因后处理（上下文超长则对讨论资料包做截断/分段，而非整包塞给模型）；
- d) 前端把"继续重试"的承诺文案改准（见 MINOR-4）。

> ⚠️ 需在修复时用一次只读 SQL 查 `model_calls` 该任务各次 `error_class` 佐证（本次轮次中生产 SSH 被网关限流拦截，未能取到，链路已由代码交叉证实）。

---

## 三、MAJOR · 会员门禁可被"继续重试/恢复"绕过，算力耗尽后仍可无限生成

**位置**：`apps/api/src/application/tasks/task-service.ts:118-161`（`queue` / `retryFailed` 无门禁）、`apps/http/domain-routes.ts:1885-1897`（resume/retry 路由直连）、门禁唯一入口 `task-service.ts:90`（仅 `create`）

**已确认的事实**：`assertMembershipAllowsGeneration` 只在 `TaskService.create` 被调用；`queue()` 与 `retryFailed()` 都不检查。`POST /tasks/:id/resume` 与 `/retry` 是普通用户可访问的路由。

**真实影响**：会员算力耗尽（或到期、被撤销）后，对**已存在的失败/中断/暂停任务**点"继续重试"，任务直接重新入队、worker 认领、模型调用照跑——**不经过任何门禁**。对 discussion / chapter_creation / continuation 这类不创建子任务的任务类型，等于无限量白嫖算力。子任务型流水线（卷纲→事件→章节链）在父任务内用 `create` 建子任务时仍会被拦，属"部分自愈"。

**建议**：在 `queue()` 与 `retryFailed()` 内同样调用 `assertMembershipAllowsGeneration`（管理员与未关联账号本来就放行，安全无副作用）。同时给前端暂停/恢复入口同样接 `guardAi`。

---

## 四、MINOR 问题（5 个）

### MINOR-1 · 到期会员的阻断原因：前端说"算力用完"，后端说"请开通会员"，都不准
**位置**：`membership-service.ts:109-121`（后端：到期按 `activeMembershipByOwner` 查不到 → `membership-required`）、`App.tsx:177-182`（前端：到期但 `status==='active'` → `quota`）
**现象**：同一位"已到期待续费"的会员，前端弹"算力值已用完"，服务端门禁却回"请联系管理员开通会员"——自相矛盾且都偏离"您已到期，请续费"。
**建议**：门禁原因增加 `membership-expired` 分支，前端文案对齐（"会员已到期，请联系管理员续费"）。

### MINOR-2 · 管理后台搜索的 LIKE 通配符未转义
**位置**：`membership-service.ts:234-235`
**现象**：输入含 `%` 或 `_` 的关键词会被当成 SQL 通配符，搜索结果非预期（仅搜索语义问题，无注入风险，参数已绑定）。
**建议**：对 `%`、`_`、`\` 做转义，或改用 `instr()` 匹配。

### MINOR-3 · 内测说明关闭后，会员开通不再自动检测
**位置**：`App.tsx:195-199`（仅当 `membershipBlock !== null` 时 20s 轮询）+ `App.tsx:663-681`（内测说明弹窗）
**现象**：用户点了"知道了，继续使用"关掉内测说明后，若不再触发任何 AI 动作，`membershipBlock` 保持 null → **不再轮询会员状态**。管理员此时开通会员，用户端要**刷新页面**才生效，与"管理员开通后会自动解除限制"的承诺不符。
**建议**：把轮询条件改为 `!membershipUsable && account.role !== 'admin'`（无论弹窗是否关闭都轮询）。

### MINOR-4 · 任务中心详情弹窗无法恢复"已暂停"任务
**位置**：`TaskWorkspace.tsx:143-165`（`canRetry` 只覆盖 failed/interrupted，`canCancel` 覆盖 active；无 resume）
**现象**："暂停"任务在任务中心只能取消、不能继续；恢复按钮只在卷纲/事件/设定协作三个面板里有。用户若在任务中心看到暂停任务，点开没有"继续"入口，只能回去找原面板。
**建议**：详情弹窗增加"继续"按钮（复用 `/resume`，并接新门禁）。

### MINOR-5 · 重试说明文案"已完成的内容会继续保留"对讨论等任务不成立
**位置**：`TaskWorkspace.tsx:160`、`task-service.ts:130-161`
**现象**：`retryFailed` 只是把任务重置为 queued，讨论管道会**从头**重新收集全部成员意见；所谓"只处理尚未完成的部分"只在个别有 checkpoint 续跑能力的管道成立。正是这条文案促使那位用户连点 17 次。
**建议**：按任务类型给准确文案，或真正实现 checkpoint 断点续跑；至少 discussion 类应写明"将从头重新执行"。

---

## 五、NIT / 打磨（3 个）

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| N1 | `REVIEW_REPORT_2026-08-16.md:141` | 修复状态表里并发数值仍写"默认 2，上限 4"，实际已改为默认 8、上限 32（`worker-loop.ts:6-7`） | 改文档 |
| N2 | `membership-service.ts:184-190` | `grant` 的 `baseEnd` 在 `BEGIN IMMEDIATE` 之外读取，极端并发双开可能各算一次 | 移入事务；管理员单开、低风险 |
| N3 | `REVIEW_REPORT_2026-08-16.md:145` | 基线表把"会员续费重置周期"标为"不做"，但当前 `grant()` 已实现续费顺延（保留剩余天数） | 更正记录；当前行为正确，无需改代码 |

---

## 六、本轮确认正常的点（供安心）

- **worker 并发安全**：`claimNext` 按书 `NOT EXISTS` + `BEGIN IMMEDIATE` 原子化，多实例下也不会同书双任务；`recoverExpired` 先于并发上限判断执行；`#inFlight` 计数在 finally 清理；无自动重试（failed 任务只等用户手点）。
- **三循环独立**：WorkerLoop / ProjectionLoop / CanonIndexLoop 各自独立 tick，互不阻塞；启动日志打印 `maxConcurrency`。
- **SSE**：单一全局游标 `wenmi-event-cursor`，服务端按 seq、客户端按 bookId 过滤，单调递增，无重放/丢事件。
- **门禁覆盖面**：前端 5 个 AI 面板全部 `guardAi` 前置 + 客户端 403 统一回退弹窗（`client.ts:933`）；所有建任务路径（11 处调用点）均经 `TaskService.create`。
- **管理分页**：筛选变化会重置 offset；`上一页/下一页` 禁用逻辑正确（代理原报的"stale offset"经核实不成立，已剔除）。
- **数据安全**：usage_ledger 在 budget 结算时落账；创建门禁为软边界（任务中途越配额是设计容差）。

---

## 七、建议的修复顺序（请拍板）

1. **CRITICAL（生产事故）**——建议必修：a) 错误透明（`model_calls.error_detail` + provider 消息透传）；b) 重试护栏（不可重试错误限次）；c) 根治（按实际 400 原因处理讨论资料包超长）。
2. **MAJOR（付费绕过）**——建议必修：`queue`/`retryFailed` 接门禁。
3. **MINOR 1/3/4/5**——建议本轮一并修（都是真实用户可感知的交互问题）。
4. **MINOR 2 + N1/N2/N3**——顺手处理。
5. 修完按既定流程：`docs:sync` → typecheck/test/build → 提交推送 → 部署（含备份）→ 已注册用户数据零损伤核对。

---

## 八、本轮修复状态（2026-08-16 依"全部修复并部署"拍板执行）

> 部署前记录。typecheck/test/build 与生产部署因网关分类器故障暂缓，代码改动已全部落盘并经静态核对；部署完成后此表"状态"列再统一回填。

| # | 问题 | 状态 | 改动 |
|---|---|---|---|
| CRITICAL-a | 错误透明 | ✅ 已实现 | 迁移 `0046_model_call_error_detail.sql` 新增 `model_calls.error_detail`；`ModelCallService.execute` 失败时把真实错误（脱敏截断 1000 字）落库；`server.ts` 4xx 分支补 `request.log.error`（此前 4xx 静默） |
| CRITICAL-b | 重试护栏 | ✅ 已实现 | `retryFailed` 先查最近一次 `model_calls` 失败是否为 `error_class='request_failure'`（4xx 不可重试），是则抛新错误码 `MODEL_REQUEST_REJECTED`（409）并带真实原因，拦下无效连点 |
| CRITICAL-c | 根治（资料包超长） | ⏸ 待真实 400 确认 | 部署后查生产任务 `7306f545` 的 `error_detail` 定位真实 400（大概率上下文超长），再决定讨论资料包截断/分段方案 |
| CRITICAL-d | 重试文案 | ✅ 已实现 | 详情弹窗改为"系统将重新执行本任务；已保存并生效的正式内容不会被覆盖，也不会重复生成"（与 MINOR-4/5 合并处理） |
| MAJOR | 会员门禁绕过 | ✅ 已实现 | `queue()` 与 `retryFailed()` 开头接入 `assertMembershipAllowsGeneration`（管理员/未关联账号自动放行）；前端暂停/恢复入口已接 `guardAi` |
| MINOR-1 | 到期原因标注 | ✅ 已实现 | `membershipGenerationBlockReason` 增加 `membership-expired`（到期≠未开通）；`assertMembershipAllowsGeneration` 抛新错误码 `MEMBERSHIP_EXPIRED`；前端 `guardAi` 映射 expired + 弹窗文案"会员已到期" |
| MINOR-2 | 管理搜索通配符 | ✅ 已实现 | `listUsersWithMembership` / `listUsers` 的 LIKE 对 `\ % _` 转义（`ESCAPE '\\'`） |
| MINOR-3 | 内测说明关闭后不轮询 | ✅ 已实现 | 会员轮询条件改为 `!membershipUsable && account.role !== 'admin'`（无论弹窗状态都轮询，开通后自动解锁） |
| MINOR-4 | 任务中心无法恢复暂停任务 | ✅ 已实现 | 详情弹窗按 `status ∈ {paused, pending}` 显示"继续执行"按钮，复用 `/resume`（已接新门禁） |
| MINOR-5 | 重试文案误导 | ✅ 已实现 | 同 CRITICAL-d；任务失败时详情弹窗新增"失败原因"行，透出 `model_calls.error_detail` 真实错误 |
| N1 | 报告并发数值过时 | ✅ 已实现 | `REVIEW_REPORT_2026-08-16.md:141` 更正为"默认 8、上限 32、线上设 8" |
| N2 | grant 事务外计算 | ✅ 已实现 | `grant()` 的 existingActive 读取与 baseEnd 计算移入 `BEGIN IMMEDIATE` 块内 |
| N3 | 基线 #5 与代码矛盾 | ✅ 已实现 | `REVIEW_REPORT_2026-08-16.md:145` 标记为"✅ 已顺延"（grant 已实现续费顺延） |

**待办**：typecheck/test/build 全绿 → docs:sync → 提交推送（不提交 `reset-password.*`）→ 生产备份 → 部署（`git archive` + 迁移 v46 + 重启）→ 41 用户/35 本书数据完整性核对 → 查 `7306f545` 真实 error_detail → 回填本表。

---

## 九、opencodego 模型切换（2026-08-16，代码已完成、部署待网关恢复）

> 依用户指示"将文秘写作里用到的大模型切换成 opencodego，适配不了的不要变化"。密钥只进生产环境变量，绝不写入 Git / SQLite / 日志 / 备份 / 导出文件。typecheck/test/build 与生产配置因网关分类器故障暂缓。

**设计（保留方舟为默认，opencodego 显式开启）**：
- 新增 `ModelPlan='opencodego'` 与 `endpoints.opencodego`（provider `opencodego`，默认 `https://opencode.ai/zen/go`，`WENMI_OPENCODEGO_BASE_URL` 可覆盖）。
- 配置 `WENMI_OPENCODEGO_API_KEY` 后激活订阅模式并全岗位切换 provider→opencodego；角色模型**分配与 Agent Plan 完全一致**（主笔/编剧 DeepSeek V4 Pro、审校 MiniMax M3、体验豆包、连续性 GLM 5.2、主编/版权 Kimi K2.7、研究 DeepSeek Flash），因此通过团队模型多样性校验（`validateTeamModelProfiles`）且模型名在 opencodego catalog 同名时无缝替换。
- 逐角色模型可用 `WENMI_OPENCODEGO_*_MODEL` 覆盖；opencodego 不提供的模型角色可换名或改走方舟（"适配不了的不要变化"）。
- 存量书籍重绑：`bindAllBooks` 的 V2 迁移判定由"仅方舟 Agent Plan"泛化为"方舟 Agent Plan 或 opencodego"，API 重启后现有书籍（含 V1/V2）自动迁到 opencodego；新书 onboarding / legacy 升级同样走 roleProfiles。
- 复用 `ArkPlanModelAdapter`（Anthropic Messages 协议），错误文案按 plan 显示名（`opencodego` / `火山方舟Coding Plan` / `火山方舟Agent Plan`）。

**改动文件**：`model-runtime-config.ts`（端点/激活/profiles/assertOpencodegoBaseUrl）、`ark-plan-model.ts`（plan 类型+文案泛化）、`model-adapter-factory.ts`（opencodego 分支+通用文案）、`model-binding-service.ts`（订阅策略判定+迁移消息）、`agent-team-v2.ts`（TeamModelPlan）、`TeamWorkspace.tsx`/`SettingsDialog.tsx`/`client.ts`（前端标签与类型）、`deploy/.env.production.example`、`docs/DEPLOY.md`、`tests/foundation/model-runtime-config.test.ts`、`tests/foundation/ark-plan-model.test.ts`。

**待验证（部署前必做）**：① opencodego 真实 base URL（默认 `https://opencode.ai/zen/go` 为经验值，需对线上服务做一次最小请求确认）；② catalog 是否提供上述六个模型名，缺模型时按"适配不了不改"逐角色换名或回退方舟。

**2026-08-16 实测结论（已完成①②）**：

- 真实地址确认：`https://opencode.ai/zen/go`（Anthropic Messages 协议，端点 `{baseUrl}/v1/messages`）；模型清单接口 `/v1/models` 认 Bearer，但 **Messages 接口只认 `x-api-key` 认证头，Bearer 一律 401 Missing API key**——上一轮"网关有问题"即此原因，适配器已按 plan 分支改用 `x-api-key`，方舟端点保持 Bearer 不变。
- go 目录实测可用且探针通过：`deepseek-v4-pro`（主笔/编剧A）、`deepseek-v4-flash`（研究）、`glm-5.2`（编剧B/连续性）、`minimax-m3`（文学审查）、`kimi-k2.7-code`（主编/版权）。**Kimi 上游把字符串 content 误判为空消息（400 messages must not be empty），opencodego 请求的消息体已改为文本块数组**；glm-5.2 忽略 `thinking.disabled`，小额度会把预算耗在思考上，沿用 DEC-CURRENT-039 的较大输出额度即可正常出文。
- **go 目录没有豆包模型**：体验席（豆包 Seed 2.1 Turbo）默认保留火山方舟 Agent Plan 绑定（`opencodegoProfiles` 已改为未显式设置 `WENMI_OPENCODEGO_DOUBAO_MODEL` 时回退方舟 profile），生产环境需继续保留 `WENMI_ARK_AGENT_PLAN_API_KEY`；四席模型来源仍保持互异，团队多样性校验不受影响。
- 项目连通探针实测：opencodego 五岗位（chief_editor/lead_screenwriter/second_screenwriter/literary_reviewer/researcher）全部 `succeeded`、有可见文字、`cashCostCny=0`；体验席豆包待方舟 Agent Plan 凭证就位后补齐第六席探针。
- 注意：本机 Windows 用户环境残留 `ANTHROPIC_BASE_URL=https://opencode.ai/zen/go` 而无配套 token；该地址不是方舟主机，运行时严格校验会拒绝借用兼容凭证，不构成安全隐患，但建议择机清理该用户变量避免误导。
- 密钥边界：本次实测密钥只经命令行环境变量传入，未写入任何工作区文件（已扫描确认）；生产侧只写入服务器 `deploy/.env.production`。
