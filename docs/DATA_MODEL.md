# 数据模型规格

## 1. 总原则

DEC-107沿用 `book_planning_states` 与不可变 `book_style_versions`，并恢复独立、版本化的卷与事件规划层。开书快照必须包含1—8位主角；表达策略可为空。活动卷纲引用活动设定和上一卷结算，活动事件引用卷纲和前序事件状态，章纲同时引用活动卷纲与活动事件；旧 `stage_master_v2` 和历史 `volume_outline` 只读兼容，迁移不得猜测补齐旧书内容。

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

### `book_configs` / `book_onboarding_profiles` / `positioning_versions` / `book_expression_profiles`

`book_onboarding_profiles` 保留兼容字段；当前开书资料保存在 `positioning_drafts.opening_blueprint_json` 和不可变 `book_opening_blueprints`。书名仍在 `books`，频道只允许男频/女频。DEC-078要求新书保存1—8位初始主角和20—800字 `storyDirection`；故事方向属于老板确认、可修订的软规划锚点，不自动成为正史。世界观、开篇背景、阶段剧情和全书主线/结果属于历史兼容或后续规划参考，同样不自动成为正史；目标读者、预计规模、表达基线和具体技法仍在后续讨论。字段来源继续区分老板明确、系统建议、未指定或冲突。

`book_expression_profiles` 单独版本化保存全书表达基线，包括叙事人称与视角距离、语言气质、文字密度、目标读者、内容尺度、幽默或严肃倾向和作者声音证据。初始版本允许 `provisional`，叙事视角可由样文/试写推断后在首章正式工单前确认；后续变更创建新版本并保存影响范围。它与场景技法分离；默认属于软倾向，不能作为逐句模板或角色声音统一器。

## 3. 岗位、Agent和主编

### `role_templates`

保存历史九岗位模板和DEC-021十一成员模板的简短职业名称、职责、提示、能力要求、工具、数据范围和确认门禁。当前长篇release把面向老板的 `public_summary`、`public_responsibilities`、`public_boundaries`、`activation_triggers` 和 `deliverables` 与内部系统提示、隐藏安全规则和工具参数分开版本化；公开字段可以进入API，内部字段不得因前端展示而泄露。完整职责不得塞入岗位显示名。十一成员固定包含主编/副编、两个编剧实例、设定、主笔/副笔、审校、体验、研究和版权；清照原文编职责由妲己综合审校模板吸收。

### `agent_instances`

保存 `agent_id`、`owner_id`、`book_id`、岗位模板、女性成员姓名、模型配置快照、权限、启用状态和健康状态。`display_name` 是成员姓名，岗位短名来自版本化岗位模板。

小文秘书不写入 `agent_instances`，避免被误算为第12名创作成员或异模型意见。它使用版本化工具角色模板和下述按书会话/路由记录；前端聚合接口可以继续分开返回 `utilityAssistant` 与 `creativeAgents` 供聊天/诊断使用，但右侧团队栏只渲染 `creativeAgents`。

### `model_config_snapshots`

保存供应商、模型、参数、支持模态、工具能力和验证时间。不得保存API Key。

### `agent_model_binding_revisions` / `agent_model_bindings`

每书保存不可变的模型绑定修订和活动指针。修订包含每个成员/岗位的允许模型快照、用途、通道、默认/替补优先级、创建原因、能力探针和现金保护线结果。状态为 `draft/validated/active/superseded/rejected`；激活只影响未来任务，运行中任务继续引用旧修订。剧情席校验为DeepSeek/GLM/Kimi池内两个不同模型，豆包不在剧情池；写手池为Codex/GLM。预览记录独立性冲突和受影响任务类型，回滚通过重新激活旧兼容修订完成。

### `review_panels` / `review_reports`

`review_panels` 为每个稿件版本冻结事实/连续性、文学/AI腔、体验/政治情色三个职责席及实际成员/模型快照、选择原因、稿件哈希、活动写手快照、绑定修订、工单版本、最小正史版本、轮次、预算和状态。默认事实席为GLM、文学席为Kimi、体验席为豆包；活动写手为GLM时事实席选择DeepSeek。唯一约束保证同一 `manuscript_version_id + review_round + reviewer_slot` 只有一席；应用服务在同一事务中断言三席快照彼此不同且均不能等于活动写手快照，并由Repository契约测试覆盖，不能依赖跨行 `CHECK`。每轮状态只有 `frozen/running/complete/blocked/superseded`，三个有效报告齐全前不能 `complete`。

`review_reports` 分别保存连续性点评、综合质量/AI腔点评和读者体验/政治情色风险点评；每项问题携带段落/字符位置、正文证据、严重度、修改目标和策略版本。Kimi报告保存 `ai_style_risk_score`、`flagged_paragraph_count`、`total_paragraph_count` 与按二者计算的 `flagged_paragraph_ratio`，并固定 `is_authorship_probability = 0`。豆包报告将 `political_risk` 与 `sexual_content_risk` 分开保存级别、位置、证据、建议动作和 `policy_version`。AI腔分数不是AI作者概率，内容风险也不是法律意见或平台保证。

