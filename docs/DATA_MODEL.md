# 数据模型规格

## 1. 总原则

- SQLite是正式业务数据唯一权威。
- 所有书内核心记录包含 `owner_id` 与 `book_id`。
- 已合并迁移只向前追加，不修改、不删除。
- 正文和关键规划采用不可变版本；活动指针与历史版本分离。
- 摘要、全文、关系图谱和Wiki均可从正式对象重建。

## 2. 身份、书籍与模型

- `user_accounts`：登录账号，保存规范化邮箱、昵称、密码盐值与摘要、角色、状态和最近登录时间；邮箱唯一，账号与 `owners` 一对一。
- `auth_sessions`：持久登录会话，只保存随机令牌摘要、到期时间、最近活动和撤销时间；不保存明文令牌。
- `user_memberships`：会员当前状态，每账号至多一条，保存套餐、算力值配额、周期起止、状态与经办管理员；算力值消耗按 `usage_ledger` 周期内汇总，不单独存储余额。青铜是长期体验档，不把体验档到期日折算成付费剩余期；青铜首次升级付费从办理日计费，只有未到期付费档之间续费才顺延剩余期。
- `membership_transactions`：会员开通、续费与撤销的不可变流水，保存套餐、真实实收金额、周期、经办人、备注和操作幂等编号；当前会员状态更新不能覆盖历史收入。只有未到期付费套餐继续办理付费套餐记为 `renew`，青铜升级、过期/撤销后重新办理均记为 `grant`。迁移 `0103_membership_action_idempotency.sql` 只追加可空字段和管理员范围唯一索引；旧流水保持空值且不回填。
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
- `v7_opening_agent_tasks`：V7正式建书前的账号级任务壳与执行检查点，保存4至2000字作者原始想法、幂等请求哈希、成员选择、创建时成员治理快照、任务状态和短租约；没有 `book_id`，不能冒充正式书籍对象。快照只保存成员键、上岗、默认和顺序，恢复时必须与代码登记表合成，数据库不能改写模型与套餐。迁移 `0104_v7_opening_idea_capacity.sql` 在同一事务中原样复制任务父表并保留候选、模型调用外键，修正旧800字约束；迁移提交前必须通过全库外键检查，旧任务内容、状态和检查点不截断、不回填。
- `v7_opening_agent_candidates`：主编任务书、编剧开书资料包和主编审查的追加版本；每个候选保存来源候选、创建成员和模型请求引用，候选内容与任务检查点在同一事务提交，不原地覆盖历史版本。
- `v7_opening_agent_model_calls`：V7开书 Agent 的账号级模型调用账本，保存冻结成员、模型、套餐、提示词哈希、预留与实际 token、结果状态及可恢复的结构化输出；不保存密钥和思维链。`working`/`unknown` 计入会员预留，`succeeded` 的实际 token 计入会员消耗。
- `v7_opening_agent_role_settings`：主编、编剧两个岗位的治理版本与最近管理员；岗位版本是后台并发修改的乐观锁，不承担模型绑定语义。
- `v7_opening_agent_member_settings`：六名代码登记成员的上岗、默认和备用顺序。成员键和岗位必须与 V7 roster 一致；每岗位至少一名上岗、恰好一名默认等跨行规则由同一应用事务校验。
- `v7_opening_agent_member_setting_events`：成员治理的追加审计，保存经办管理员、目标成员、调整原因以及修改前后整岗位状态；不保存密钥、提示词或思维链。
- `platform_prompt_overrides`：平台补充提示词的版本链和活动指针语义；按真实任务类型、岗位和阶段匹配，只作用于未来调用。
- `model_call_prompt_snapshots`：每次新模型调用的最终任务提示词、补充要求和命中的平台覆盖快照；不保存思维链。
- `narrative_method_overrides`：后台叙事方法的版本化内容与启停状态；基础方法仍由代码版本提供，作者公开投影不返回专业来源。
- 历史表 `agent_role_pools_v6`、`agent_member_settings_v6`、`agent_skill_versions_v6`：当前 V7 共享执行底座保存岗位池、逐书成员启停与不可变岗位 Skill 快照。后缀是已合并迁移留下的兼容标识，不是旧产品入口。

## 3. 作者输入与附件

- `author_planning_inputs`：作者附着于设定、卷、事件、章纲或正文的原话，保存意图等级、版本和状态。
- `author_input_links`：作者输入与生成任务/候选的有序关联。
- `author_attachments`：作者附件正式对象，保存原件、解析状态、摘要、绑定对象和来源；当前规划链接类型统一为 `author_attachment`。
- 0042迁移将旧库中的附件表原位升级，不复制或删除附件内容；`origin_record_id` 与 `origin_attached_at` 只保留历史来源，不进入当前作者接口或创作语义。

