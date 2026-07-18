# 文秘写作长篇终局能力实施计划

> 执行者：当前Codex单独开发。老板未授权其他开发Agent，禁止委派代码任务。

**目标：** 在历史首版之上连续完成500万字符/1500章、四层知识生命周期、父子切片、本地混合RAG、阶段连续性、DEC-021十一人团队最小上下文、双异模型编剧、主编/主笔接管、GLM/Kimi/豆包固定三异模型全文点评、作者资料库、安全可移植和独立评测，并保留旧书逐书可回滚能力。

**架构：** SQLite和登记的不可变文件保持唯一权威；FTS5、结构化事实、Wiki/关系、阶段摘要和本地LanceDB只是带水位的可重建投影。Fastify应用服务执行状态机，Worker幂等处理模型和投影，Web是窄侧栏内容优先工作台。新能力通过向前迁移、outbox、影子读和每书能力指针上线。

**固定技术栈：** React、TypeScript、Vite、Node.js稳定LTS、Fastify、SQLite、REST、SSE；新增依赖仅限本地LanceDB、Transformers.js/ONNX运行时所需包及懒加载Cytoscape.js，必须在对应阶段先通过许可证、锁文件、目标电脑和离线探针。

**release：** 收到明确开工指令后激活 `wm-longform-r1-20260719-003435-e4d7b8b7`。旧release `wm-v1-20260716-220959-d5dd704d` 的阶段证据保持不变。

**权威设计：** `docs/PRE_DEVELOPMENT_DESIGN_FREEZE.md`、`docs/RUNTIME_WORKFLOWS.md`、`docs/SECURITY_AND_OPERATIONS.md`、`docs/EVALUATION_PROTOCOL.md` 及其引用的当前规格。

## 通用执行规则

每个任务严格采用：先写失败测试→运行确认按预期失败→实现最小闭环→运行目标测试→运行受影响回归→更新文档/证据→小提交。禁止先堆完阶段再补测试。

每阶段必须执行并保存：

```powershell
npm run typecheck
npm test
npm run build
npm run migrate
npm run verify
```

并运行该阶段列出的迁移升级、本地API/Web/Worker、Repository契约、跨书、故障恢复和安全测试。阶段证据写入：

`docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/stages/0N-<name>.md`

每阶段开始先在 `TASKS.md` 登记目标、不做什么、唯一负责人、允许/禁止文件、依赖、约束、验收、测试、停止、回滚和复核。公共Schema、迁移、API、共享类型、核心编排和安全始终串行。

---

## 阶段1：release基线、安全入口与能力探针

### 目标

激活新release；建立本机HTTP会话、安全默认、依赖/硬件/模型能力探针和旧首版回归基线。此阶段不改变书籍业务语义。

### 任务1.1：冻结历史与release账本

**修改：**

- `RELEASE_ID`
- `TASKS.md`
- `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/00-baseline.md`
- `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/ACCEPTANCE_MATRIX.md`

**步骤：**

1. 写文档测试，断言新release目录、活动ID、历史release引用和0现金边界。
2. 记录起点commit、Git状态、Node/npm/OS、端口、数据目录、远程Git和设计文档哈希。
3. 运行旧首版全量门禁，保存原始输出摘要；失败先修基线，不进入新功能。
4. 提交：`chore(release): activate longform r1 baseline`。

### 任务1.2：本机会话和HTTP防护

**新增：**

- `apps/api/src/infrastructure/security/runtime-session.ts`
- `apps/api/src/infrastructure/security/request-policy.ts`
- `apps/api/src/http/runtime-routes.ts`
- `tests/integration/security/runtime-session.test.ts`
- `tests/integration/security/request-policy.test.ts`

**修改：**

- `apps/api/src/http/server.ts`
- `apps/web/src/lib/api/client.ts`
- `tests/foundation/api-health.test.ts`