三份报告属于当前稿临时质量记录，不自动成为正史或长期经验。每个新修订稿产生新的 `review_panel`；旧报告不可覆盖，主编合并结果另存 `revision_orders` 并保留采用、否决、分歧、来源报告和最多两轮计数。

`editor_review_syntheses` 保存活动主编基于三份已验证报告生成的不可变综合JSON、综合哈希、实际主编Agent和模型快照。它不保存新的全文点评，也不能在缺席、同源、错稿或坏Schema时创建；最终修订工单引用该综合及原始三报告，确定性代码只负责校验和状态提交，不冒充主编判断。

### `editor_leases`

每书只有一条有效活动租约，包含活动主编、候任主编、`editor_epoch`、过期时间、接管状态和接管ID。旧epoch的命令在应用服务层拒绝。

### `writer_leases`

每个正式写作工单只有一个活动写手租约，保存主笔或副笔Agent、`writer_epoch`、稿件父版本、检查点、接管原因、过期时间和状态。副笔接管或显式A/B任务创建新epoch；旧写手的晚到正文只能作为诊断附件，不能登记为当前候选或触发点评。A/B候选使用不同工单分支和稿件版本，不允许两个写手争用同一租约或逐句混剪。

## 4. 对话、讨论和决定

### `conversations` / `messages`

`messages.sender_type='system'` 是既有Schema中的内部事件来源和历史兼容值，不再代表一个面向老板的独立角色。新本地受理回执使用 `message_type='local_assistant_notice'`；公开API和前端把新旧系统来源统一解释为“小文秘书”，但保留原始来源值用于审计和无损回滚。该兼容策略不增加第12名创作Agent，也不需要改写历史消息。

消息绑定书籍、发送者类型/Agent实例、岗位、真实模型来源、消息类型、引用、版本和创建时间。老板消息额外保存原始UTF-8文本哈希、显式点名和客户端幂等键；路由摘要、实体候选和压缩文本存到独立表，禁止覆盖原始消息。聊天意见默认不属于正史。

小文秘书和岗位的普通对话回复允许在 `messages.references_json` 增加版本化 `effective_output` 引用：默认 `content` 只保存同次调用中提取出的有效展示文本，引用保存该次允许公开的完整最终回复、格式类型和内容哈希。它不是新的事实源、正文版本、正史或模型思维链；结构解析失败时必须保留完整输出，禁止按字符数静默截断。正式正文、临时试写稿和三席点评的完整审校产物不使用该展示压缩。

### `local_assistant_sessions` / `message_routing_decisions`

`local_assistant_sessions` 保存 `owner_id/book_id`、会话类型、当前主题、活动讨论/任务、路由策略版本、状态、最后原始消息、到期和降级原因；它是工作状态，不是创作Agent实例或正史。

`message_routing_decisions` 是每次受理的不可变裁决信封，至少保存原始 `message_id/content_hash`、显式点名、活动会话、`route_class`、风险级别、置信带、实体/别名候选、确定性规则版本、本地模型快照、检索/上下文包、选中动作/岗位、排除理由、是否升级、改派结果、延迟、本地资源和最终云端Token。摘要只能作为附加字段，不能替代原文。所有行携带 `owner_id/book_id`，跨书复用必须被Repository拒绝。

### `utility_experience_candidates` / `utility_experience_revisions`

只保存当前书范围内的工具、路由和故障处理经验，不保存剧情喜好。候选记录来源案例、失败/成功差异、反例、禁止外推、适用任务、金标版本、影子结果和状态；修订记录版本、启用/到期时间、回滚目标、激活人和监控指标。单次成功、聊天采纳或模型自评分不能直接激活。通用系统路由规则仍随产品版本发布，不从某本书静默扩散到其他书。

### `discussions`

保存 `discussion_id`、范围、参与岗位、讨论类型、`discussion_epoch`、状态、预算、当前阶段和来源版本。

剧情讨论额外保存原始触发消息、活动主编、两个独立编剧任务、会话粘性、重大改向轮次和收口原因。小文秘书只作为受理/资料准备来源，不进入参与创作成员、意见或投票字段。

剧情讨论的默认消息显示主编收口后的有效结论、分歧/风险和独立岗位意见数量；每个岗位的完整允许公开回复仍保留在 `effective_output` 引用中供老板展开。少数意见不得因未被主编采用而从完整记录中消失，讨论决定与规划候选仍引用未经展示压缩的完整主编最终回复。

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

### `plot_span_estimates`

剧情方向趋稳时，两名异模型编剧各自保存最小、推荐、最大章节数、剧情单元拆分、估算前提、不确定性、规划版本和模型快照；独立意见提交前不能读取对方数字。主编综合产生新的推荐版本并保留差异。估算不是写作批次，也不创建多个正文任务；重大改向、卷结算或约束变化时生成新版本。

## 5. 规划与稿件

### `artifacts`

