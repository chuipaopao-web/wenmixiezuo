# 当前API与事件契约

## 1. 通用规则

- 前缀：`/api/v1`；健康检查为 `/health`。
- API仅监听 `127.0.0.1`；公网由同机HTTPS反向代理转发 `/api`，不得直接暴露API、SQLite或Worker端口。
- 所有书内接口从路径获取 `bookId`，服务端从已验证登录会话绑定 `owner_id`；客户端不能提交或替换所有者。
- 后台、Worker和旧缓存前端继续使用稳定内部错误码；当前作者前端为普通 `/api/v1` 请求发送 `x-wenmi-author-projection: clean-v1`，成功响应只保留作者业务对象，失败响应只返回自然语言 `message`、业务恢复 `action`、`retryable` 与不透明 `recoveryKey`，不得返回内部错误码、详情、路径、SQL、模型或Worker状态。
- 创建/生成命令使用幂等键；版本化修改携带期望版本，冲突返回409。
- 长任务返回任务ID，通过任务查询和SSE观察，不在HTTP连接中假装同步完成。

## 2. 运行与能力

- `GET /health`：公开的API、轻量数据库探针与Worker心跳状态；不创建账号会话，也不在高频探针中执行全库扫描。
- `GET /api/v1/runtime/worker`：Worker心跳和队列状态。
- `GET /api/v1/runtime/readiness`：数据库、迁移、模型与投影准备度。
- `POST /api/v1/auth/register`：邮箱、密码、昵称注册；首个账号原子授予管理员角色，并在存在未认领本机老板数据时接管该所有者；后续账号创建全新独立所有者并签发会话。
- `POST /api/v1/auth/login`：邮箱密码登录，成功后签发 HttpOnly Cookie。
- `POST /api/v1/auth/logout`：撤销当前会话并清除 Cookie。
- `GET /api/v1/auth/me`：读取当前账号公开资料与角色。
- `GET /api/v1/admin/overview`：管理员查看用户与书籍总览。
- `GET /api/v1/admin/dashboard`：独立后台运营总览，返回今日失败、真实API成本、算力、活跃会员、收入、七日趋势、高消耗用户与临期会员。
- `GET /api/v1/admin/feature-capabilities`：仅管理员可读的全功能台账。可用 `baseline=previous-production|stable-baseline` 切换 `d98dc81` / `61cb87b` 基线，并用 `status`、`moduleId`、`query` 筛选；返回版本信息、全局/状态统计、模块选项、功能明细、代码证据和疑似遗失清单。接口不读取运行时 Git，不返回密钥、思维链、作者正文或模型私密配置。
- `GET /api/v1/admin/usage`：按用户、模型和日期汇总真实输入/输出用量、调用次数和 `cash_micros`，算力值仅在展示时按真实用量×2换算。
- `POST /api/v1/feedback`：登录作者提交BUG/体验/建议，可安全绑定本人书籍和任务；不能绑定其他用户对象。
- `GET /api/v1/admin/issues`、`PATCH /api/v1/admin/issues/:sourceType/:sourceId`：汇总失败任务与作者反馈，并维护严重程度、处理状态和备注。
- `GET|PUT /api/v1/admin/narrative-methods[/:methodKey]`：读取或版本化覆盖后台叙事方法，支持启停；普通作者接口不返回内部方法名。
- `GET /api/v1/admin/prompt-catalog`、`GET /api/v1/admin/runtime-system-prompt`：查看真实触发点、按钮/时机、AI成员、资料包、任务职责和运行时岗位提示词。
- `POST /api/v1/admin/prompt-overrides`、`POST /api/v1/admin/prompt-overrides/:promptOverrideId/archive`：新增或归档平台补充提示词；只影响未来匹配调用。
- `GET /api/v1/admin/prompt-calls`、`GET /api/v1/admin/prompt-calls/:requestId`：查看上线后保存的最终任务提示词、补充要求、调用结果与ContextPack清单；密钥和思维链不返回。
- `GET /api/v1/admin/membership-stats`：统计活跃会员、实收收入、续费次数、临期人数、套餐分布和不可变会员流水。
- `GET /api/v1/admin/audit/books/:bookId/tasks/:taskId`：管理员按书籍和任务读取完整任务、阶段、模型调用、工具调用与内部方法审计；普通作者路由没有该投影。
- `GET /api/v1/admin/users`：管理员按关键字和状态查看账号。
- `PATCH /api/v1/admin/users/:userId/status`：管理员暂停或恢复账号。
- `GET /api/v1/membership/me`：当前账号会员状态（套餐、算力值配额/已用/剩余、到期时间）；管理员返回 `isAdmin: true` 不限额。
- `GET /api/v1/admin/memberships`：管理员查看全部账号的会员与算力值消耗（周期内消耗与累计消耗）。
- `POST /api/v1/admin/memberships/:userId`：管理员开通或续费会员，Body使用 `plan`：`bronze`（青铜20万算力值，长期体验）/`silver`（白银2000万）/`gold`（黄金5000万）/`diamond`（钻石2亿），可附 `amountCny` 真实实收与 `note`；付费档当前周期12个月。算力值=真实token×2，普通作者页面不出现token口径。默认青铜转首个付费档记为开通，再次办理记为续费。
- `POST /api/v1/admin/memberships/:userId/revoke`：管理员撤销会员。
- 生成门禁：账号体系内的非管理员用户必须持有生效会员且周期内算力值未用完，否则任务创建返回 `MEMBERSHIP_REQUIRED`、`MEMBERSHIP_EXPIRED` 或 `MEMBERSHIP_QUOTA_EXHAUSTED`（403，附管理员联系方式）。
- `GET /api/v1/capabilities`：当前检索和运行能力；普通作者投影不返回模型配置，管理员通过独立管理接口查看。

