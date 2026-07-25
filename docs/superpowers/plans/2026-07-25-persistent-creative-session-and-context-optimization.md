# 持续创作会话与最小上下文优化实施计划

> **执行约束：** 当前Codex在 `D:\wenmixiezuo` 内单独实施；不调用其他开发Agent，不触碰 `D:\AI智囊团`，不运行真实模型正文压力测试。

**Goal:** 把现有“一句话即双编剧、立即估章、立即生成长章纲”的一次性工作流改成可持续、可追踪、可恢复的创作会话，并把主笔上下文收敛到约5000中文字符的最小充分资料包，同时补齐非正史剧情预演、阶段记忆、来源指纹和审校退化保护。

**Architecture:** 保留React/Fastify/SQLite/Worker、11名创作成员、SQLite权威、混合RAG、不可变正文和三异模型正式审校。新增的创作会话、黑板、剧情预演和质量快照仍位于同一SQLite权威库；预演与聊天只属于临时/候选层，绝不直接进入正史。所有模型调用继续由持久任务和Worker执行，前台只创建状态与任务。

**Tech Stack:** TypeScript、Node.js 24、Fastify、React、SQLite、Vitest、Vite。

**release_id:** `wm-longform-r1-20260719-003435-e4d7b8b7`

**design_review_id:** `DR-20260725-01`

---

## Task 1：冻结决定、迁移与Repository合同

**Files:**
- Create: `apps/api/src/infrastructure/db/migrations/0026_creative_sessions_and_context_policy.sql`
- Create: `apps/api/src/infrastructure/db/repositories/creative-session-repository.ts`
- Create: `apps/api/src/contracts/creative-session.ts`
- Test: `tests/integration/migrations/creative-session-migration.test.ts`
- Test: `tests/integration/discussions/creative-session-repository.test.ts`

**Steps:**
1. 先写空库、Schema 25升级、幂等、跨书隔离和不可变黑板修订失败测试。
2. 新增创作会话、事件、黑板修订、讨论轮、剧情预演分支和稿件质量快照。
3. 给 `context_packs` 向前新增策略版本与来源指纹，不修改旧迁移。
4. 实现按书Repository、唯一活动会话、CAS修订、来源哈希和陈旧预演标记。

## Task 2：持续会话路由与自然操作

**Files:**
- Create: `apps/api/src/application/discussions/creative-session-service.ts`
- Modify: `apps/api/src/application/chat/conversation-service.ts`
- Modify: `apps/api/src/application/chat/conversation-reply-pipeline-service.ts`
- Modify: `apps/api/src/application/discussions/discussion-service.ts`
- Test: `tests/integration/domain/open-conversation-runtime.test.ts`
- Create: `tests/integration/domain/persistent-creative-session.test.ts`

**Steps:**
1. 先写失败测试：首次剧情讨论启动双编剧；普通追问只续接同一会话并交给主编；显式重大改向才开新双编剧轮；并发消息不创建两个活动会话。
2. 增加结构化动作：继续讨论、重大改向、锁定方向、试写、暂停。
3. 老板原话按事件保存；主编回复完成后写新黑板修订，但不写正史。

## Task 3：双编剧独立方案、一次交叉质疑与剧情预演

**Files:**
- Modify: `apps/api/src/application/discussions/discussion-pipeline-service.ts`
- Modify: `apps/api/src/application/discussions/discussion-service.ts`
- Modify: `apps/api/src/application/artifacts/planning-artifact-service.ts`
- Test: `tests/integration/domain/discussion-runtime.test.ts`
- Test: `tests/integration/runtime/subscription-model-pipelines.test.ts`
- Create: `tests/integration/discussions/narrative-forecast.test.ts`

**Steps:**
1. 探索轮不估章节、不生成章纲；两名编剧初始互不可见；随后各做一次有界交叉质疑；主编最后汇总。
2. 两名编剧方案保存为非正史预演分支，并绑定正史/黑板/来源指纹。
3. 只有老板锁定方向后创建规划轮；该轮才估算跨度、形成故事弧和未来1—3章滚动章纲。

## Task 4：主编/主笔最小上下文与阶段记忆

**Files:**
- Create: `apps/api/src/application/memory/writer-context-policy.ts`
- Modify: `apps/api/src/application/memory/context-pack-service.ts`
- Modify: `apps/api/src/application/memory/role-context-compiler.ts`
- Modify: `apps/api/src/application/creation/chapter-pipeline-service.ts`
- Modify: `apps/api/src/application/chat/conversation-reply-pipeline-service.ts`
- Test: `tests/foundation/context-pack.test.ts`
- Create: `tests/integration/creation/writer-minimal-context.test.ts`
- Create: `tests/integration/continuity/stage-context-selection.test.ts`

**Steps:**
1. 初稿上下文软目标约5000中文Token等价量；章目标/章纲最多1500；硬来源超预算明确停止。
2. 移除整份全书创作方案和任意12条活动记忆的默认注入；改为角色化混合检索、当前阶段结算、人物状态、开放伏笔和前章结尾。
3. 上下文包保存策略版本、来源指纹、正史修订和排除原因。

## Task 5：审校退化保护与正式/试写模式

**Files:**
- Create: `apps/api/src/application/creation/manuscript-quality-snapshot-service.ts`
- Modify: `apps/api/src/application/creation/chapter-pipeline-service.ts`
- Modify: `apps/api/src/application/creation/production-review-service.ts`
- Test: `tests/foundation/production-review-convergence.test.ts`
- Create: `tests/integration/creation/manuscript-quality-rollback.test.ts`

**Steps:**
1. 保存分维度质量向量，不计算单一综合分。
2. 新稿主观维度净退化且无硬改善时保留上一最佳稿；硬风险不能投票消除。
3. 最多两轮自动定点重写；剩余单一主观异议交老板。

## Task 6：API与一屏工作台

**Files:**
- Modify: `apps/api/src/http/domain-routes.ts`
- Modify: `apps/api/src/contracts/api.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `tests/integration/http/domain-routes.test.ts`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

**Steps:**
1. 增加当前会话、黑板、预演分支、陈旧原因和自然动作接口。
2. 聊天页显示当前议题、成熟度、候选方向和操作，不显示内部JSON。
3. 保持固定一屏、中心创作区优先，任务栏显示会话/轮次/阶段。

## Task 7：P0可靠性复核与故障测试

**Files:** 仅在失败测试证明缺陷时修改有效输出、状态、模型调用、租约或上下文去重服务。

**Steps:**
1. 验证JSON不泄漏、终态不显示忙碌、预算熔断、未知调用不重放、候任模型可用性、租约续期和同源去重。
2. 已有机制真实通过则只留证据，不因外部意见重复重写。

## Task 8：完整门禁、证据、提交与备份

**Files:** 同步当前产品、架构、数据、记忆、Agent、API、验收、覆盖矩阵、知识、任务与release证据文档。

**Steps:**
1. 运行目标测试、类型检查、全测、构建、空库/升级/幂等迁移。
2. 运行Repository、跨书、取消/恢复、Worker、备份隔离恢复和本地运行探针。
3. 运行500万字符/1500章E2工程回放；不把E2冒充文学质量。
4. 不调用真实模型，不继续现有13章后的正文。
5. 写证据、检查Git差异、提交并推送。