统一保存创作方案、故事圣经、总纲、章纲、写作契约和其他结构化成果的版本元数据。不同类型通过Schema和版本化模板约束。历史 `volume_outline` 仅为兼容审计类型：旧版本保留，活动指针清空，Artifact归档，不能通过公共作者流程新建、确认或选择。

DEC-107的新规划正式源使用独立的不可变卷蓝图版本、事件版本和事件章纲版本，并通过活动指针与乐观并发控制切换。卷蓝图保存卷目标、预计范围、软结构任务、事件职责、卷末目标状态和下一卷接口；事件保存因果前置、服务的卷任务、推进与转折、预期结束状态和下一事件接口；章纲直接引用活动卷与事件版本。`stage_master_v2`、旧 `title/goal/turningPoint` 和历史 `volume_outline` 继续只读兼容，不能成为新创作入口的权威来源。

新确认的 `chapter_outline` 使用 `outlineSchema = chapter_outline_v2`。每份保存 `chapterNumber`、`sourceStage`、`chapterFunction`、`openingState`、`requiredEndingState`、`cast[]`、`conflict`、3—5项 `plotBeats[]`、可选 `experience`/`descriptionFocus`/`informationControl`、最多2项 `threadActions[]`、`ending`、`mustImplement[]`、`mustNotViolate[]`、`allowedCandidates[]` 与非空 `creativeFreedom[]`。`sourceStage` 在确认时由服务端依据活动 `stage_master_v2` 绑定，模型不能自行伪造；旧 `goal/beats/hook` 章纲只读兼容，不能继续进入新的正式主笔任务。

场景契约作为写作契约内的版本化结构，保存场景顺序、叙事功能、目标读者效果、冲突、信息变化、情绪变化、核心/辅助技法选择、选择理由、自由创作区和重大候选。技法选择是软建议，不能覆盖表达基线、硬事实或主笔自由创作权。

### `technique_cards`

全局版本化技法工具箱，保存抽象技法名称、适用叙事目标、可选手段、风险、反例、机械化警告、版权隔离状态和适用范围。技法卡不绑定具体作品或作者，不要求建书时选择，也不因召回自动成为写作硬规则。

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

保存记忆类型、`owner_id`、`book_id`、可选 `agent_id`、内容、来源、事实状态、世界有效时间、人物/群体知情时间、系统记录/替代正史版本、有效章节、重要度和失效信息。作者偏好另存为带适用范围、证据、反例、到期和撤销条件的软记忆，不能与安全、费用和确认硬锚混层。

### `context_packs`

每次模型调用生成不可变记录：任务、Agent、书籍、正史版本、资料清单、资料顺序、压缩方式、模型Tokenizer/估算器和预算版本、输出/工具/结构化格式/安全预留、估算与实际输入输出Token、排除/截断原因和内容哈希。硬资料超预算时不能产生“已静默截断”的可用上下文包。

### `retrieval_records`

作为一次检索执行的不可变总信封，保存任务、岗位、创作模式、正史版本、故事时点、观点主体、策略版本、各通道水位、最终状态、上下文包和总候选/延迟/Token，便于复现遗漏或错误引用。

### `retrieval_query_plans` / `retrieval_channel_runs`

`retrieval_query_plans` 保存受Schema验证的主意图/子意图、实体候选ID与别名依据、歧义状态、活动工作集、允许下钻、四路开关、关系路径白名单、候选和注入预算，以及切片/嵌入/融合/重排版本。模型查询计划不得保存或执行任意SQL、文件路径或工具命令。同名/多候选未消歧时不得静默固化为单一实体或成为关系种子。

`retrieval_channel_runs` 按结构化、FTS、向量、关系/Wiki分别保存实际查询、硬过滤、Top-K、投影水位、原始排名/距离或路径、本地扫描与候选量、延迟、降级和错误。原始通道分数不可直接相加，也不等于事实置信度。

### `retrieval_evidence_clusters` / `retrieval_evidence_checks`

`retrieval_evidence_clusters` 按事实ID、实体、原始UTF-8范围、父子血缘和摘要/Wiki来源聚合重复候选，保存H硬约束/E证据/I灵感车道、各路名次、RRF分量、权威/三轴时间/岗位调整、冲突组、重排结果及采用/排除原因。派生副本只能形成一个证据簇，不能冒充多源一致。

`retrieval_evidence_checks` 保存选中断言到当前正式事实或最小原文的解引用、来源版本/哈希、否定/叙事模式/观点主体/三轴时间检查和 `closed/degraded/conflicted/unknown` 结果。H和确定性结论未闭环时不得进入正式生产硬约束。

### `content_chunks` / `chunk_entities`

保存所有可检索块的权威元数据和来源指针，不在SQLite重复保存正式正文全文。块至少包含：来源类型/ID/不可变版本、原始UTF-8起止字节、段落范围、来源/内容/索引文本哈希、场景根/场景节拍父块、前后块、顺序、块类型、`leaf/parent/summary` 检索粒度、FTS/向量/直接注入能力、权限域、权威/生命周期/保留状态、故事时间、视角、说话人、地点、叙事模式、正史版本、切片/规范化/嵌入文本策略版本、边界置信和可选实体/事件绑定。正文使用场景根、场景节拍父块与段落组合子块；设定、规划、事实、Wiki、人物声音和任务临时内容使用各自切片类型。临时、候选、正史和派生块不能只靠向量相似度跨层召回。