**测试先行：** 精确Host/Origin、Cookie、SSE凭证、跨站写、错误脱敏、重启失效、health最小响应。实现每启动256位秘密、短会话Cookie、Worker独立Token和安全响应头。

### 任务1.3：运行与依赖能力探针

**新增：**

- `apps/api/src/infrastructure/capabilities/runtime-capability-probe.ts`
- `apps/api/src/infrastructure/capabilities/model-asset-registry.ts`
- `apps/api/src/application/capabilities/capability-service.ts`
- `tests/integration/runtime/capability-probe.test.ts`

**修改：**

- `apps/api/src/infrastructure/db/database.ts`
- `apps/api/src/http/domain-routes.ts`
- `apps/web/src/app/App.tsx`

探测SQLite defensive/authorizer/limits、LanceDB/ONNX可加载性、CPU/RAM/磁盘可读信息、离线模型资产、许可/哈希和端口。无权限读取硬件详情时记录 `unknown`，不得填0冒充实测。此阶段只探测，不下载模型。

### 阶段门禁与回滚

- 旧测试零退化；安全负面测试全过；桌面入口和SSE正常。
- 回滚新release活动ID和安全入口提交即可恢复旧首版；不涉及业务迁移。
- SQLite基础能力、Host/Origin或会话无法安全实现则停止；可选硬件信息未知不阻断。

---

## 阶段2：Repository边界、Schema 10—11和知识生命周期

### 目标

先消除长篇模块直接访问数据库的扩散风险，再增加表达/标签、四层生命周期、三轴时间和提升链。旧数据不改义。

### 任务2.1：Repository与事务端口

**新增：**

- `apps/api/src/infrastructure/db/repositories/knowledge-repository.ts`
- `apps/api/src/infrastructure/db/repositories/task-repository.ts`
- `apps/api/src/infrastructure/db/repositories/retrieval-repository.ts`
- `apps/api/src/infrastructure/db/repositories/projection-repository.ts`
- `apps/api/src/infrastructure/db/unit-of-work.ts`
- `tests/contract/application-database-boundary.test.ts`

**修改：** 逐个把 `apps/api/src/application/**` 中直接 `DatabaseSync` 查询迁到Repository，保留构造注入兼容层，先迁新长篇会触达的知识、任务、记忆和投影服务。

测试静态阻止应用服务新增SQL和无 `owner_id + book_id` 方法；业务不变量测试在Repository替换前后相同。

### 任务2.2：Schema 10表达与资料治理

**新增：**

- `apps/api/src/infrastructure/db/migrations/0010_expression_taxonomy.sql`
- `apps/api/src/application/knowledge/taxonomy-service.ts`
- `apps/api/src/application/books/expression-profile-service.ts`
- `tests/integration/knowledge/expression-taxonomy.test.ts`
- `tests/integration/knowledge/migration-0010-upgrade.test.ts`

表：`book_expression_profiles`、`technique_cards`、`entity_schemas`、`tag_definitions`、`tag_aliases`、`tag_assignments`、`semantic_annotations`、`knowledge_gap_findings`。所有版本、归档、适用范围和来源约束进入数据库测试。

### 任务2.3：Schema 11生命周期与三轴时间

**新增：**

- `apps/api/src/infrastructure/db/migrations/0011_knowledge_lifecycle_time.sql`
- `apps/api/src/application/knowledge/knowledge-lifecycle-service.ts`
- `apps/api/src/application/knowledge/temporal-query-service.ts`
- `apps/api/src/contracts/knowledge-lifecycle.ts`
- `tests/integration/knowledge/lifecycle-promotion.test.ts`
- `tests/integration/knowledge/three-axis-time.test.ts`
- `tests/fault-injection/knowledge-promotion-recovery.test.ts`

表：`knowledge_items`、`knowledge_revisions`、`knowledge_promotions`、`temporal_scopes`、`retention_records`、`canon_source_bindings`。旧事实映射为原权威等级和 `temporal_completeness=partial`；只生成补全候选，不猜时间。

