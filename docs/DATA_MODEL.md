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
- `user_memberships`：会员当前状态，每账号至多一条，保存套餐、算力值配额、周期起止、状态与经办管理员；算力值消耗按 `usage_ledger` 周期内汇总，不单独存储余额。
- `membership_transactions`：会员开通、续费与撤销的不可变流水，保存套餐、真实实收金额、周期、经办人和备注；当前会员状态更新不能覆盖历史收入。
- `user_feedback`、`admin_issue_records`：作者反馈原件及管理员对失败任务/反馈的处理状态、严重程度和备注；反馈绑定书籍或任务时必须校验作者所有权。
- `auth_audit_events`：注册、成功/失败登录、退出、暂停和恢复审计；不进入模型上下文或作者导出。
- `owners`：每个注册账号对应的创作数据所有者；首位管理员复用历史本机老板所有者，后续账号各自新建所有者。
- `books`：书籍、状态、版本、正史修订和活动主编epoch；同一 `owner_id` 的未永久删除书籍在应用写事务内执行标准化书名唯一检查，归档书也占用名称，不同所有者互不影响。历史同名书保持原样，永久删除后名称可复用。
- `book_onboarding_profiles`、`positioning_versions`、`book_expression_profiles`：开书原始资料、定位与表达基线版本。
- `book_branding_designs`：主编设计书名或书籍简介的任务记录、候选方案和来源指纹；采用结果写回开书蓝图的不可变新版本，不原地覆盖。
- `role_templates`、`agent_instances`：岗位模板和逐书Agent实例。
- `model_config_snapshots`、`agent_model_bindings`：不可变模型快照与活动绑定。
- `editor_leases`、`writer_leases`：主编和写手租约。
- `budgets`、`budget_reservations`、`usage_ledger`：调用预算和真实结算；输入/输出用量、模型、调用次数和现金微元是API成本统计权威源。
- `platform_prompt_overrides`：平台补充提示词的版本链和活动指针语义；按真实任务类型、岗位和阶段匹配，只作用于未来调用。
- `model_call_prompt_snapshots`：每次新模型调用的最终任务提示词、补充要求和命中的平台覆盖快照；不保存思维链。
- `narrative_method_overrides`：后台叙事方法的版本化内容与启停状态；基础方法仍由代码版本提供，作者公开投影不返回专业来源。
- gent_role_pools_v6、gent_member_settings_v6、gent_skill_versions_v6：七类岗位池、逐书成员启停与不可变岗位 Skill 版本；作者投影只公开头像、姓名、岗位、供应公司、消耗档位和状态。

## 3. 作者输入与附件

- `author_planning_inputs`：作者附着于设定、卷、事件、章纲或正文的原话，保存意图等级、版本和状态。
- `author_input_links`：作者输入与生成任务/候选的有序关联。
- `author_attachments`：作者附件正式对象，保存原件、解析状态、摘要、绑定对象和来源；当前规划链接类型统一为 `author_attachment`。
- 0042迁移将旧库中的附件表原位升级，不复制或删除附件内容；`origin_record_id` 与 `origin_attached_at` 只保留历史来源，不进入当前作者接口或创作语义。

## 4. 设定协作

- `setting_outline_workspace`：当前设定项、状态、候选和确认结果。
- `setting_outline_item_versions`：设定项不可变版本链；每次确认追加一条版本并记录来源（manual/guidance/discussion），当前生效内容仍以 `setting_outline_workspace` 为准。
- `setting_proposal_fragments`：设定类目中作者所选1—4名编剧提案拆出的可勾选碎片；按提案落库，解析失败时以整份方案作单条 implicit 碎片兜底。
- `setting_fusion_drafts`：主编按作者勾选碎片产生的融合稿；保存所选碎片、段级来源标记（fragment/stitch）与融合正文，按设定项取最新一份。
- `discussions`、`discussion_participants`、`discussion_opinions`、`discussion_decisions`：对象化AI提案、独立意见与主编整理记录。
- 独立提案保存真实Agent、模型快照和输出；作者选择、组合、修订和确认另行记录。

## 5. 卷—事件—章纲规划

- `volume_plans`及版本表：活动卷纲、候选、模板实例与版本/哈希快照、作者输入、上游依赖和历史切换。
- `story_events`及版本表：卷内事件链、顺序、进入状态、因果触发、选择与代价、结果、结束钩子、下一事件接口、事件卡和事件大纲。
- 叙事模板注册表由后端统一版本化发布；活动规划只保存不可变模板引用与节拍快照，不依赖前端硬编码，也不允许规则更新原地改变旧规划。
- 模板推荐信号是按当前 `owner_id + book_id` 即时编译的非权威排序输入，来源限于开书资料、活动卷和最近真实卷结算，不写入正史。
- `event_chapter_outlines`及版本表：当前事件章链、章节详细章纲、预计字数和上游版本引用。
- ook_storyline_topology_versions、storylines/storyline_versions、storyline_relations、storyline_volume_participations：全书故事线拓扑、各线不可变版本、线间关系及逐卷参与责任。
- `character_cards`/`character_card_versions`、`character_storyline_links`、`event_role_assignments`：正式角色卡版本、角色与故事线关联及事件功能到角色的可追溯绑定。
- `creative_ledger_entries`：故事线、关系/势力、时空资源、因果、伏笔和三级结算统一总账；`truth_status=planned|actual` 强制区分规划与真实发生。`n- `storyline_frontier_versions`、`storyline_open_questions_v6`、`storyline_growth_rounds_v6`、`storyline_growth_candidates_v6`、`storyline_growth_decisions_v6`：作者最远节点、开放问题、提炼轮次、AI候选和作者决策的版本化增长记录。`n- `storyline_settlement_projection_receipts_v6`：卷/事件/章节结算投影的幂等收据；历史总账即使存在重复记录也不删除。
- uthor_object_drafts、workflow_invalidations_v6、object_reopen_records、core_workflow_states_v6：作者草稿、上游变化影响、重开版本记录和五阶段状态。
- internal_structure_method_scopes：内部结构方法到书/线/卷/事件/内容类型作用域的版本化映射；作者公开页面只接收白话标签。
- 章纲挑战意见不是正式规划对象，不新增真相表；它随任务检查点、上下文包和模型调用保存，并冻结目标候选版本。作者主动修改或重新生成后，新的章纲版本才成为正式候选。
- `planning_settlement_assessments`：事件/卷计划与实际差异及下一层承接。