### `chunk_snapshots` / `chunk_snapshot_sources`

切片构建按不可变快照保存策略版本、来源清单/哈希、块数量、覆盖校验、父子/邻接校验、探针、状态和正史水位。新快照只能按 `building → validated → ready` 推进；SQLite事务原子切换每书/投影的当前快照，旧快照标记 `stale/superseded` 并保留回滚宽限。失败或中断快照不能成为正式检索当前指针。

### `knowledge_promotions` / `retention_records`

`knowledge_promotions` 保存临时来源、候选版本、检查结果、确认/分级结算来源、新正史版本和投影任务，提升只追加记录，不原地改写来源。候选状态至少包含 `active/dormant/promoted/rejected/superseded`；任务/阶段关闭时未确认项转休眠并退出其他正式任务默认检索，重新激活必须留审计。`retention_records` 保存对象类别、热/归档/宽限/可重建类别、归档位置、校验哈希、宽限截止、清理原因、执行状态和恢复结果。老板可见原始内容没有自动永久删除策略；任务临时向量索引默认在结束7天后才可清理。

### `embedding_model_snapshots` / `vector_index_manifests`

记录本地嵌入模型ID、版本、来源、许可、文件清单/哈希、数据根内缓存路径、Tokenizer、维度、归一化、查询指令、量化方式和验证时间，以及每书LanceDB索引的路径、块策略、来源正史版本、完成水位和状态。模型或维度改变时创建新快照并重建，不允许在同一索引混用向量空间；正常运行禁止远程模型加载。

通用本地工具模型复用 `model_capability_snapshots`，另保存量化/运行时、许可/哈希、可用设备、峰值内存、冷启动、支持任务、冻结路由金标结果和激活策略版本。工具模型快照不能绑定向量索引，也不能因“本地”跳过模型调用、来源和资源审计。

### `projection_jobs` / `projection_watermarks`

权威事务在SQLite内写入幂等投影任务；Worker据此构建FTS、LanceDB、关系和Wiki。水位按书、投影类型和正史版本记录 `pending/building/ready/failed/stale`，正式生产只能使用满足所需正史版本的投影。

## 8. 知识与正史

### `entities`

实体类型包括人物、地点、组织、道具、资源、技能、属性面板、世界规则、事件、伏笔和钩子。类型和字段通过版本化Schema扩展。

### `entity_schemas` / `tag_definitions` / `tag_aliases`

`entity_schemas` 保存可扩展实体类型、字段定义、适用范围和版本，避免把“主角、配角、门派、城市、神器”等全部固化成不可扩展数据库列。

`tag_definitions` 保存标签命名空间、名称、说明、适用对象类型、颜色/图标、创建来源、版本和 `active/archived` 状态；`tag_aliases` 保存同义、简称和历史名称。标签定义只是资料治理配置，不因创建就成为某个角色或事件的正史事实。

### `tag_assignments` / `semantic_annotations`

标签赋值与可读语义标注至少保存：目标对象类型与ID、标签或语义类型、值、故事时间、观点主体/知情范围、来源证据、来源正史版本、`candidate/confirmed/derived/rejected/archived` 状态、置信度、创建者、确认者和版本。

老板明确要求给确定对象增加标签时，可以形成 `confirmed` 标注；模型抽取和其他Agent建议只能形成带证据的 `candidate` 或 `derived` 标注。改名、建立别名、归档和可逆合并不得静默覆盖历史赋值。

任何表达生死、背叛、知情、归属、核心关系或世界规则等正史事实的标签赋值必须引用相应 `fact_assertion` 和 `canon_binding`；孤立标签不能替代事实等级与确认门禁。主角/配角等叙事导航分类可以作为确认标注独立存在。

### `knowledge_gap_findings`

保存资料缺口的目标对象、关联任务/章节、缺口类型、`blocker/recommended/optional` 级别、影响说明、证据、检测规则版本、状态和老板处理结果。缺口记录是任务化分析结果，不是正史；全书不存在一个要求把所有可选字段填满的统一完成率。

### `fact_assertions`

事实采用断言结构，至少包含主体、关系或属性、值、世界有效起止、观点主体、人物知情起止、系统记录/替代时间与正史版本、否定状态、叙事模式、精确证据范围/哈希、来源章节、事实等级和状态。无法可靠判断的轴保存未知，不能用“最新”或向量相似度猜满。

正式原文、设定、规划和明确决定是一级证据；自动抽取先进入派生候选。B级绑定必须通过来源、实体、否定、叙事模式、三轴时间与冲突检查，并在作为正式生产硬约束前回查最小原文证据；不一致时隔离绑定并回退候选。C/D门禁不变。

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