### 任务2.4：章节结算升级

**修改：**

- `apps/api/src/application/knowledge/canon-service.ts`
- `apps/api/src/application/knowledge/knowledge-consistency-service.ts`
- `apps/api/src/application/creation/chapter-pipeline-service.ts`
- `tests/fault-injection/canon-settlement.test.ts`

把当前通用摘录升级为有来源、三轴、分级门禁的候选抽取；先用确定性抽取器和冻结夹具。正文确认与结算失败解耦，结算不能回滚已确认正文。

### 阶段门禁与回滚

- 空库、Schema 9→11、重复迁移和迁移中断恢复。
- 两书相同实体/标签零串书；D级、歧义、观点、梦境和冲突不自动提升。
- 迁移只加表/列；回滚功能通过能力开关停用新写路径，旧表和旧读路径保留。

---

## 阶段3：切片快照、投影outbox与本地语义通道

### 目标

实现不可变结构切片、投影DAG、水位、原子快照切换和可选本地向量；向量失败不影响权威或硬事实。

### 任务3.1：Schema 12切片与投影

**新增：**

- `apps/api/src/infrastructure/db/migrations/0012_chunk_projection_snapshots.sql`
- `apps/api/src/application/projections/projection-job-service.ts`
- `apps/api/src/application/memory/chunk-snapshot-service.ts`
- `apps/api/src/contracts/projections.ts`
- `tests/integration/memory/chunk-snapshots.test.ts`
- `tests/fault-injection/projection-switch.test.ts`

表：`content_nodes`、`content_chunks`、`chunk_entities`、`chunk_snapshots`、`chunk_snapshot_sources`、`projection_outbox`、`projection_jobs`、`projection_watermarks`、`embedding_model_snapshots`、`vector_index_manifests`、`book_capability_states`。

### 任务3.2：结构语义切片器

**新增：**

- `apps/api/src/application/memory/structural-chunker.ts`
- `apps/api/src/application/memory/chunk-policy.ts`
- `tests/integration/memory/structural-chunking.test.ts`
- `tests/fixtures/chunking/`

先写场景边界、长场景、对话、规则、大纲、设定、中文标点、零盲目重叠和邻接扩展测试，再实现父块/子块/原子来源。重切片产生新快照，不修改旧块。

### 任务3.3：FTS/Wiki/关系投影Worker

**新增：**

- `apps/worker/src/executors/projection-task-executor.ts`
- `apps/worker/src/runtime/projection-loop.ts`
- `apps/api/src/application/projections/wiki-projection-service.ts`
- `apps/api/src/application/projections/relation-projection-service.ts`
- `tests/integration/projections/projection-rebuild.test.ts`

**修改：**

- `apps/worker/src/runtime/worker-loop.ts`
- `apps/worker/src/scheduler/task-claimer.ts`

每种投影有独立水位和失败状态；活动快照在全部探针通过后切换。

### 任务3.4：本地嵌入与LanceDB适配器

**新增：**

- `apps/api/src/infrastructure/retrieval/embedding-adapter.ts`
- `apps/api/src/infrastructure/retrieval/local-transformers-embedding.ts`
- `apps/api/src/infrastructure/retrieval/lancedb-vector-store.ts`
- `apps/api/src/infrastructure/retrieval/null-vector-store.ts`
- `tests/integration/retrieval/vector-projection.test.ts`
- `tests/fault-injection/vector-degraded-mode.test.ts`

先固定接口和假向量测试，再安装锁定依赖；禁止远程模型，校验资产哈希。运行LanceDB本地路径、崩溃重开、删库重建、跨书过滤和目标电脑吞吐探针。失败自动选择 `null-vector-store` 并显示降级。

### 阶段门禁与回滚

- 构建中断时旧快照继续服务；删除派生目录可完整重建。
- 向量查询必须有书籍过滤且不能单独产生H结论。
- 回滚每书活动快照/策略指针；不删除新快照和旧权威。