## 4. 设定协作

- `v7_setting_batches`：V7 设定编辑部的持久任务壳。普通设定批次至少有一条 `v7_setting_item_jobs`；主编设定清单复用同一租约与恢复设施，但没有条目工单，并在 `custom_items_json.taskKind=catalog_recommendation` 中保存公开阶段，在 `selected_items_json` 中保存三类目录结果。清单任务冻结调用时的开书版本、开书哈希、目录请求哈希和一名主编快照；应用层保证每本书最多发送一次该类模型请求。
- `v7_setting_model_calls`：V7 设定模型调用账本。`node_key=catalog_recommendation` 表示主编设定清单调用；同一请求ID的成功输出可恢复，失败/未知/进行中都不能被刷新页面再次发送。密钥和思维链不落库。
- `v7_setting_item_jobs`、`v7_setting_outputs`、`v7_setting_items`、`v7_setting_item_versions`：逐项设计工单、成员输出、活动设定指针和不可变版本。补充设计只为没有有效活动结果的条目建工单；确认或作者修改产生新版本，不原地覆盖旧内容。迁移 `0097` 将单条复审任务的作者修改快照容量从800字放宽到3200字，以完整容纳作者端最多2000字的设定正文、任务说明和来源标记；迁移原样复制全部旧工单，不截断内容、不改变版本与状态。
- 主编设定清单是对已确认开书规划的工作建议，不是正文事实或结算正史；只有作者后续确认的设定版本才进入正式设定基线。系统保存身份、版本、来源和模型账本，不能自行补写主编判断。
- `setting_outline_workspace`：当前设定项、状态、候选和确认结果。
- `setting_outline_item_versions`：设定项不可变版本链；每次确认追加一条版本并记录来源（manual/guidance/discussion），当前生效内容仍以 `setting_outline_workspace` 为准。
- `setting_proposal_fragments`：设定类目中作者所选1—4名编剧提案拆出的可勾选碎片；按提案落库，解析失败时以整份方案作单条 implicit 碎片兜底。
- `setting_fusion_drafts`：主编按作者勾选碎片产生的融合稿；保存所选碎片、段级来源标记（fragment/stitch）与融合正文，按设定项取最新一份。
- `discussions`、`discussion_participants`、`discussion_opinions`、`discussion_decisions`：对象化AI提案、独立意见与主编整理记录。
- 独立提案保存真实Agent、模型快照和输出；作者选择、组合、修订和确认另行记录。

## 5. 卷—事件—章纲规划

V7作者规划采用三棵相互引用、但不复制下层全文的竖向综合树：

- `v7_planning_tree_heads`：按`owner_id + book_id + tree_kind + scope_id`保存全书树、单卷树或单元链树的当前修订号，以及候选/已确认版本指针。全书树的卷节点只引用该书内单卷树；单卷树的链节点只引用该书内单元链树。
- `v7_planning_tree_versions`：不可变完整快照。每个节点把剧情、大事件、主角变化、情绪、阅读体验、因果、伏笔/开放问题、篇幅和下层接口放在同一对象；不另建故事树、情绪树或体验树。作者修改生成新候选，确认只移动指针，旧版本不覆盖。
- `v7_planning_tree_actions`：创建、调整、确认和正式结算投影的幂等收据。修改同时校验期望修订号，旧页面不能覆盖新内容。
- `v7_planning_node_actuals`：从正式章/事件/卷结算追加的节点实际进度，必须绑定结算版本和正文证据。它与未来规划分表保存，只在公开读取时投影到对应节点，不能反写或冒充规划已经实现。
- `v7_planning_source_snapshots`、`v7_planning_source_items`：规划任务的服务端冻结资料。逐项保存来源类型、ID、版本、权威级别、内容哈希、入选理由和顺序；作者接口不能自报来源。作者采纳的未来调整建议以`goal`来源进入下一次候选编译，不会取得`formal`或`actual`权威。
- `v7_planning_recipe_runs`、`v7_planning_recipe_proposals`：三席方法配方任务及主编比较记录。三席各自使用同一快照独立调用，原始提案分别追加保存；主编比较只能引用已经落库的三份提案。运行的 `retry_count` 只在明确失败的原任务续跑时增加，已保存路线不会重做。
- `v7_planning_recipe_versions`、`v7_planning_recipe_decisions`：方法配方不可变版本与作者幂等决定。一本书只有一份活动候选和一份活动确认配方；新确认只把旧确认转为历史，不覆盖旧内容。
- `v7_planning_generation_runs`：全书、单卷、单元链树的规划成员任务，绑定确认配方、来源快照、精确父树版本、冻结成员名册和请求哈希。模型结果先进入候选树，来源在执行期间变化则拒绝保存。明确失败可在同一运行上增加 `retry_count` 并只续跑未完成节点；`working/unknown` 禁止重发。
- `v7_planning_maintenance_runs`：正式章、事件或卷结算触发的增量维护任务。保存结算内容哈希、证据快照、当时确认树指纹、成员交接和结构化结果；同一正式结算只创建一个任务。
- `v7_planning_adjustment_suggestions`、`v7_planning_adjustment_decisions`：正文实际偏离后的未来调整候选及作者决定。接受或拒绝均幂等；接受不改确认树，只成为下一版候选规划的目标来源。
- `v7_planning_model_calls`：规划配方、树生成和结算维护的模型调用账本。保存成员/模型/套餐、提示词哈希、用量、成功/失败/结果未知和输出；不保存密钥或思维链，作者接口不投影内部字段。
- 规划节点文字由规划Agent依据带版本的开书、设定、上层已确认方向和作者意见产生；普通程序只校验层级、格式、顺序、引用、版本、幂等和证据，不用标签或规则冒充文学理解。