关系投影必须同时保存来源事实、起止实体、关系类型、有效故事时间、观点主体/知情范围和正史版本；关系遍历使用有限深度和岗位边类型白名单。派生Wiki的每条结论必须回链事实或正文，人物谎言、认知、计划和客观事实不得合并。

情绪投影分开保存规划中的 `planned_curve` 与正式正文结算出的 `actual_curve`，按人物、对象、章节/场景、故事时间、情绪类型、强度、明确/推断状态、置信度和证据记录。两条曲线用于诊断偏差和支持后续规划，不是“情绪引擎”，不能自动改剧情、强制达到数值或升级为正史；推断情绪也不能自动升级为人物客观状态。地点投影分别保存地点事实、包含/相邻/距离/通行/旅行约束和可重建视觉布局，画布坐标不具有正史权威。

作者可见资料库从实体、事实、标签、语义标注、Wiki和分析投影建立只读模型；前端不得直接读取LanceDB或把原始向量暴露为知识。标签作为检索过滤/重排元数据投影时，必须携带来源版本和水位。

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
- 两本书的小文秘书会话、路由决定、实体候选和经验零串线；原始消息哈希与路由前后文本一致；
- 历史首版书的9实例作为停用审计记录解释；当前新书11个创作Agent实例、三评审模型快照和小文秘书按书会话原子创建，旧书通过幂等升级补齐且不删除历史实例；
- 同书只能有一个活动主编租约；
- 小文秘书不能写入创作Agent、剧情意见、点评报告、正史或正式正文表；
- 前章未结算时后章不能启动；
- 正文哈希、文件清单和数据库指针一致；
- D级事实未确认时不能结算；
- 旧 `editor_epoch`、旧 `canon_revision` 和旧定位版本的写入被拒绝；
- 迁移空库、重复执行和已有数据升级安全。
- 正式与临时LanceDB索引零串线；向量目录全部删除后能够从权威源按书重建。
- 投影任务中断可幂等恢复；落后、失败、混合模型或错误正史水位的索引不会驱动正式生产。
- 标签定义、别名、赋值和语义标注全程按书隔离；明确的主编工具命令可审计、可撤销，候选标注不会冒充老板确认。
- 资料缺口只报告与当前任务或叙事目标有关的缺项；有意未知和自由创作区不会被通用必填表误判为阻断。

## 13. 超长篇连续性数据

### `narrative_commitments`

保存主线/支线承诺、伏笔、人物目标、关系张力、知情差和老板已决定但尚未落地的方向。至少包含创建来源与章节、适用故事时间、预计兑现窗口、最后推进章节、`open/advanced/fulfilled/abandoned/superseded` 状态、关闭依据、正史版本和责任岗位。承诺不能只藏在摘要或自由文本标签中。

### `continuity_nodes` / `continuity_node_sources`

保存场景、章节、故事弧、卷和全书主脊五级派生节点。节点携带范围起止、父节点、正史版本、内容哈希、状态、增量合并来源和重建水位；每条结论通过来源表回链事实、规划或正文。新章节只生成当前范围增量，不能覆盖旧版本或无来源地重写整本摘要。

### `agent_continuity_journals` / `agent_focus_snapshots`

岗位连续性日志保存 `agent_id`、岗位、来源任务/章节/正史、观察或经验、适用范围、反例、证据、状态、到期和撤销条件。关注快照保存当前卷、故事弧、章节、任务、未决事项、下一步和最后有效贡献。原始聊天、采纳率和一次成功不能直接成为启用日志。

### `compression_snapshots` / `compression_probes`

长讨论压缩快照保存来源消息范围与逐段哈希、上一有效快照、结构Schema、压缩模型/适配器/提示词/Tokenizer快照、独立硬锚、已确认决定、事实引用、未决问题、少数异议、承诺、下一步、排除和失效信息。探针至少覆盖事实回忆、决定理由、继续工作、来源证据、冲突/否定和未决承诺，并记录隐藏/轮换版本、结果与压缩后的旧消息回读率。失败快照不得覆盖上个有效快照。

### `quality_windows`

保存按20/50/100/200章滚动窗口统计的硬冲突、无依据事实、人物声音漂移、场景功能重复、情绪单调、承诺/伏笔债务、资源膨胀、章纲偏离和重写率。软指标是带证据的分析投影，不反向成为正史或自动重写正文。

### `stage_settlements` / `stage_settlement_sources`

保存已叙事闭合的故事弧、卷和必要技术检查点。正式结算至少记录范围、阶段类型、闭合状态、不可逆结果、实体当前状态、关闭/开放线程、承诺/伏笔、关系/知情/资源变化、规则与关键物品、排除候选、正史版本、摘要哈希和上一有效版本；来源表逐项回链事实、规划、章节、场景或正文偏移。技术检查点必须与“叙事已闭合”分开，不能伪造阶段完成。

### `retrieval_activity_projections`

