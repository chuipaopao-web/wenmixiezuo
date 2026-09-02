# V7 卷/链/章字数门禁全类修复（资料自动降级，不让作者管内部预算）

任务编号：V7-CREATION-CHAR-BUDGET-81

本次唯一清单：`coauthoring-v7/docs/worklists/V7-CREATION-CHAR-BUDGET-RECOVERY-20260902-81.md`

任务类型：作者端推进阻断 BUG 修复、字数门禁全类收敛

当前问题：生产作者在卷页推进任务时失败，报"对不起，当前资料策划候选仍有18349字，超过本步骤18000字的安全范围。请先缩小本次正式资料范围，再重新开始。"。与第80批同属"推进阻断"类问题，但根因是字数门禁：资料策划候选目录在确定性压缩后仍超出单次调用硬限，系统把内部预算管理责任抛给作者，违反第79批 REQ-04（作者不管理内部字数/token 预算）。

## 排查证据（2026-09-02）

报错文案精确匹配 `assertCreationContextPlannerInputBudget`（apps/api/src/application/creation/v7-creation-context-compiler.ts:596-612，409 retryable）。`compileCreationContextPlannerPrompt`（614-649）共三层：完整提示 → 可选源最小目录 → `minimumPlannerDirectoryCandidate`（1079-1110）。关键缺陷：`minimumPlannerDirectoryCandidate` 首行 `if (source.required) return source;`——必要正式源（开书资料投影、设定事实账本投影、已确认树投影）在任何层级都不压缩。内容丰富的书（多卷树、大设定账本）即使最小目录也超限，直接 409，作者被要求"缩小正式资料范围"——但作者既控制不了也看不到这些内部投影。

同字数门禁类（一次全处理）：

- Gate 1：资料策划输入预算（v7-creation-context-compiler.ts:605，volume 18k/chain 14k/其余 12k）——本批直接病因。
- Gate 2：资料包预算（v7-creation-context-compiler.ts:682-690，volume 12k/chain 8k/其余 6k），轻量索引层后仍超限时抛错并要求作者"减少原文回查项或重建设定事实账本"。Gate 1 修复后同一本书大概率立刻撞上本门禁。
- Gate 3：规划树生成源快照预算（v7-planning-source-compiler.ts:252-260，book 18k/volume 14k/chain 10k），无任何降级层级，逐项设定全文随条目数线性增长；时光机/卷/链树生成同源。
- Gate 4：设定总审轻量索引（v7-setting-editorial-service.ts:3418-3420，12k），语义索引层后仍超限直接失败。
- 已核实非同类：v7-planning-tree-generation-service.ts:976-980 与 v7-runtime-prompt-compiler.ts:356 均为输出上限（maxOutputTokens），不是输入门禁；v7-setting-editorial-service.ts:3481 为单条目正文本身超限，属真实数据上限，保留真实失败。

## 修复设计（确定性降级，不做语义取舍，不伪造成功）

- Gate 1：新增第 4 层——必要正式源也压缩为 `{kind, name}` 目录项（必要源反正必须入选，`parseContextSelection` 强制保留，其完整内容仍经 `compilePack` 原样/轻量进入资料包，不丢失）。第 3 层（必要源全量+可选源最小目录）保持优先。四层全超限才真实失败。
- Gate 2：轻量索引层后新增限长层——对带 `selectionContent` 的入选源做确定性递归限长（每字符串字段封顶 200 字，结构、条目、来源键全保留，`contextPolicyVersion` 升为 `layered-context-v4`）。仍超限才真实失败。
- Gate 3：新增两层——(a) 逐项设定源降级为语义索引（保留 schema/itemKey/label/contextSummary（限长）/factCount，`planningSettingItemKey` 别名归一与资料策划 sourceId 合同不受影响）；(b) 全源递归限长。仍超限才真实失败。
- Gate 4：新增最小目录层——逐项条目只保留 itemKey/label/groupTitle/revision，规则文案同步调整（不猜事实、返回空 factLedger），`allowPatches` 保持 false。仍超限才真实失败。
- 三处作者可见报错统一改写：先道歉、说明资料完好无损、给出可执行恢复（设定页让主编重新整理事实账本/反馈联系我们），删除一切"请作者缩小资料范围"的内部预算责任转移。保留"超过本步骤X字的安全范围"数字短语便于排查。

## 允许修改

- apps/api/src/application/creation/v7-creation-context-compiler.ts（Gate 1/2 + 导出递归限长助手）
- apps/api/src/application/planning/v7-planning-source-compiler.ts（Gate 3）
- apps/api/src/application/books/v7-setting-editorial-service.ts（Gate 4）
- tests/unit/v7-creation-context-compiler.test.ts、tests/integration/domain/v7-planning-source-snapshots.test.ts、tests/integration/domain/v7-setting-editorial-department.test.ts 及相关测试
- 本清单与交接记录

## 明确不改

- 预算常量数值（V7_CREATION_CONTEXT_CHAR_BUDGETS / PLANNER_CHAR_BUDGETS / planningBudgetChars / 12000）；数据库语义；成员与模型绑定；`parseContextSelection` 合同；`sourceFingerprint` 口径（内容哈希不变，历史成功结果仍可复用）；设定原文、正式树、结算等正式数据本身。

## 必须保留

- owner_id/book_id 隔离；正式/实际来源不可变版本；失败真实不静默（降级只作用于传输投影与目录，精确原文仍在快照/追溯链路）；作者不管理内部预算（第79批 REQ-04）；报错先道歉再给恢复（第79批 REQ-05）。