---

## 阶段4：四路检索、证据闭环与上下文编译

### 目标

实现DEC-019的完整查询计划、硬门禁、意图路由、H/E/I、同源聚类、有界下钻和Token预算。

### 任务4.1：Schema 13与检索计划

**新增：**

- `apps/api/src/infrastructure/db/migrations/0013_retrieval_orchestration.sql`
- `apps/api/src/application/memory/retrieval-query-planner.ts`
- `apps/api/src/application/memory/entity-disambiguation-service.ts`
- `apps/api/src/contracts/retrieval-plan.ts`
- `tests/integration/retrieval/query-planning.test.ts`
- `tests/integration/retrieval/entity-disambiguation.test.ts`

表：`retrieval_query_plans`、`retrieval_channel_runs`、`retrieval_candidates`、`retrieval_evidence_clusters`、`retrieval_evidence_checks`、`retrieval_drilldowns`、`retrieval_context_selections`。

### 任务4.2：四通道路由与融合

**新增：**

- `apps/api/src/application/memory/retrieval-router.ts`
- `apps/api/src/application/memory/evidence-clusterer.ts`
- `apps/api/src/application/memory/lane-fusion-service.ts`
- `apps/api/src/application/memory/evidence-closure-service.ts`
- `tests/integration/retrieval/hybrid-routing.test.ts`
- `tests/integration/retrieval/evidence-closure.test.ts`

**修改：**

- `apps/api/src/application/memory/retrieval-service.ts`

先写张三/天安城、同名、三轴时间、冲突、摘要/父子同源、无答案和关系越界测试。H不进RRF，E/I分车道。

### 任务4.3：有界阶段下钻

**新增：**

- `apps/api/src/application/memory/historical-drilldown-service.ts`
- `tests/integration/retrieval/historical-drilldown.test.ts`

实现活动集0、卷1、故事弧2、章/场景/事实3和最小原文解引用预算；只允许一次补充周期。

### 任务4.4：Token和岗位上下文编译器

**新增：**

- `apps/api/src/application/memory/token-budget-service.ts`
- `apps/api/src/application/memory/role-context-compiler.ts`
- `apps/api/src/application/memory/context-compression-service.ts`
- `apps/api/src/contracts/context-pack-v2.ts`
- `tests/integration/memory/token-budget.test.ts`
- `tests/integration/memory/role-context-compiler.test.ts`
- `tests/fault-injection/compression-probe.test.ts`

**修改：**

- `apps/api/src/application/memory/context-pack-service.ts`
- `apps/api/src/application/calls/model-call-service.ts`

先预留输出和20%安全边界；Tokenizer可用则精确计数，否则使用校准上界。记录注入/排除，压缩探针失败回到上版。

### 阶段门禁与回滚

- 冻结检索集阻断项100%；跨书0；来源闭环100%。
- 新策略先影子运行，逐书指针切换；回滚指针恢复首版检索。
- 上下文溢出不得删安全/任务/H；无法满足则阻断调用。

---

## 阶段5：长篇连续性、十一人团队连续性与滚动规划

### 目标

实现五级增量结算、关键触发、承诺与伏笔、滚动规划、岗位连续性和真实身份恢复。

### 任务5.1：Schema 14长篇连续性

**新增：**

- `apps/api/src/infrastructure/db/migrations/0014_longform_continuity.sql`
- `apps/api/src/application/continuity/commitment-service.ts`
- `apps/api/src/application/continuity/stage-settlement-service.ts`
- `apps/api/src/application/continuity/rolling-plan-service.ts`
- `tests/integration/continuity/stage-settlement.test.ts`
- `tests/integration/continuity/rolling-plan.test.ts`

表：`narrative_commitments`、`continuity_nodes`、`continuity_node_sources`、`stage_settlements`、`stage_settlement_sources`、`stage_settlement_probes`、`rolling_plan_windows`、`quality_windows`、`retrieval_activity_projections`。