规划对象描述未来，不直接写入正史。活动版本必须引用活动上游版本；上游改变后旧候选标记过期。

## 6. 章节与正文

- `volumes`、`chapters`：物理卷与章节目录。
- `manuscript_versions`：完整不可变正文版本。
- `writer_selections`、`chapter_work_orders`：活动写手与冻结写作工单。
- `review_reports`、`editor_review_syntheses`：事实、文学、体验独立报告和可执行修订清单。
- chapter_editor_synthesis_requests：仅在作者主动要求时保存主编汇总请求、精确正文版本和三席报告集合；不会自动触发，也不写入章节事实。
- `chapter_settlements`及派生表：定稿后实际发生内容、人物状态、伏笔和投影更新。

## 7. 正史、知识和检索

- 正史事实、实体、关系、时间线、开放线程和来源表：只接收作者确认资料或定稿结算。

### 资料库公开视图

- 作者可见界面统一称“配角”；`entities.entity_type='character'`只是稳定内部存储键，同时包含主角与配角，不能被前端直接当作“配角”分类。公开配角视图通过同书主角档案的`entity_id`和姓名确定性排除主角，不修改旧实体键。
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
- `context_packs`：每次正式模型调用冻结的来源清单、预算、哈希和排除项。逐项设定另从活动 `setting_outline_workspace` 即时派生非正史临时摘要包并写入任务快照；它可删除重建，不是正式设定基线。条目修改或全部清空后，新任务按最新内容重新编译，旧快照只留审计。
- `model_calls`、`model_call_results`、`model_call_reconciliations`：模型调用、结果与中断调和。
- i_node_author_inputs_v6、i_node_batches_v6、i_node_batch_members_v6、i_node_results_v6：节点作者输入版本、统一资料包批次、逐成员独立执行与结果；同批成员共享 ContextPack/hash，失败成员可单独重试或换人。
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

| 作者页面 | V6 阶段键 | 保留的历史/关联键 | 主要正式对象 |
|---|---|---|---|
| 设定 | setting | basic / setting / book_profile | 开书资料、设定活动版本、候选与基线 |
| 故事线 | storyline | topology（历史只读）/ storyline | 滚动故事线版本、事实推进、作者最远节点、开放问题、候选决策、关系与逐卷参与 |
| 分卷 | volume | master / volume_plan | volume_plans及版本、表达方案与线路编排 |
| 事件 | event | event | story_events、事件链、角色安排与事件大纲版本 |
| 章节 | chapter | chapter_outline / manuscript | 章链、章纲、manuscript_versions、三席审查与结算 |
| 资料库 | library | 无直接作者输入面 | 可重建资料、图谱与来源投影 |
| 取名 | naming | 无固定surface | 命名候选与占用记录 |

团队、任务、灵感和设置是工具域，不改变上述创作对象的数据库身份。`framework→setting`、`manuscript→chapter` 等旧键只在入口解析层重定向；已合并迁移、表名、枚举、对象ID和历史来源文字不改名，也不保留第二套业务页面。已有历史文字通过作者展示层只读转换，新数据按 V6 阶段键与稳定业务对象建立关联。
## 11. 账号数据不变量

- 规范化邮箱全局唯一；一个账号只绑定一个 `owner_id`，一个 `owner_id` 只绑定一个账号。
- 首个注册账号在同一写事务中成为管理员；至少保留一个活动管理员。
- 历史本机老板所有者只能由首位管理员接管一次；接管只更新账号到所有者的一对一关联，不复制或改写任何书籍与创作对象。第二个及以后账号不得复用该所有者。
- 密码、密码盐值、会话令牌或令牌摘要不得进入公开 API、日志、模型上下文、书籍导出或检索投影。
- 账号暂停立即撤销该用户全部活动会话，不删除其书籍和创作数据。
- 书籍、任务、附件、检索和 SSE 的 `owner_id` 只能来自登录会话；客户端提交值不能扩大权限。

## 分层设计的兼容数据

- 活动设定核心键固定为world-stage、social-order、rules-costs、boundaries-blanks。protagonist-situation、story-kernel、opposition、supporting、relations和旧人物关系扩展等键只做历史兼容：可从当前工作区移除并归档活动检索片段，但不可变版本、正文和结算不永久删除。
- 卷内容JSON可选保存routeCard、storySpine和firstVolumeLaunch；旧卷缺失时解析成功，新卷确认后随版本不可变。
- 内部叙事方法保存版本、方法键和任务快照，作者公开投影不保存或返回专业名称。
- 设定融合选择保存稳定方案ID、完整方案ID列表、片段来源和作者文字，不保存依赖前端排序的数组下标。
- ContextPack不可变来源清单保存约束强度、真值状态、业务范围和依赖，并参与来源指纹。