## 3. 书架与开书

- 书籍草稿：创建、更新、确认。
- `GET /api/v1/books`：书架。
- 书籍详情、开书资料、定位、表达基线、归档、恢复和彻底删除。
- `POST /api/v1/books/:bookId/branding-designs`：主编依据第一卷已确认方案、设定基线和开书信息设计书名或书籍简介候选（`kind` 为 `title` 或 `synopsis`）；第一卷未确认返回409并提示先设计第一卷。
- `GET /api/v1/books/:bookId/branding-designs/latest?kind=`：当前类型最新一轮主编设计及其候选。
- `GET /api/v1/opening-taxonomy`：频道、分类、题材和标签目录。
- `GET /api/v1/books/:bookId/workflow`：当前卷—事件工作流状态。

确认开书会原子创建书籍、定位版本、团队、模型绑定、预算和设定工作区；不会自动创建或排队AI设定任务。
同一作者不能创建标准化后同名的书籍，检查范围包含归档书；不同作者仍可使用相同书名。冲突返回 `BOOK_TITLE_CONFLICT`（409），且确认草稿保持可编辑，不创建任何下游数据。

五阶段核心接口：`GET /api/v1/books/:bookId/core-workflow` 返回设定→故事线→分卷→事件→章节的活动状态、滚动故事线版本与关系、逐卷参与、角色卡、事件角色绑定、规划/实际总账、作者最远节点、开放问题、增长候选、草稿和失效记录。`storylines`、`storyline-relations`、`volume-participations`、`storyline-frontier`、`storyline-open-questions`、`storyline-growth-rounds`、`storyline-growth-candidates`、`characters`、`event-role-assignments`、`drafts`、`ledgers`、`invalidations` 与 `state` 分别执行版本化写入、候选决策、确认、重开、影响处理和阶段推进；历史 `storyline_topology` 仅作为旧数据只读兼容对象，不再提供作者端写入入口。所有写入同时校验当前 `owner_id + book_id`、期望版本、幂等键与上游依赖。

## 4. 设定对象协作