### 任务5.2：Schema 15岗位、提示和压缩快照

**新增：**

- `apps/api/src/infrastructure/db/migrations/0015_agent_compression_prompts.sql`
- `apps/api/src/application/agents/agent-continuity-service.ts`
- `apps/api/src/application/agents/prompt-compiler.ts`
- `apps/api/src/application/agents/model-capability-service.ts`
- `apps/api/src/application/agents/team-template-service.ts`
- `apps/api/src/application/agents/editor-lease-service.ts`
- `apps/api/src/application/agents/writer-lease-service.ts`
- `tests/integration/agents/agent-continuity.test.ts`
- `tests/integration/agents/prompt-compiler.test.ts`
- `tests/integration/agents/eleven-member-team.test.ts`
- `tests/fault-injection/agents/editor-writer-takeover.test.ts`

表：`agent_continuity_journals`、`agent_focus_snapshots`、`compression_snapshots`、`compression_probes`、`prompt_template_snapshots`、`model_capability_snapshots`、`team_template_snapshots`、`review_panels`、`review_reports`、`revision_orders`。历史9实例保持不变；下一release 11名成员及三点评席原子创建。岗位日志只存任务步骤、依据、异议、结论和接管信息，不存思维链或迎合规则。

### 任务5.3：结算、审计和恢复调度

**新增：**

- `apps/worker/src/executors/settlement-task-executor.ts`
- `apps/worker/src/executors/continuity-audit-executor.ts`
- `tests/integration/continuity/worker-settlement.test.ts`
- `tests/fault-injection/continuity-rebuild.test.ts`

每章增量结算；每10章轻审计、30—50章故事弧检查、80—150章卷级检查；20/50/100/200滚动窗口只是检查，不机械划分阶段。

### 阶段门禁与回滚

- 摘要探针失败保留上一有效节点；硬事实和开放线程不按距离休眠。
- 主编/副编和主笔/副笔接管均通过租约、epoch、检查点和晚到提交阻断；同一正式稿只有一个活动写手。
- 双编剧、三点评的模型快照独立性由应用服务事务和Repository契约测试证明，不能以岗位名称替代模型验证。
- 1000章确定性连续性夹具先做缩小版，再在阶段8跑全量。
- 回滚停用新连续性策略，原正史/正文不变。

---

## 阶段6：正确创作流水线与创造性保护

### 目标

把开放聊天→双异模型编剧独立讨论→设定硬矛盾检查→主编确认→工单/资料包→单活动写手检索/生成→GLM/Kimi/豆包三异模型全文点评→主编合并修改单→老板确认→结算完整串联，消除“只有书名就写章”。

### 任务6.1：统一运行状态机

**新增：**

- `apps/api/src/application/workflows/task-state-machine.ts`
- `apps/api/src/application/workflows/operation-idempotency-service.ts`
- `apps/api/src/contracts/workflow-events.ts`
- `tests/integration/workflows/task-state-machine.test.ts`
- `tests/fault-injection/cancel-commit-fence.test.ts`

**修改：**

- `apps/api/src/application/tasks/task-service.ts`
- `apps/worker/src/scheduler/task-claimer.ts`
- `apps/worker/src/runtime/worker-loop.ts`

实现operation/task/attempt/epoch、取消传播、晚到栅栏、租约接管和真实状态派生。

### 任务6.2：开放讨论和规划收口

**修改：**

- `apps/api/src/application/chat/conversation-reply-pipeline-service.ts`
- `apps/api/src/application/discussions/discussion-pipeline-service.ts`
- `apps/api/src/application/discussions/discussion-service.ts`
- `apps/api/src/application/artifacts/planning-artifact-service.ts`
- `tests/integration/domain/open-conversation-runtime.test.ts`
- `tests/integration/domain/discussion-runtime.test.ts`

