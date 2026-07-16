# 数据模型规格

## 1. 总原则

- SQLite是权威结构化事实源；正文文件是权威内容资产；FTS、缓存和图谱是可重建投影。
- 除全局模板外，所有核心记录必须携带 `owner_id` 和 `book_id`。
- Repository自动注入隔离键；不得依赖调用者手写 `WHERE book_id` 作为唯一保护。
- 所有可变业务对象携带版本、创建时间、修改时间和来源。
- 正文、决定、正史和配置采用不可变版本加当前指针，不做无痕覆盖。

## 2. 身份与书籍

### `owners`

当前只有老板一人，但保留稳定 `owner_id`，不把用户身份散落硬编码在业务代码中。

### `books`

最低字段：`book_id`、`owner_id`、书名、生命周期状态、定位版本、正史版本、活动主编、`editor_epoch`、创建与修改时间。

生命周期：

```text
draft → active → paused → archived
                         ↘ restoring → active
                         ↘ purging → purged
```

### `book_configs` / `positioning_versions`

保存题材、分类、标签、文风、质量规则、预算模式和适配快照。字段来源标记为老板明确、系统推断、未指定或冲突。

## 3. 岗位、Agent和主编

### `role_templates`

保存9个岗位模板的简短职业名称、职责、提示、能力要求、工具、数据范围和确认门禁。模板版本化；完整职责不得塞入岗位显示名。

### `agent_instances`

保存 `agent_id`、`owner_id`、`book_id`、岗位模板、女性成员姓名、模型配置快照、权限、启用状态和健康状态。`display_name` 是成员姓名，岗位短名来自版本化岗位模板。

### `model_config_snapshots`

保存供应商、模型、参数、支持模态、工具能力和验证时间。不得保存API Key。

### `editor_leases`

每书只有一条有效活动租约，包含活动主编、候任主编、`editor_epoch`、过期时间、接管状态和接管ID。旧epoch的命令在应用服务层拒绝。

## 4. 对话、讨论和决定

### `conversations` / `messages`

消息绑定书籍、发送者Agent实例、岗位、真实模型来源、消息类型、引用、版本和创建时间。聊天意见默认不属于正史。

### `discussions`

保存 `discussion_id`、范围、参与岗位、讨论类型、`discussion_epoch`、状态、预算、当前阶段和来源版本。

讨论状态：

```text
collecting
→ cross_review
→ synthesizing
→ reviewing_draft
→ awaiting_boss
→ confirmed | rejected | abandoned | superseded
```

### `discussion_opinions` / `discussion_decisions`

每条意见记录真实Agent和模型来源。决定记录候选、推荐、分歧、老板确认、影响范围和替代关系。

## 5. 规划与稿件

### `artifacts`

统一保存创作方案、故事圣经、总纲、卷纲、章纲、写作契约和其他结构化成果的版本元数据。不同类型通过Schema和版本化模板约束。

### `volumes` / `chapters`

章节保存顺序、计划状态、生成状态、结算状态、当前稿件、当前正史正文和章末状态指针。

### `manuscript_versions`

保存完整不可变稿件的元数据：书籍、章节、父版本、作者Agent、真实模型、来源任务、文件路径、内容哈希、字数、状态、创建时间和确认信息。

推荐状态：

```text
draft → candidate → under_review → approved → canon
                       ↘ rejected
```

`approved` 表示老板或主编选中但尚未完成章节结算；`canon` 表示审校、事实和正史结算全部通过。

## 6. 任务、阶段与调用

### `tasks`

保存 `task_id`、`release_id`、`owner_id`、`book_id`、章节、任务类型、负责人、任务书、状态、依赖、幂等键、预算和停止条件。

任务状态至少包含：

```text
pending → queued → working → waiting_confirmation → succeeded
                    ↘ paused | blocked | interrupted | failed | cancelled
```

### `task_phases` / `task_events`

阶段记录 `entered_at`、`heartbeat_at`、结构化数据、输入版本、产物和下一步。事件用于审计和SSE回放。

### `model_calls` / `tool_calls`