- `GET /api/v1/books/:bookId/setting-outline-workspace`：当前宏观设定工作区、条目选择和逐项状态。
- `DELETE /api/v1/books/:bookId/setting-outline-workspace/:itemKey/current`：按当前 `owner_id + book_id + itemKey` 从活动设定和新任务临时资料包移除单项，清除当前内容、来源、确认与待定候选，使当前设定基线重新待审；不可变历史版本、正文和结算保留，活动检索片段归档。
- `GET /api/v1/books/:bookId/setting-outline-workspace/:itemKey/collaboration`：当前项候选、四名全能编剧的真实可用性与席位状态。
- `POST .../collaboration/start`：Body必须明确提交1—4个 `screenwriterRoleKeys`，只启动作者所选编剧。创建前从当前 `owner_id + book_id` 的活动设定工作区编译非正史临时资料包，只包含除当前项外已确认的宏观世界规则短摘要和内容指纹；已下架的人物、关系与剧情类旧键不会进入资料包，指纹变化时不得复用旧面板。
- `POST .../collaboration/start`、`restart`、单编剧 `redesign` 与失败成员 `retry` 都读取调用时的最新临时包。修改已确认条目会产生新指纹；清空工作区后新包为空。临时包只进入任务快照，不写入正式设定基线。
- `POST .../collaboration/restart`：重新设计当前项，仍必须重新明确选择编剧。
- `POST .../collaboration/members/:roleKey/redesign`：Body提交当前 `proposalId` 与 `idempotencyKey`，只为该方案所属编剧创建新任务。任务携带旧方案摘要与SHA-256指纹作为排除依据，要求在机制、代价和可写性后果上实质不同；读取接口按席位保留其他成员最近成功方案，并以该席新结果替换其当前候选。
- `POST .../collaboration/members/:roleKey/retry`：只重试失败席，保留其他成功候选。
- `POST .../collaboration/synthesize`：作者提交当前项所选 `proposalIds`、`wholeProposalIds`、`fragmentIds` 和独立幂等键；服务端校验来源属于当前项最新席位方案，只把明确选中的整案与片段交给活动主编，生成待确认编辑稿。`POST .../collaboration/revise`：作者先把完整修改稿保存为 `authorInputId`，再用独立幂等键让主编只基于该修改稿做专业化整理，不恢复已删内容或混入未选方案。历史任务和融合稿仍可通过协作读取接口恢复。
- 整篇设定质检和 `issues/:issueId/apply` 分别生成主编建议与采纳单条完整替换稿；采纳时校验基线哈希并创建新版本。
- 设定项确认、稍后补充/留白和整份设定基线确认使用独立命令。

这些接口直接读写当前设定对象、候选、作者选择和确认结果。

## 5. 作者想法与附件

作者想法按 `surface`、`subjectType`、`subjectId` 附着开书、设定、卷、事件链、事件、章纲或正文，并保存原话、意图等级、版本和状态。事件链使用 `surface=event`、`subjectType=event_sequence`、`subjectId=volumePlanId`；生成接口接收对应 `authorInputRefs`，同时继承确认卷方向仍有效的作者原话。附件使用 `/author-attachments` 上传、读取、绑定和丢弃。

## 6. 分卷

`/api/v1/books/:bookId/volume-plans` 提供列表、创建和详情。单个卷计划支持：作者输入、候选、AI生成任务、选择/融合、确认、历史切换、影响预览和结算。所有修改校验工作流版本与上游设定版本。

`GET /api/v1/books/:bookId/planning-templates?scope=volume|event` 返回后端统一模板注册表的公开投影、版本和哈希。推荐排序输入只来自该 `bookId` 的开书资料、当前活动卷和最近真实卷结算；推荐标记只改变展示顺序。客户端保存规划时提交所选模板版本、哈希和混合引用快照；自定义和不使用模板不绑定系统模板。

## 7. 事件链与事件大纲

`/api/v1/books/:bookId/volume-plans/:volumePlanId/story-events` 管理事件列表、顺序、插入、移动、拆分、合并、候选生成、确认和因果衔接。单个事件通过 `/story-events/:eventId` 获取详情、生成事件大纲和执行事件结算。