按书、正史版本、对象/连续性节点和故事时间保存 `always_active/open_loop/stage_active/dormant_triggered/closed_local/superseded` 派生活跃度、理由、有效范围和重建水位。活跃度只服务过滤与重排，不改变正史状态；章节距离不能把硬事实或开放线程降级为不可检索。

### `retrieval_drilldowns` / `stage_settlement_probes`

下钻记录保存关联查询/上下文包、触发原因、起始层级、卷→故事弧→章节/场景→原文路径、语义深度、本地候选量、证据解引用量、最终注入量、Token、采用/排除理由和停止结果。深度统一定义为活动集0、卷1、故事弧2、章节/场景及结构化事实3；从已选来源指针取得最小原文属于证据解引用，不增加语义深度但必须记预算。阶段结算探针分别保存事实、当前状态、承诺/伏笔、因果链、来源完整性和原文指针检查；失败结算不能替换上一有效版本或向上合并。

数据库与Repository测试另覆盖500万字符、1500章下的分页、范围查询、增量结算、投影水位、按书重建、备份恢复和Agent跨重启接续；不得用单行百万字符或集中前缀锚点代替分布式满规模测试。

还必须覆盖：第500/1000/1500章触发第30/120/280章等早期正史；无关旧块不注入；开放线程与全局硬事实不随距离丢失；摘要探针失败可从原文重建；下钻记录和上下文包一致；所有投影跨书隔离且删除后可重建。

## 14. 长篇release新增Schema分组与切换元数据

长篇增量只通过0010至0026向前新增，不修改0001至0009，也不修改已合并迁移。表名、顺序和职责如下：

- 0010：`book_onboarding_profiles`、`book_expression_profiles`、`technique_cards`、`entity_schemas`、`tag_definitions`、`tag_aliases`、`tag_assignments`、`semantic_annotations`、`knowledge_gap_findings`。
- 0011：`knowledge_items`、`knowledge_revisions`、`knowledge_promotions`、`temporal_scopes`、`retention_records`、`canon_source_bindings`。
- 0012：`content_nodes`、`content_chunks`、`chunk_entities`、`chunk_snapshots`、`chunk_snapshot_sources`、`projection_outbox`、`projection_jobs`、`projection_watermarks`、`embedding_model_snapshots`、`vector_index_manifests`、`book_capability_states`。
- 0013：`retrieval_query_plans`、`retrieval_channel_runs`、`retrieval_candidates`、`retrieval_evidence_clusters`、`retrieval_evidence_checks`、`retrieval_drilldowns`、`retrieval_context_selections`。
- 0014：`narrative_commitments`、`continuity_nodes`、`continuity_node_sources`、`stage_settlements`、`stage_settlement_sources`、`stage_settlement_probes`、`rolling_plan_windows`、`plot_span_estimates`、`quality_windows`、`retrieval_activity_projections`。
- 0015：`agent_continuity_journals`、`agent_focus_snapshots`、`compression_snapshots`、`compression_probes`、`prompt_template_snapshots`、`model_capability_snapshots`、`team_template_snapshots`、`agent_model_binding_revisions`、`agent_model_bindings`、`writer_leases`、`review_panels`、`review_reports`、`revision_orders`、`local_assistant_sessions`、`message_routing_decisions`、`utility_experience_candidates`、`utility_experience_revisions`。
- 0016：`writing_orders`、`writing_order_sources`、`chapter_approval_gates`，并为章节流水线和三点评面板追加冻结工单、写手epoch、稿件哈希、点评轮次、绑定修订、正史版本和Token预算字段。旧的单点评表只保留历史兼容；Schema 16正式生产以三点评面板和正文确认门禁为准。
- 0017：冻结运行中讨论、写作与点评所用模型绑定和书籍体验修订，保证未来配置不污染既有任务。
- 0018：`portable_operations`、`portable_manifests`、`portable_files`、`import_quarantine_checks`、`restore_impact_reports`。
- 0019：`chat_attachments`，保存按书隔离的原文件身份、哈希、MIME、大小、本地相对路径、消息绑定、解析状态、有界上下文摘录和固定 `temporary` 生命周期。原文件与解析文本同时登记 `file_registry`；附件不能成为正史权威或正式向量投影源。
- 0020：为任务补充不可复用租约token、attempt、租约续期与恢复字段；为模型调用补充不可变结果、结果哈希、provider引用和调和记录；所有晚到提交由书籍作用域、执行者、租约、attempt和主编epoch联合栅栏。
- 0021：`canon_index_requests` 保存与正史修订同事务登记的索引意图、处理状态和错误；索引协调器幂等消费并只在全书覆盖探针通过后切换活动投影。
- 0022：`editor_review_syntheses` 保存主编真实综合；章节流水线保存一次写手接管计数与原因；`fact_assertions` 增加认识状态、否定、观点/知情主体、知情时间和时间完整度；`chunk_snapshot_memberships` 让全书活动清单复用不可变来源切片，`embedding_vector_cache` 按模型身份与嵌入文本哈希复用向量，防止每章全书重切/重嵌入。
- 0023：`manuscript_versions` 增加作者/Agent来源与修订说明；`protagonist_profiles`、`protagonist_state_entries` 保存按书隔离、追加修订的主角状态账本；`attribute_formulas` 保存版本化受限算术公式。
- 0024：把历史已结算章节的生成状态规范为完成，并收紧后续结算状态一致性。
- 0025：`book_opening_blueprints` 保存不可变完整开书资料，并为定位草稿增加版本化开书蓝图。
- 0026：`creative_sessions`、事件、不可变黑板、讨论轮、剧情预演分支和 `manuscript_quality_snapshots`，并为上下文包增加策略版本与来源指纹。