## 验收标准

- ACC-01 生产同构（必要源投影超限）场景下，volume/chain/outline 等全部 taskKind 的资料策划调用能以第 3/4 层目录成功编译，不再要求作者缩小资料。
- ACC-02 Gate 2/3/4 超限时依次进入降级层并成功，降级产物保留全部来源键与条目，字符串字段限长且有版本标记可追溯。
- ACC-03 四层/三层全超限时仍真实失败，报错不含"请作者缩小资料范围"类措辞，先道歉、说明资料完好、给出恢复入口。
- ACC-04 `sourceFingerprint` 与 `parseContextSelection` 行为不变；既有测试回归通过。

## 测试范围

- 单元：资料策划四层降级（必要源超限成功编译 + 极端规模仍真实失败且文案合规）；限长助手确定性。
- 集成：规划源快照超限降级（逐项设定变语义索引，itemKey/别名归一保持）；设定总审最小目录层；创作流水线既有回归。
- 类型检查 + 受影响测试套件；API 有改动，按发布门禁走全量验证后部署。

## 部署要求

API/Worker 行为有变化（API 为主）：走完整发布流程（备份、30 秒零在途任务、按服务切换、迁移 no-op 核对），静态端若无改动可同批携带；部署后公网健康检查 + 用生产同构数据验证卷页可推进。回滚点为第80批。

design_review_id：DR-V7-CHAR-BUDGET-81（创作上下文编译与规划快照降级变化）

## 实现记录（2026-09-02）

按修复设计全部落地，另发现并修复一个同类潜在阻断（事实账本 40 条解析上限）：

- Gate 1（v7-creation-context-compiler.ts）：`minimumPlannerDirectoryCandidate` 增加 `includeRequired` 参数，必要正式源在第 4 层压缩为 `{kind, name}` 目录项；`compileCreationContextPlannerPrompt` 变为四层（完整 → 可选源最小目录 → 必要源全量最小目录 → 全量最小目录），四层仍超限才失败。报错改写为道歉+资料完好+反馈入口，保留"超过本步骤X字的安全范围"。
- Gate 2（同文件）：轻量索引层后新增限长层，导出 `boundProjectionTexts(value, maximum)`（递归封顶每字符串字段 200 字，结构与非字符串值保留，超长以 `…` 截断标记）；`contextPolicyVersion` 升为 `layered-context-v4`（coauthoring-v7/backend/creation-runtime/creation-runtime-contracts.ts 的 ContextPack 联合类型同步扩宽）。报错改写为道歉+指向设定页重整事实账本。
- Gate 3（v7-planning-source-compiler.ts）：新增 measure + 三层降级——(a) `lightPlanningSettingSource` 逐项语义索引（跳过账本源与非设定源，保留 schema='v7-setting-fact-source-v1'/itemKey/label/contextSummary/factCount）；(b) 递归限长 200；(c) `minimalPlanningSettingSource` 仅 {schema, itemKey, label}（保住 `planningSettingItemKey` 别名合同）。全超限才失败，报错同口径改写。
- Gate 4（v7-setting-editorial-service.ts）：语义索引超 12000 时新增最小目录层（每条目 itemKey/label/groupTitle/revision + 限长 48 字 contextSummary + factCount，新增 `boundIndexText` 助手），`allowPatches: false`，规则改为不凭一句话索引改写、返回空 patches、只摘录索引已明确表达的 1 条核心事实。
- **额外发现并修复**：`parseBatchFinalReview` 用 `finalObjectArray` 把事实账本截为最多 40 条，但 factLedger 必须逐项覆盖全部条目——**设定超过 40 条的书永远无法通过总审解析**（先解析失败再修复也失败）。新增 `finalObjectArrayOfLength(value, label, items.length)`，factLedger 上限跟随条目数；其余数组保持 40 上限。与本次"大书无法推进"同类根因。

## 测试证据（2026-09-02，vitest run）

- tests/unit/v7-creation-context-compiler.test.ts：10/10 通过——新增"必要正式源在第 3 层超限降到第 4 层最小目录仍成功编译且不泄漏精确内容"、"四层降级后仍超限时真实失败（文案含道歉/反馈、不含'缩小'）"、"boundProjectionTexts 只封顶字符串并完整保留结构/条目/非字符串值"三组用例。
- tests/integration/domain/v7-planning-source-snapshots.test.ts：9/9 通过——新增"逐项设定事实超过快照预算时自动降级为语义索引"（80 条设定触发降级，产物为最小形态，保留 itemKey/schema，无 facts/contextSummary，精确原文不进目录）。
- tests/integration/domain/v7-setting-editorial-department.test.ts：33/33 通过——新增"语义索引仍超限时总审自动降到限长一句话索引"（45 条设定，reviewPrompt 含 layered_semantic_index 与一句话索引标记，≤12000 字，factLedger 45 条逐项覆盖；该用例正是暴露 factLedger 40 条上限缺陷的用例）。
- tests/integration/domain/v7-creation-pipeline.test.ts：与设定套件合并运行 49/49 通过——两处 `contextPolicyVersion` 断言扩宽为含 `layered-context-v4`。
- tests/integration/domain/v7-planning-trees.test.ts + v7-planning-editorial-runtime.test.ts + tests/unit/v7-prompt-context-governance.test.ts：18/18 通过。
- 类型检查：@wenmi/v7-backend 重建后 apps/api 与 apps/worker `tsc --noEmit` 均干净（首次报错因 dist 陈旧，重建即消）。