## 8. 当前事件章纲

`/api/v1/books/:bookId/story-events/:eventId/chapter-outlines` 管理章数评估、批量章链候选、单章详细章纲、作者修改、确认和历史版本。生成任务冻结活动卷纲、事件链、事件大纲和作者输入。

`POST /api/v1/books/:bookId/story-events/:eventId/chapter-sequence/versions/:sequenceVersionId/challenge` 请求另一位编剧挑战当前章链候选；`POST /api/v1/books/:bookId/story-events/:eventId/event-chapter-outlines/:outlineId/versions/:outlineVersionId/challenge` 挑战当前单章章纲。`GET .../chapter-sequence/generation?kind=sequence_challenge|detail_challenge` 读取当前建议任务。结果只含目标版本、自然语言摘要和最多3条替代建议，不创建正式章纲版本，也不自动采纳。

## 9. 正文与审查

章节接口提供目录、写作工单、单章生成、状态、稿件版本、作者编辑、定点修订和定稿。正式生产一次只处理一章。三席报告分别读取和展示；作者定稿后才能执行章节结算。



## 10. 续写与反向拆解

已有正文接口支持文件/文本导入、解析预览、章节顺序确认、不可变入库、分析任务、来源查看和反向规划候选。分析完成后通过设定、卷、事件和章纲对象继续。

## 11. 图谱、资料库、检索和取名

按书提供人物状态、实体、事实、关系、时间线、伏笔、来源、缺口、图谱投影、混合检索和命名候选。检索响应标注来源、版本、证据等级和降级状态；不暴露其他书结果。

`GET /api/v1/books/:bookId/library`返回独立的`settings`设定来源、`supportingCharacters`配角集合、正式`entities/facts`、按已结算事件聚合的`timeline`，以及`supportingCharacterProfiles`、`organizationProfiles`、`locationProfiles`、`itemResourceProfiles`和`worldMap`类型化公开视图。`supportingCharacters`及配角档案排除主角档案已绑定实体或同名实体；内部实体类型仍使用稳定键`character`。档案字段值携带来源章节，缺失字段返回空数组，不由接口补造。`worldMap`只从地点正式出场、明确出生地和作者初始地图说明构建大范围路线，方向无证据时为`null`。时间线保留后台结算摘要和规划归属供审计，同时提供`display_time`：正文有故事时间时使用故事时间，否则回退章节范围；作者页面只显示`display_time + event_title`。分类页不得自行按关键词把`settings`复制到势力、地点、道具或规则页，普通界面不得展示内部事实键或记录编号。

## 12. 团队、任务与模型

- `GET /api/v1/books/:bookId/editorial-team` 返回七岗位公开成员池；岗位池人数和成员启停的 PATCH 路由只允许管理员。
- `/api/v1/books/:bookId/ai-nodes` 提供作者本轮想法保存、动态消耗估算、批次创建/查询、增加成员、失败成员单独重试和换人；同批成员冻结同一资料包、Skill、模板和绑定版本。
- 作者端只显示成员公开身份、任务状态、结果和消耗档位；模型绑定详情只进入受权审计。

- 团队模板、逐书成员、岗位公开说明、真实状态和模型绑定。
- 普通AI岗位使用 `volcengine-ark-coding-plan` / `coding`；高级编剧使用 `volcengine-ark-agent-plan` / `agent` / `kimi-k3`。两条路线分别校验环境变量凭证，缺少 Agent Plan 只令高级编剧不可用。
- GLM-5.2/5.3 登记为 Coding Plan 可配置但未绑定的模型，可在管理员以后明确保存新方案时分配给合规 Agent 岗位；当前岗位方案保持零 GLM，历史无目录版本的 GLM 方案不会自动恢复。红玉使用 `doubao-seed-2.1-turbo`，西施使用 `deepseek-v4-flash`，班昭使用 `minimax-m2.7`，三席普通岗位均走 Coding Plan。
- 存量书创建新的活动模型绑定版本；运行中任务、历史调用快照和用量记录不可改写。
- 任务中心、任务详情、暂停、取消、失败重试和结果未知调和。
- 模型调用、预算和用量只显示可审计元数据，不返回密钥或思维链。