普通消息主编必答；点名岗位真实创建任务；岗位先独立意见再汇总；确认生成不可变规划和分歧记录。

剧情任务固定创建婉儿（DeepSeek）与红玉（豆包）两个互不可见的初始意见任务；提交后才允许一轮有界交叉质疑。两者实际模型相同、任一缺席或提前共享答案时，不得标记为“异模型剧情讨论完成”。

### 任务6.3：写作门禁、工单和岗位资料包

**新增：**

- `apps/api/src/application/creation/writing-order-service.ts`
- `apps/api/src/application/creation/creative-mode-service.ts`
- `apps/api/src/application/creation/writer-lease-service.ts`
- `apps/api/src/contracts/writing-order.ts`
- `tests/integration/creation/writing-order.test.ts`
- `tests/integration/creation/creative-modes.test.ts`

**修改：**

- `apps/api/src/application/creation/writing-readiness-service.ts`
- `apps/api/src/application/creation/chapter-pipeline-service.ts`
- `apps/worker/src/executors/chapter-task-executor.ts`

四模式、五级输入、岗位最小包和“只有书名/一句写章”负面门禁进入测试。

工单冻结唯一活动写手（默认秋香Codex；接管时湘君DeepSeek）和 `writer_epoch`。副笔不默认生成第二份全文；接管或明确A/B任务才调用，晚到旧写手结果不能登记。

### 任务6.4：完整生成后三异模型全文点评

**新增：**

- `apps/api/src/application/creation/three-model-review-service.ts`
- `apps/api/src/application/creation/review-report-validator.ts`
- `apps/api/src/application/creation/review-report-merge-service.ts`
- `apps/api/src/application/creation/targeted-revision-service.ts`
- `apps/api/src/contracts/review-reports.ts`
- `tests/integration/creation/three-model-review.test.ts`
- `tests/integration/creation/review-independence.test.ts`
- `tests/integration/creation/ai-style-risk.test.ts`
- `tests/integration/creation/content-compliance-review.test.ts`
- `tests/integration/creation/revision-limit.test.ts`

完整草稿先持久化并哈希，再为同一版本并行调用文姬（GLM）、妲己（Kimi）和昭君（豆包）。三席模型快照彼此不同且与活动写手不同，报告提交前互不可见：GLM检查正史/时间/状态/知情/规则/伏笔；Kimi检查文学/人物/语言/节奏并返回 `ai_style_risk_score` 与实际标记段落占比；豆包检查体验并返回政治/情色风险的位置、证据、建议动作和策略版本。AI腔指标不是AI作者概率，合规筛查不是法律或平台保证。

三份报告齐全后主编只读取报告与引用片段，合并一张修改单；硬证据不按二比一投票，文学软意见保留分歧。最多两次定点修订，每个新稿重新跑三席；旧稿和旧报告不覆盖。任一席有限重试后仍不可用则明确受阻，不生成空报告、假模型结果或按量付费fallback。

### 阶段门禁与回滚

- 流程负面、取消竞态、三类坏JSON、模型超时、三席缺失/重复/错版本、与写手同模型、AI腔无证据/伪作者概率、政治情色无位置/错策略版本和预算竞争全部通过。
- 确定性假模型完成工程E2；真实模型没有凭证时明确停在相应证据等级，不伪造回复。
- 回滚创作策略指针，保留新增草稿和调用记录。

---

## 阶段7：资料工作台、检索诊断、可移植和本机运维

### 目标

实现最终信息架构、作者可见资料/图谱/缺口/水位、任务二级页、检索诊断、安全导入导出和设置诊断。

### 任务7.1：Web组件化与类型路由

**新增：**