- `volume_plans`及版本表：活动卷纲、候选、模板实例与版本/哈希快照、作者输入、上游依赖和历史切换。
- `story_events`及版本表：卷内事件链、顺序、进入状态、因果触发、选择与代价、结果、结束钩子、下一事件接口、事件卡和事件大纲。
- 叙事模板注册表由后端统一版本化发布；活动规划只保存不可变模板引用与节拍快照，不依赖前端硬编码，也不允许规则更新原地改变旧规划。
- 模板推荐信号是按当前 `owner_id + book_id` 即时编译的非权威排序输入，来源限于开书资料、活动卷和最近真实卷结算，不写入正史。
- `event_chapter_outlines`及版本表：当前事件章链、章节详细章纲、预计字数和上游版本引用。
- `book_storyline_topology_versions`、`storylines`/`storyline_versions`、`storyline_relations`、`storyline_volume_participations`：全书故事线拓扑、各线不可变版本、线间关系及逐卷参与责任。
- `character_cards`/`character_card_versions`、`character_storyline_links`、`event_role_assignments`：正式角色卡版本、角色与故事线关联及事件功能到角色的可追溯绑定。
- `creative_ledger_entries`：故事线、关系/势力、时空资源、因果、伏笔和三级结算统一总账；`truth_status=planned|actual` 强制区分规划与真实发生。
- `storyline_frontier_versions`、历史表 `storyline_open_questions_v6`、`storyline_growth_rounds_v6`、`storyline_growth_candidates_v6`、`storyline_growth_decisions_v6`：作者最远节点、开放问题、提炼轮次、AI候选和作者决策的版本化增长记录。
- 历史表 `storyline_settlement_projection_receipts_v6`：卷/事件/章节结算投影的幂等收据；后缀只用于迁移兼容，历史总账即使存在重复记录也不删除。
- `author_object_drafts`、历史表 `workflow_invalidations_v6`、`object_reopen_records`、`core_workflow_states_v6`：作者草稿、上游变化影响、重开版本记录和阶段状态。
- `internal_structure_method_scopes`：内部结构方法到书/线/卷/事件/内容类型作用域的版本化映射；作者公开页面只接收白话标签。
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

### V7第一卷创作总线与正式化

