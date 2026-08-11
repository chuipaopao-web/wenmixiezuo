# 数据模型规格

## 1. 总原则

- SQLite是正式业务数据唯一权威。
- 所有书内核心记录包含 `owner_id` 与 `book_id`。
- 已合并迁移只向前追加，不修改、不删除。
- 正文和关键规划采用不可变版本；活动指针与历史版本分离。
- 摘要、全文、向量、图谱和Wiki均可从正式对象重建。

## 2. 身份、书籍与模型

- `user_accounts`：登录账号，保存规范化邮箱、昵称、密码盐值与摘要、角色、状态和最近登录时间；邮箱唯一，账号与 `owners` 一对一。
- `auth_sessions`：持久登录会话，只保存随机令牌摘要、到期时间、最近活动和撤销时间；不保存明文令牌。
- `auth_audit_events`：注册、成功/失败登录、退出、暂停和恢复审计；不进入模型上下文或作者导出。
- `owners`：每个注册账号对应的创作数据所有者，不再代表固定本机用户。
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

- `volume_plans`及版本表：活动卷纲、候选、模板实例与版本/哈希快照、作者输入、上游依赖和历史切换。
- `story_events`及版本表：卷内事件链、顺序、进入状态、因果触发、选择与代价、结果、结束钩子、下一事件接口、事件卡和事件大纲。
- 叙事模板注册表由后端统一版本化发布；活动规划只保存不可变模板引用与节拍快照，不依赖前端硬编码，也不允许规则更新原地改变旧规划。
- 模板推荐信号是按当前 `owner_id + book_id` 即时编译的非权威排序输入，来源限于开书资料、活动卷和最近真实卷结算，不写入正史。
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

### 资料库公开视图

- `entities.entity_type='character'`是稳定存储键，同时包含主角与配角；公开配角视图通过同书主角档案的`entity_id`和姓名确定性排除主角，不修改旧实体键。
- 设定来源、正式实体/事实、人物当前状态和正文事件时间线是四类不同投影视图，不能互相复制或替代。
- 主角状态使用`protagonist_state_entries`追加修订，`state_status`与`effective_chapter_number/story_time`表达获得、有效、消耗、失去、死亡、退役或归档及发生位置；历史永不由当前面板删除。
- 公开资料档案按实体类型聚合可选字段：配角身份/年龄/性格/归属/境界/实力/属性/装备/关系，势力负责人/规模/实力/等级/驻地/地位/成员，地点类型/上级区域/方位/特点，道具资源类型/等级/属性/效果/数量/归属/状态/流转。聚合结果是可重建查询视图，底层仍以实体、正式事实、状态历史和不可变来源为准；缺失值不补造。
- 地点资料与世界路线图分开。路线节点来自地点首次正式出现或作者确认出生地，边来自章节先后或明确移动事实；无方向证据时方向为空，不持久化虚构坐标。
- 作者事件时间线由已结算`story_events`、章节覆盖、`stage_settlements`及正文事实聚合；规划版本只提供后台归属，实际状态必须来自结算。正文没有明确故事时间时保存空值，公开`display_time`回退为章节范围，不伪造日期。
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

## 11. 账号数据不变量

- 规范化邮箱全局唯一；一个账号只绑定一个 `owner_id`，一个 `owner_id` 只绑定一个账号。
- 首个注册账号在同一写事务中成为管理员；至少保留一个活动管理员。
- 密码、密码盐值、会话令牌或令牌摘要不得进入公开 API、日志、模型上下文、书籍导出或检索投影。
- 账号暂停立即撤销该用户全部活动会话，不删除其书籍和创作数据。
- 书籍、任务、附件、检索和 SSE 的 `owner_id` 只能来自登录会话；客户端提交值不能扩大权限。