- `apps/web/src/app/workspace-route.ts`
- `apps/web/src/app/WorkspaceShell.tsx`
- `apps/web/src/features/chat/ChatWorkspace.tsx`
- `apps/web/src/features/tasks/TaskCenter.tsx`
- `apps/web/src/features/planning/PlanningWorkspace.tsx`
- `apps/web/src/features/manuscript/ManuscriptWorkspace.tsx`
- `apps/web/src/features/manuscript/ReviewPanel.tsx`
- `apps/web/src/features/library/LibraryWorkspace.tsx`
- `apps/web/src/features/continuity/ContinuityWorkspace.tsx`
- `apps/web/src/features/retrieval/RetrievalDiagnostics.tsx`
- `apps/web/src/features/settings/SettingsWorkspace.tsx`
- `tests/integration/experience/workspace-navigation.test.tsx`

**修改：**

- `apps/web/src/app/App.tsx`
- `apps/web/src/app/app.css`

逐页从现有单体App提取，不一次重写。保持176/190px窄栏、右侧滚动显示11名成员且不因人数增加加宽、中心优先和移动抽屉。成员卡直接显示一句话职责；点击后打开公开岗位详情，展示职责/边界/激活条件/交付物/模型来源/当前任务/最后有效贡献/证据，但不返回原始系统提示或隐藏规则。道韫在无现实事实任务时必须显示待命且零调用。正文二级页展示三席真实状态、模型来源、证据问题、AI腔风险/标记段落占比和政治/情色风险免责声明。

### 任务7.2：资料API和有界图谱

**新增：**

- `apps/api/src/http/knowledge-routes.ts`
- `apps/api/src/http/retrieval-routes.ts`
- `apps/api/src/application/knowledge/library-query-service.ts`
- `apps/web/src/features/library/KnowledgeGraph.tsx`
- `tests/integration/experience/library-api.test.ts`
- `tests/integration/experience/library-ui.test.tsx`

**修改：**

- `apps/api/src/http/domain-routes.ts`

先拆知识/检索路由，减少巨型路由文件。关系/情绪/势力图只加载≤200节点/500边；地图使用作者坐标。Cytoscape按需动态导入并先做包体/键盘/销毁测试。

### 任务7.3：Schema 16与可移植包

**新增：**

- `apps/api/src/infrastructure/db/migrations/0016_portability_operations.sql`
- `apps/api/src/application/portability/book-export-service.ts`
- `apps/api/src/application/portability/book-import-service.ts`
- `apps/api/src/application/portability/import-validator.ts`
- `apps/api/src/http/portability-routes.ts`
- `tests/integration/portability/book-roundtrip.test.ts`
- `tests/fault-injection/malicious-import.test.ts`

表：`portable_operations`、`portable_manifests`、`portable_files`、`import_quarantine_checks`、`restore_impact_reports`。复制导入生成新ID；生产恢复走独立流程。

### 任务7.4：运维、指标和故障页

**新增：**

- `apps/api/src/application/operations/operations-service.ts`
- `apps/api/src/infrastructure/observability/structured-logger.ts`
- `apps/api/src/infrastructure/observability/secret-redactor.ts`
- `apps/api/src/http/operations-routes.ts`
- `tests/integration/security/secret-redaction.test.ts`
- `tests/integration/operations/degraded-mode.test.ts`

实现磁盘水位、队列、投影、备份、模型能力和脱敏诊断；不发送遥测。

### 阶段门禁与回滚

- 桌面1600×1000、窄屏500×844、键盘、200%缩放、空/错/降级/过期状态视觉证据。
- 恶意导入、路径、ZIP、SSRF、密钥扫描和复制导入零覆盖。
- UI可按路由/组件提交逐步revert；Schema只加不删。

---

## 阶段8：独立评测、全规模回放、恢复与发布

### 目标

完成E2工程证据和可在现有授权内完成的E3/E4证据；修复所有阻断Bug；生成桌面入口、说明、验收矩阵、提交和远程备份。

### 任务8.1：冻结独立评测资产

**新增：**