- `v7_creation_workflows`：确认全书树之后的可恢复创作任务壳，保存卷/链范围、首卷标志、当前阶段、真实状态、作者目标、幂等请求和检查点；不保存密钥或模型思维链。
- `v7_creation_context_packs`：卷方案、链方案、章纲、正文、审校和结算任务的最小资料包。系统只召回同书合法候选、固定版本和预算，资料编辑Agent负责语义取舍；正式必要来源不能被排除，全量方法库、其他书、未确认候选和旧版本不能进入活动包。
- `v7_creation_options`、`v7_creation_option_member_preferences`、`v7_creation_option_reviews`：每个卷/链任务冻结1—3个请求席位，缺省1；不同规划成员基于同一硬事实和各自轻量方法包形成完整方案。方案逐席不可变保存，单席失败不删除其他成功结果；两案以上的比较点评只能引用已经落库的成功方案，失败也不构成整批准入门禁。
- `v7_creation_decisions`：作者对卷方案、链方案、章纲和正文的不可变幂等决定。同一工作流同一决定类型只允许一条，避免旧页面覆盖已经确认的选择。
- `v7_chapter_outline_draft_candidates`：绑定精确链、工作流、候选席位、成员、ContextPack和审查的1—3份章纲草案。每案独立处于`candidate/selected/superseded`生命周期；指定重做先保存新版本再废止旧版本，失败事务不会让原成功方案消失。
- `v7_chapter_outline_sequences`：作者采用且审查通过的草案才提升为该表中的正式章纲序列不可变版本；候选、确认和历史分离，正式章纲、作者决定与工作流检查点使用同一正式编号衔接。
- `v7_manuscript_versions`、`v7_manuscript_reviews`：正文完整不可变版本及精确版本审校。正文只追加`draft/reviewed/final`版本；同书同章只有一份正式版本，审校报告不能放行另一份新稿。
- `v7_chapter_settlements`：结算Agent从作者定稿正文提取的实际变化及精确证据。计划、章纲、摘要或相似文本不能写入该表。
- `v7_story_state_items`、`v7_story_state_versions`：V7故事线、伏笔和开放问题的稳定目录与不可变实际版本。每次变化绑定结算ID和正文证据；未来规划仍留在规划树，不与实际状态混存。
- `v7_formalization_outbox`：作者定稿与`settle_chapter`事件同事务提交；结算成功后再独立产生人物、规划和故事状态维护事件。每个消费者按正式来源唯一，失败可追赶，`unknown`停止重发，任何维护失败都不回滚正式正文。
- `v7_creation_stage_jobs`、`v7_creation_stage_settlements`：链/卷完成检测与正式汇总。只汇总已经存在的章结算证据；链和卷各自租约、重试与结果未知状态独立，不能用章纲或计划冒充完成。
- `v7_managed_creation_runs`：作者明确选择“托管写完本链”后的执行游标，保存手动/托管模式、当前真实状态、作者选择的主笔/审校、租约、尝试次数与失败原因。它不保存正文内容；取消或失败不会删除`v7_manuscript_versions`等已完成成果。
- `v7_creation_task_controls`：停止、交接等作者控制收据，按书、任务和幂等编号唯一；用于证明重复点击没有产生重复控制或模型调用。
- `v7_creation_model_calls`：资料选择、方案、主编比较、章纲、正文、审校和结算的调用账本，保存冻结成员、模型/套餐、提示词哈希、用量和真实结果状态；不保存密钥和思维链，作者接口不投影技术字段。
- `0085_v7_planning_task_retries.sql`为规划维护任务追加`retry_count`；`0105_v7_planning_generation_retries.sql`为全书路线和规划树运行追加同一语义的尝试编号。只有明确`failed`可以增加尝试编号并交接；`working/unknown`保持冻结，避免重复调用和重复扣量。
- `0086`—`0098`均为V7独立加法迁移：依次补齐商业创作收据/实际状态、链卷结算、作者显式托管、统一Agent治理、方案成员偏好、提示与上下文治理、固定岗位偏好、资料来源范围、Skill选择、PromptManifest执行绑定、章纲审查、设定容量和章纲多候选。上述新增对象全部使用`owner_id + book_id`范围，并通过外键、唯一约束、不可变版本和幂等收据保持候选、确认、正文实际和正史的边界；不回填、不更改V6及既有V7表语义。

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
- 已合并迁移中的向量投影表仅保留历史升级兼容，当前运行不装配向量模型或向量库；全文检索使用数据库内可重建投影，结果只提供候选，不能成为事实源。
- Wiki、图谱、摘要：派生导航，必须保留来源指针。

## 8. 任务、调用与审计

### V7提示词与上下文治理

- `v7_prompt_governance_meta`：提示治理配置的乐观修订号；后台发布、草稿和恢复必须携带期望修订。
- `v7_prompt_asset_versions`：岗位提示、工位提示、题材人设和Skill的不可变版本。一个资产键最多一份已发布版本；恢复历史只创建新草稿，不原地改写旧版本。
- `v7_book_genre_profiles`：主体题材与融合题材经Agent语义融合后的书级工作档案不可变版本；同书只有一份活动档案，保存来源资产版本和编译任务，不保存模型思维链。
- `v7_task_contracts`：每次任务的目标、必须保留、允许/禁止修改、成功标准、输出合同、操作模式、Skill选择、作者意见版本和来源任务。合同按任务快照不可变；技术重试复用冻结任务证据，作者主动重做产生新的任务与合同并绑定原任务。
- `v7_context_pack_traces`、`v7_context_source_traces`：本次任务最小资料包以及逐项采用/排除来源。每条来源都保存`owner_id + book_id`、来源版本、权威等级、理由、哈希和估算预算；0093补齐来源作用域并以触发器阻止跨书写入。
- `v7_prompt_manifests`：冻结一次模型请求实际使用的成员、岗位、工位、题材档案、Skill版本、任务合同、ContextPack、治理模型档案、温度、工具权限、分层编译结果和最终提示哈希。快照不可更新/删除，可由后台只读重建核验。
- `v7_prompt_governance_events`：草稿、预览、发布、恢复、书级题材档案和运行快照的追加审计事件。
- 迁移`0091_v7_prompt_context_governance.sql`建立上述对象并为建书前开书模型调用追加同等不可变快照；`0093_v7_context_source_scope.sql`补强逐来源书籍作用域；`0094_v7_task_contract_skill_selection.sql`冻结任务明确选择的Skill键。三次迁移均为V7独立加法，不修改V6正式数据语义。