所有核心/按书记录继续携带 `owner_id + book_id`；投影记录额外携带 `source_revision`、Schema/策略/模型/切片版本、水位和哈希。活动策略与活动快照指针只在验证事务中切换；构建中的行不能被正式查询读取。

旧事实迁移不伪造世界有效、人物知情或系统修订时间。原权威等级保留，并写 `temporal_completeness=partial`；补全任务只生成候选和来源指针。完整迁移、状态机和回滚见 `docs/PRE_DEVELOPMENT_DESIGN_FREEZE.md` 与最终实施计划。

## 15. Schema 0023：作者正文修订、主角状态与属性公式

### `manuscript_versions` 增量字段

- `creator_kind`：`agent/owner/import`，区分Agent产稿、作者手改和导入来源；
- `edit_note`：作者修订说明或导入备注；
- 作者保存仍创建完整不可变版本，`parent_version_id` 回链基准稿，当前指针通过版本CAS切换；旧版本、文件和哈希不得覆盖。

### `protagonist_profiles`

每书保存一个或多个主角面板，包含可选角色实体、显示名、主角标识和活动/归档状态。作者只填姓名时，系统可在同书内按完全相同的活动角色标准名匹配并补上实体关联；不做跨书、别名模糊匹配或猜测。所有唯一键和外键均携带 `owner_id/book_id`。

### `protagonist_state_entries`

追加式保存分类、逻辑键、名称、值类型/值/单位、活动/消耗/遗失/战死/退役/归档状态、候选/正史/派生权威层、生效章节、故事时间、来源事实/正文、正史修订、修订号和上一版本。`category` 是按书可扩展的导航元数据，不是固定枚举或必填模板；无法可靠分类时使用保留键 `unclassified` 并关联一个开放资料缺口。当前面板由每个逻辑键的最新非归档修订派生；作者重分类只新增修订并保留事实来源，物理删除或原地改写均不允许。

### `attribute_formulas`

按 `formula_key/version` 保存名称、受限表达式、声明变量、单位和活动/历史/归档状态。表达式不是代码，结果不是事实；任何正式状态仍需来源和正史门禁。

Schema 0023—0025只向前增加。测试必须覆盖空库/升级/重复迁移、跨书、正文旧版不变、状态历史、结构化正史投影、公式非法字符/未知变量/除零和数据库外键完整性。
## 版本化开书资料（Schema 25 / DEC-046）

- `positioning_drafts.opening_blueprint_json`：定位草稿中的完整开书资料，JSON有效且随草稿版本一起确认；旧草稿默认空对象，仅走兼容路径。
- `book_opening_blueprints`：确认建书后按 `owner_id + book_id + version` 保存不可变开书资料，记录分类目录版本、频道、分类键/显示名、完整资料JSON、内容哈希、状态和时间。它是老板确认的规划参考源，不是正史表。
- 新书 `opening_blueprint_json` 必须包含1—8位完整初始主角和20—800字 `storyDirection`。读取历史快照时优先使用 `storyDirection`，缺失则只读回退到旧 `fullBookOutline`，不得迁移猜测或把回退值伪装成新确认字段。
- 单次开书快照校验后的JSON总量不超过18,000字符，确保第一次主编开场可以完整带入24,000 Token上下文包；数据库不做静默截断。
- 主角姓名投影到 `protagonist_profiles`，年龄、人物背景和性格以 `authority_layer='candidate'`、`source_kind='owner'` 的初始状态项保存，并引用开书资料版本；建书不会把这些候选资料冒充章节正史。
- 番茄式分类目录是应用内版本化合同，不依赖第三方在线服务。旧书保留原目录版本和分类键；目录升级只影响新选择，不静默重写历史。
- 内部 `onboarding_trigger` 消息仅为主编主动开场任务的可追溯触发源，消息列表不向老板显示；实际主编回复、模型调用、上下文包、预算和任务状态照常审计。

## 16. Schema 0026：持续创作会话与质量快照

