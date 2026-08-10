# 数据模型规格

## 1. 总原则

- SQLite是正式业务数据唯一权威。
- 所有书内核心记录包含 `owner_id` 与 `book_id`。
- 已合并迁移只向前追加，不修改、不删除。
- 正文和关键规划采用不可变版本；活动指针与历史版本分离。
- 摘要、全文、向量、图谱和Wiki均可从正式对象重建。

## 2. 身份、书籍与模型

- `owners`：本地所有者。
- `books`：书籍、状态、版本、正史修订和活动主编epoch。
- `book_onboarding_profiles`、`positioning_versions`、`book_expression_profiles`：开书原始资料、定位与表达基线版本。
- `role_templates`、`agent_instances`：岗位模板和逐书Agent实例。
- `model_config_snapshots`、`agent_model_bindings`：不可变模型快照与活动绑定。
- `editor_leases`、`writer_leases`：主编和写手租约。
- `budgets`、`budget_reservations`、`usage_ledger`：调用预算和结算。

## 3. 作者输入与附件

- `author_planning_inputs`：作者附着于设定、卷、事件、章纲或正文的原话，保存意图等级、版本和状态。
- `author_input_links`：作者输入与生成任务/候选的有序关联。
- `author_attachments`：作者附件正式对象，保存原件、解析状态、摘要、绑定对象和来源；当前规划链接类型统一为 `author_attachment`。
- 0042迁移将旧库中的附件表原位升级，不复制或删除附件内容；`origin_record_id` 与 `origin_attached_at` 只保留历史来源，不进入当前作者接口或创作语义。

## 4. 设定协作

- `setting_outline_workspace`：当前设定项、状态、候选和确认结果。
- `discussions`、`discussion_participants`、`discussion_opinions`、`discussion_decisions`：对象化AI提案、独立意见与主编整理记录。
- 独立提案保存真实Agent、模型快照和输出；作者选择、组合、修订和确认另行记录。

## 5. 卷—事件—章纲规划

- `volume_plans`及版本表：活动卷纲、候选、模板实例、作者输入、上游依赖和历史切换。
- `story_events`及版本表：卷内事件链、顺序、因果衔接、事件卡和事件大纲。
- `event_chapter_outlines`及版本表：当前事件章链、章节详细章纲、预计字数和上游版本引用。
- `planning_settlement_assessments`：事件/卷计划与实际差异及下一层承接。

规划对象描述未来，不直接写入正史。活动版本必须引用活动上游版本；上游改变后旧候选标记过期。

## 6. 章节与正文

- `volumes`、`chapters`：物理卷与章节目录。
- `manuscript_versions`：完整不可变正文版本。
- `writer_selections`、`chapter_work_orders`：活动写手与冻结写作工单。
- `review_reports`、`editor_review_syntheses`：事实、文学、体验独立报告和可执行修订清单。
- `chapter_settlements`及派生表：定稿后实际发生内容、人物状态、伏笔和投影更新。

## 7. 正史、知识和检索

- 正史事实、实体、关系、时间线、开放线程和来源表：只接收作者确认资料或定稿结算。
- `chunk_snapshots`与检索块：不可变切片快照和原子活动指针。
- FTS表：关键词与短语检索投影。
- LanceDB：本地向量投影，可删除重建，不能成为事实源。
- Wiki、图谱、摘要：派生导航，必须保留来源指针。

## 8. 任务、调用与审计

- `tasks`、`task_attempts`、`task_phases`、`task_dependencies`：持久任务、尝试、检查点和依赖。
- `context_packs`：每次调用冻结的来源清单、预算、哈希和排除项。
- `model_calls`、`model_call_results`、`model_call_reconciliations`：模型调用、结果与中断调和。
- `projection_outbox`、`projection_jobs`：正式事务到可重建投影的可靠交接。
- 操作、备份、恢复、永久删除墓碑和安全审计表记录不可逆或高风险动作。

## 9. 迁移与保留

已合并迁移保持不可变，新增结构使用向前迁移。作者原件、正式正文、任务来源和恢复记录按数据生命周期保留；永久清理作者数据只能通过书籍彻底删除流程执行。

迁移中的旧表名、旧字段名和旧任务类型只承担升级或恢复职责，不得作为当前Repository、路由、检索源或作者界面契约。


## 10. 关键不变量

- 跨书查询结果必须为0。
- 一个书内同一层级最多一个活动版本。
- 正文修改必然产生新版本。
- 投影删除或损坏不能破坏正式源。
- 未确认候选不能升级为正史。
- 任务结果提交必须通过租约、attempt、书籍和主编epoch校验。

## 作者可见名称与稳定关联键

功能显示名与持久化关联分离：

| 作者看到的名称 | 稳定功能键 | 作者输入 surface | 主要正式对象 |
|---|---|---|---|
| 信息 | framework | book_profile | 开书信息与书籍档案 |
| 设定 | basic | setting | 设定活动版本、候选与基线 |
| 分卷 | master | volume_plan | volume_plans及版本 |
| 规划 | event | event | story_events、事件链与事件大纲版本 |
| 章纲 | chapter | chapter_outline | event_chapter_outlines及版本 |
| 正文 | manuscript | manuscript | manuscript_versions |
| 资料库 | library | 无直接作者输入面 | 可重建资料、图谱与来源投影 |
| 取名 | naming | 无固定surface | 命名候选与占用记录 |

团队、任务、灵感和设置是工具域，不改变上述创作对象的数据库身份。显示名称改动不得修改已合并迁移、表名、枚举、对象ID或历史来源文字。已有历史文字通过作者展示层只读转换，新数据继续使用稳定键建立关联。