### V7人物角色管理

- `v7_character_profiles`、`v7_character_profile_versions`、`v7_character_profile_actions`：按书保存全人物档案目录、不可变档案版本和幂等操作记录。重要程度、档案版本切换、归档、恢复、建议决定和问题处理都有操作者审计；档案只描述稳定人物资料、创作意图和开放问题，人物当前实际不复制到档案表，继续读取共享正史投影。
- `v7_character_context_packs`：为卷、链、章、正文等单次任务保存人物候选、语义选择成员、实际入选人物/字段、正史修订、预算和内容哈希。候选由上游结构化召回，Agent决定谁与当前任务真正相关；系统只校验同书范围、预算和版本。
- `v7_character_maintenance_runs`：绑定已生效章、事件或卷结算的增量维护工单。同一正式来源唯一，结果未知时停止重复调用。
- `v7_character_change_candidates`、`v7_character_review_issues`：分别保存有证据的人物档案/正史缺口候选，以及硬冲突、连续性风险、创作质量、开放问题。维护任务不能直接改写`fact_assertions`或当前投影。
- `v7_character_model_calls`：人物资料选择和结算维护的成员交接、模型套餐、用量与结果审计；不保存密钥或思维链，作者接口不返回技术字段。
- `0083_v7_character_task_retries.sql`只为资料包和维护工单追加尝试计数。明确失败才允许增加尝试；结果未知保持冻结，防止重复扣量。
- 正式人物身份仍使用同书`entities(entity_type='character')`；主角工作区通过确定性实体关联兼容接入，V6 `character_cards`不作为V7数据源。

- `tasks`、`task_attempts`、`task_phases`、`task_dependencies`：持久任务、尝试、检查点和依赖。
- `context_packs`：每次正式模型调用冻结的来源清单、预算、哈希和排除项。逐项设定另从活动 `setting_outline_workspace` 即时派生非正史临时摘要包并写入任务快照；它可删除重建，不是正式设定基线。条目修改或全部清空后，新任务按最新内容重新编译，旧快照只留审计。
- `model_calls`、`model_call_results`、`model_call_reconciliations`：模型调用、结果与中断调和。
- 历史表 `ai_node_author_inputs_v6`、`ai_node_batches_v6`、`ai_node_batch_members_v6`、`ai_node_results_v6`：当前 V7 共享执行底座保存节点作者输入版本、资料包批次、逐成员独立执行与结果；同批成员共享 ContextPack/hash，失败成员可单独重试或换人。后缀不对作者暴露。
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

| 作者页面 | V7 页面键 | 保留的历史/关联键 | 主要正式对象 |
|---|---|---|---|
| 设定 | setting | basic / setting / book_profile | 开书资料、设定活动版本、候选与基线 |
| 时光机 | timeline | topology / storyline | 全书方向、卷级简述、故事线实际进度、交汇点与伏笔速览 |
| 卷 | volume | master / volume_plan | 分卷方向、单元链粗骨架、volume_plans及版本 |
| 链 | chain | event | 单元链展开、角色安排、情绪/伏笔/因果与章节简述 |
| 章 | chapter | chapter_outline / manuscript | 详细章纲、正文不可变版本、审查与结算 |
| 资料库 | library | 无直接作者输入面 | 可重建资料、图谱与来源投影 |
| 取名 | naming | 无固定surface | 命名候选与占用记录 |

团队、任务和设置是工具域，不改变上述创作对象的数据库身份。历史入口键只在兼容解析层转换；已合并迁移、表名、枚举、对象ID和历史来源文字不改名，也不保留第二套业务页面。新数据只从 V7 页面合同写入稳定业务对象，历史阶段键不得重新变成产品导航。
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