- `tests/evaluation/manifests/`
- `tests/evaluation/gold-retrieval/`
- `tests/evaluation/adversarial-hidden/`
- `tests/evaluation/creative-pairs/`
- `tests/evaluation/review-panel/`
- `tests/evaluation/content-risk/`
- `tests/evaluation/capacity/`
- `scripts/evaluation/run-retrieval-eval.mjs`
- `scripts/evaluation/run-capacity-replay.mjs`
- `scripts/evaluation/run-creative-ablation.mjs`

评测代码不得导入生产规则；保存清单哈希。先运行小样本验证评测器，再冻结500查询和全规模清单。

### 任务8.2：500万字符/1500章与多书回放

运行容量、混合检索、投影重建、每书切换、删除派生重建、备份临时恢复、五书隔离和中断续跑。保存目标电脑机器信息、时间、峰值资源、磁盘、p50/p95和失败修复。

### 任务8.3：创造性消融与真实模型闸门

在已有登录态/套餐且不产生未授权现金费用时运行E3盲化A/B和可完成的E4门禁。另运行固定三点评相对单Kimi、全员点评和只有确定性检查的缺陷检出/误报/漏报/创造性非劣效/Token/延迟对照，并验证AI腔风险不冒充作者概率、政治情色筛查不冒充法律或平台保证。缺少任一真实席位凭证或能力时停止该证据项，工程功能继续用假模型验证；发布报告明确最高等级。不得把假模型结果写成文学质量或真实三异模型点评。

### 任务8.4：最终发布门禁

**修改：**

- `docs/ACCEPTANCE.md`
- `docs/OWNER_GUIDE.md`
- `docs/USER_GUIDE.md`
- `README.md`
- `TASKS.md`
- `KNOWLEDGE.md`
- `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/ACCEPTANCE_MATRIX.md`
- `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/stages/08-release.md`

运行：

```powershell
npm run typecheck
npm test
npm run build
npm run migrate
npm run verify
npm run acceptance
npm run eval:retrieval
npm run eval:capacity
```

随后从干净临时目录做空库安装、旧库升级、桌面冷启动、Web/API/Worker健康、示例书全流程、导出/复制导入、备份临时恢复、离线降级、重启接管和全量安全扫描。

只有全部适用门禁通过且没有未说明待办、占位或假状态，才创建最终提交并推送私有远程。Git提交后再次在干净工作树跑最终门禁；证据记录提交哈希和远程分支。

### 阶段门禁与完成措辞

- E2全部阻断门槛必须通过；E3工程检索金标必须通过。
- 11人团队、双编剧、主编/主笔接管和三点评席的运行时/恢复/独立性/严格Schema门禁必须通过；三席不可用时的诚实受阻也必须通过。
- 真实模型/文学质量只声明实际达到的E3/E4跨度。
- 第二物理数据备份未配置时继续显示部署边界；远程Git只备代码，不冒充小说数据备份。
- 任一跨书、权威、迁移、恢复、秘密、取消提交、恶意导入或硬事实错误阻断release。

---

## 提交策略

每个阶段至少包含：迁移/合同、实现、UI（如有）、测试/证据四类小提交。提交信息示例：

- `feat(knowledge): add temporal lifecycle schema`
- `feat(retrieval): add evidence-lane orchestration`
- `test(retrieval): freeze adversarial source closure cases`
- `docs(release): record longform stage 4 evidence`

禁止修改历史已合并迁移、强推、硬重置、把模型资产/数据/密钥提交Git，或为了保持绿色删除失败测试。

## 最终回滚层级

1. 单任务：取消/恢复检查点。
2. 单投影：切回旧活动快照。
3. 单书：切回旧检索/连续性策略指针。
4. 单阶段：`git revert` 该阶段代码提交；Schema保留但停用。
5. 整个release：恢复开工前一致性快照并切回历史首版程序；生产数据恢复需要老板确认。

任何回滚都优先保留新增正文、草稿、聊天、正史版本和审计，不通过删除作者资产换取程序可运行。