- `creative_sessions`：按 `owner_id + book_id` 只允许一个活动会话，保存状态、模式、当前黑板修订、正史修订、会话epoch和已锁定决定。
- `creative_session_events`：追加式保存老板原话引用、主编回复、状态动作、讨论轮和锁定事件；不保存模型思维链。
- `creative_blackboard_revisions`：保存不可变共享黑板、上一修订、内容哈希和来源指纹。黑板最多保留最近8条有界老板消息及有界候选，不等于聊天归档或正史。
- `creative_session_rounds`：把初次探索、重大改向和锁定后规划轮绑定到真实讨论任务、黑板修订与完成决定。
- `narrative_forecasts` / `narrative_forecast_branches`：保存2—5个非正史预演分支；正史/黑板/来源变化后只改为陈旧、拒绝或替代，不原地重写。
- `manuscript_quality_snapshots`：按稿件和点评面板保存事实、文学、体验及AI腔自然度等命名空间维度、硬阻断状态、父快照和唯一最佳标记。它是临时质量证据，不是正史。
- `context_packs` 新增策略版本和来源指纹，使4200字符初稿包与9000字符重写包可复现；所有新表继续执行书籍隔离、前向迁移和Repository访问边界。
### 属性公式分类

`attribute_formulas.category` 保存作者可见的业务用途，例如个人战力、装备战力、军队战力、资源产出或排行榜积分。旧记录迁移后使用 `uncategorized`，前端显示为“未分类”。分类不改变公式版本语义，公式仍按 `formula_key` 生成不可变新版本。

### `relationship_projection` / `narrative_projections` 作者视图合同（DEC-068）

关系投影在作者界面只呈现人物甲、人物乙和中文关系名称。叙事投影继续是可重建派生数据，正式源仍为已选规划、阶段结算、叙事承诺、正文结算和带来源的结构化质量证据。

作者可见内容使用以下白名单语义：

- `mainline`：`scopeLabel`、`summary`、可选 `chapterStart/chapterEnd/result`；
- `emotion`：`scopeLabel`、`emotionFlow`、可选 `baseline/summary`；
- `subplot`：`scopeLabel`、`summary`、可选 `parentScopeLabel`；
- `hook`：按章聚合的 `items[]`，每项含 `kind/summary/status/openedChapter` 及可选 `resolvedChapter`；
- `information_gap`：按章或阶段聚合的 `items[]`，每项含 `summary/knowers/unaware/readerState`。

`narrative_projections.chapter_number` 对章节投影表示章节号；对阶段主线投影表示稳定排序号或真实起始章，真实结束章保存在内容白名单中。不得为了填满五类轨道，为每章机械制造记录。重建先生成新集合并在事务内替换同书同修订投影；不得修改规划、正史、正文或来源证据。

## 17. Schema 0034：已有正文接续导入

- `continuation_imports` 保存导入ID、书籍作用域、原文件名、源文本不可变暂存路径与哈希、解析器版本、状态、原文字符数、纳入章节数、逐章检查点、失败原因和确认/完成时间。源文本只用于预览、确认导入和来源审计，不进入普通聊天或默认模型上下文。
- `continuation_import_chapters` 保存导入内顺序、原识别标题、作者编辑标题、UTF-16字符起止、内容哈希、字符数、纳入开关、状态及最终章节/稿件引用。正文不在该表重复保存，而是按范围从同一哈希源读取并在确认后提升到不可变正文文件。
- 同一书与同一源哈希只允许一个导入记录；同一导入顺序唯一。所有读写必须同时验证 `owner_id + book_id + import_id`。
- 状态为 `parsed` 前后都不创建业务章节；只有显式确认可以进入 `importing`。逐章完成后记录检查点，重复确认或失败恢复只继续未结算项，不重复创建章节、稿件或正史修订。
- 导入正文的 `manuscript_versions.creator_kind` 固定为 `import`；其活动模型快照只记录“历史资料导入”，不能冒充AI写作。旧章可以直接由作者确认结算，不补造事实/文学/体验三席报告；其后新写章节仍遵守三异模型审校合同。

## 卷驱动 V2 数据增量（DEC-107）

下一向前迁移新增候选：

- planning_template_versions：模板范围、内部来源、白话标题/说明/问题/风险、版本和哈希；
- author_planning_inputs：作者原话、对象、意图强度、状态、owner/book和时间；
- author_planning_input_links：想法与附件、任务、候选和版本的引用；
- volume_plans：规划卷身份、物理卷ID、顺序、状态、活动版本和前后卷关系；
- volume_plan_versions：不可变完整卷纲、模板实例、作者引用、来源版本集、父版本和哈希；
- story_events：事件身份、规划卷、稳定顺序、预计范围、状态和活动版本；
- story_event_versions：不可变事件大纲、因果接口、模板实例、作者引用、来源版本集和哈希；
- planning_dependencies：上层/下层版本、依赖种类、有效性和复核原因；
- story_event_settlements：正式正文派生的事件结果、正史修订、章节范围和下一接口；
- volume_settlements：卷实际结果、来源事件、正史修订、开放线索和下一卷接口；
- collaboration_context_links：历史消息、讨论、附件与新创作对象的定位关系。

所有表从第一天携带owner_id和book_id。卷纲/事件版本不可变；活动切换使用预期版本CAS。物理volumes继续组织正文，不承担规划权威。旧volume_outline、旧阶段Artifact和历史讨论保留读取，不静默转换。普通删除为归档；作者原话、规划版本、结算、正文、正史、任务和调用不得因界面精简物理删除。