保存 `request_id`、任务、阶段、Agent、模型或工具、输入上下文包、参数哈希、状态、Token、费用、耗时、错误分类和结果引用。

### `worker_health`

保存进程、启动时间、能力、检查结果和心跳。状态过期时只能显示“可能未运行”，不能伪装空闲。

## 7. 记忆与上下文

### `memories`

保存记忆类型、`owner_id`、`book_id`、可选 `agent_id`、内容、来源、事实状态、有效故事时间、有效章节、版本、重要度和失效信息。

### `context_packs`

每次模型调用生成不可变记录：任务、Agent、书籍、正史版本、资料清单、资料顺序、压缩方式、Token预算、总Token和内容哈希。

### `retrieval_records`

保存查询、过滤条件、召回结果、版本、分数、来源和采用情况，便于复现遗漏或错误引用。

## 8. 知识与正史

### `entities`

实体类型包括人物、地点、组织、道具、资源、技能、属性面板、世界规则、事件、伏笔和钩子。类型和字段通过版本化Schema扩展。

### `fact_assertions`

事实采用断言结构，至少包含主体、关系或属性、值、故事时间、证据、来源章节、来源版本、事实等级和状态。

### `canon_bindings` / `canon_revisions`

正史绑定保存事实与有效正史版本的关系。任何正史变化创建新 `canon_revision`，不覆盖历史。

事实等级：

- A：候选，不进入默认正史上下文；
- B：低风险、证据明确、无冲突，可按版本化规则受控自动生效；
- C：需要活动主编复核；
- D：人物生死、世界规则、主线、核心关系等重大变化，必须老板确认。

### `confirmations`

保存确认对象、旧值、新值、范围、影响、版本、严格确认状态和 `confirmation_id`。正文准确执行既有确认时可以复用，不得超范围复用。

### `conflicts`

保存问题位置、类型、严重度、证据、影响、状态、处理结果和接受风险信息。

## 9. 分析投影

人物档案、时间线、关系图、情绪曲线、主支线、钩子和信息差图谱从正史事实和正式正文重建。投影携带来源 `canon_revision`，不能反向成为第二套正史。

## 10. 研究与版权

### `research_sessions` / `research_sources`

保存研究目的、地区、语言、查询、来源、发布时间、检索时间、哈希、可信度、短摘录和主张—证据关系。网络内容标记为不可信输入，不能直接进入正史。

### `source_imports` / `structure_cards` / `copyright_reviews`

拆书资料绑定使用意图、来源和授权状态。原文区与创作区物理和查询隔离；结构卡只保留抽象功能。版权审查分维度记录证据和阻断结果，不能使用单一综合分数放行。

## 11. 预算、文件和恢复

### `budgets` / `usage_ledger`

按全局、书籍、任务和滚动窗口冻结、结算Token、现金费用、调用次数和耗时。

### `file_registry`

保存文件ID、书籍、章节、版本、路径、哈希、大小、状态、归档位置和操作序号。数据库指针与正文文件必须能够双向校验。

### `operations` / `recovery_log`

使用稳定 `operation_id` 记录正文提升、结算、备份、恢复、导入、归档和删除的每个可恢复步骤。

### `backups` / `backup_files`

保存快照、文件清单、哈希、验证结果和真实恢复演练证据。不完整或损坏备份不可用于恢复。

### `deletion_tombstones`

永久删除后保存不可变墓碑，旧备份导入时必须阻止已删除对象复活。

## 12. 数据库约束测试

必须覆盖：

- 所有Repository查询自动携带 `owner_id` 和 `book_id`；
- 两本书的消息、任务、正文、记忆、FTS、预算、租约和缓存零串线；
- 新书9个Agent实例原子创建；
- 同书只能有一个活动主编租约；
- 前章未结算时后章不能启动；
- 正文哈希、文件清单和数据库指针一致；
- D级事实未确认时不能结算；
- 旧 `editor_epoch`、旧 `canon_revision` 和旧定位版本的写入被拒绝；
- 迁移空库、重复执行和已有数据升级安全。