## 13. 备份、恢复和删除

备份、导出、导入和恢复操作均有操作ID、状态和校验结果。普通删除为归档。彻底删除只允许已归档书，先查看影响，再输入大小写不敏感的 `YES` 并二次提交；服务端原子清理书内记录及其已登记间接子记录并写墓碑，未知外键仍会令整笔事务回滚。

## 14. SSE事件

事件至少覆盖任务排队/开始/阶段/完成/失败/取消，模型调用开始/完成/中断，预算变化，投影水位，书籍版本变化和Worker心跳。事件只是状态通知，客户端重新读取正式对象作为最终状态。

## 作者可见功能名合同

接口向作者返回的五个核心页面统一为：设定、故事线、分卷、事件、章节；辅助工具统一为：资料库、取名、团队、任务、灵感、设置。公开显示名来自 Contracts 共享合同，手机端固定为两排导航。

API 路由、请求字段和数据库 surface 继续保留 `book_profile`、`setting`、`volume_plan`、`event`、`chapter_outline`、`manuscript` 等历史稳定键；V6 页面阶段使用 `setting/storyline/volume/event/chapter`。入口解析只做 `framework→setting`、`manuscript→chapter` 等兼容重定向，不迁移已有书籍、幂等键、任务恢复、上下文包或来源引用。接口返回历史自由文本前必须经过作者展示清洗，把旧称转换为当前名称，但不回写历史记录。

## 15. 认证与错误语义

`/health` 与注册/登录是公开入口；Worker内部执行使用独立Worker令牌；其他 `/api/v1` 接口都要求有效账号会话。写请求继续校验精确 Origin、Host、`Sec-Fetch-Site` 和 JSON 内容类型。登录失败统一返回“邮箱或密码不正确”，不泄露邮箱是否存在；暂停账号返回明确联系管理员提示；无效或空 JSON 返回自然中文格式错误，不向前端暴露堆栈、SQL或内部路径。

当前作者端错误合同按业务动作恢复，不按机器错误码分支：会员问题返回开通/续费/补充算力动作，设定质检问题返回查看问题动作，登录失效返回刷新登录动作，其余失败返回安全重试或返回修改动作。旧缓存前端未发送洁净投影头时继续收到向后兼容的旧结构，但其中供应商、模型和原始错误详情也必须使用安全占位，不能泄漏真实内部值。

## 16. 分层设计的作者投影

设定协作接口使用稳定proposalId接收整份方案与片段选择，融合请求可同时提交wholeProposalIds、selectedFragments和作者文字。作者响应只返回方案正文、理由、收益、代价、成员显示名和可恢复任务键；供应商、模型内部ID、讨论任务ID和决策ID只在审计接口保留。

洁净投影由API `onSend`统一递归完成，覆盖普通JSON与SSE；它删除owner/source内部ID、供应商/模型、任务阶段、模型与工具调用、内部方法版本/指纹、原始错误、路径和堆栈，并把剩余任务/讨论键改名为恢复/协作业务键。Web只在内存中为旧组件恢复兼容别名，网络响应和浏览器缓存都不重新出现被删除字段。管理员审计走独立 `/api/v1/admin/audit/...` 物理路由并再次校验管理员身份。

卷规划内容向后兼容增加routeCard、storySpine和firstVolumeLaunch。第一卷生成候选必须包含三章开篇职责和重大高潮字数上限；旧客户端省略这些字段时仍能读取旧版本和保存原有字段，后端字段只增不删。

公开事件软参考不返回专业来源字段。事件大纲生成最多接收一个阅读感受选择；旧请求中的选择数组继续可解析，但只采用明确的主选择，不能拼接多套完整节拍。
