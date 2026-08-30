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
- `GET /api/v1/admin/v7/prompt-context/summary`：V7提示资产、书级题材档案、任务合同、ContextPack与PromptManifest数量概览。
- `GET /api/v1/admin/v7/prompt-context/assets`、`GET /api/v1/admin/v7/prompt-context/assets/:assetKey/versions`：按岗位提示、工位提示、题材人设或Skill读取当前版本与不可变历史。
- `POST /api/v1/admin/v7/prompt-context/assets/:assetKey/drafts|preview|publish|restore-draft`：创建草稿、用模拟或历史资料预览、发布新版本、从历史版本创建恢复草稿。发布与恢复都不原地改写历史任务。
- `GET /api/v1/admin/v7/prompt-context/manifests`、`GET /api/v1/admin/v7/prompt-context/manifests/:manifestId`：按书或任务查看一次调用冻结的岗位、工位、题材档案、Skill、任务合同、资料采用/排除、模型参数和最终提示摘要；密钥和思维链不返回。
- `POST /api/v1/admin/v7/prompt-context/manifests/:manifestId/verify-rebuild`：只读重建冻结提示并核对哈希，不重新调用模型、不修改作者数据。
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

### 3.1 V7 建书前开书 Agent

- `POST /api/v1/v7/opening-agent/tasks`：登录作者提交 `idea`、`idempotencyKey`，可选 `selectedChiefMemberKey` 与 `selectedScreenwriterMemberKey`。接口先保存账号级任务壳，再由主编建立任务书、编剧设计开书资料包、主编审查；不会创建正式书籍。
- `GET /api/v1/v7/opening-agent/tasks/:taskId`：只按当前会话的 `owner_id + task_id` 返回作者可见状态、成员显示名和追加候选版本。刷新会尝试取得短租约继续未完成任务；结果未知只对账，不重复发送模型请求。
- 同一账号和幂等键重复提交相同内容返回原任务；内容或成员选择变化返回409并要求使用新编号。不同账号即使知道任务ID也返回404。
- 主编与编剧默认使用火山方舟 Coding Plan；成员模型为 `kimi-k3` 时强制使用 Agent Plan。套餐绑定在调用前校验，缺少凭据时不使用现金API或其他未授权通道兜底。
- 候选只是作者可修改、可确认的规划资料。响应不返回供应商、模型ID、请求ID、密钥、原始错误或思维链。

V7 成员治理（仅管理员）：

- `GET /api/v1/admin/v7/agent-governance`：返回当前七个固定岗位、25名唯一成员、19类任务温度策略和治理版本。一个成员只能属于一个固定岗位；题材能力由任务运行时的题材档案提供，不永久绑定成员。
- `PATCH /api/v1/admin/v7/agent-governance/members/:memberKey`：按治理版本调整成员上岗、默认顺序、备用顺序、批准的模型档案和任务温度偏移；旧版本返回409。豆包文本模型只能担任主笔，Seedream只承担封面出图。
- `PATCH /api/v1/admin/v7/agent-governance/task-policies/:taskKind`：在该任务类型登记的安全区间内调整默认温度；不能用统一温度覆盖所有创作、审查和结算任务。
- `GET/PATCH /api/v1/admin/v7/opening-agent/members...`：只保留早期开书成员治理与历史任务恢复兼容。V7新任务不得从该两岗位旧名册建立默认成员。
- 每个固定岗位始终至少一人上岗且恰好一名默认成员。新任务冻结当时的成员、模型、岗位、工位、Skill、TaskContract、ContextPack与PromptManifest；后台后续调整只影响未来任务，技术重试继续使用首次冻结快照。

### 3.2 V7 设定清单与编辑部

- `GET /api/v1/v7/books/:bookId/setting-department`：返回当前书的完整设定目录、已经确认/候选的设定、编辑部成员、最近实际设定批次，以及本书主编设定清单任务。读取接口只恢复已存在任务，不会暗中创建模型调用。
- `POST /api/v1/v7/books/:bookId/setting-recommendations`：由作者明确点击后，为本书创建一次主编整理任务。主编读取作者已确认的完整开书规划和完整设定目录，把每个目录键恰好归入“现在需要、以后可补、暂时不用”之一；系统只校验所有权、开书版本/哈希、目录完整性、核心项和结果格式，不再用关键词替主编判断题材。
- 每本书最多发送一次上述主编模型请求。重复点击、刷新、离开重进或开书资料后来形成新版本，都只返回已有记录，不会自动换人、重试或再次调用；资料变化后旧清单显示过期。模型失败如实保存为失败，不用旧关键词推荐冒充成功结果。
- `GET /api/v1/v7/books/:bookId/setting-recommendations/:taskId`：按当前 `owner_id + book_id + task_id` 恢复主编头像、公开阶段、进度和三类结果；不返回模型名、内部错误、提示词、哈希或思维链。
- `PUT /api/v1/v7/books/:bookId/setting-selection` 校验作者选择；`POST .../setting-batches` 只为尚无有效结果的新增条目创建编剧任务，已有条目不会因补充设计被重做。后续批次读取、单项修改、复审、重做、融合和确认接口保持原有不可变版本语义。
- `POST .../setting-items/:itemKey/redesigns` 由作者为当前单项选择1—3名强模型编剧，缺省交互选中1名。每份输出独立保存；响应返回成功`candidates`与`failedMemberKeys`，单人失败不撤销其他成功方案。作者可采用一份交主编复审，或选择多份由主编融合；不会把整批设定乘以三套重复生成。

### 3.3 V7 三棵竖向综合规划树

- `POST /api/v1/v7/books/:bookId/planning-recipes/runs`：服务端冻结当前正式开书资料、已确认设定和作者本次目标。`candidateCount`为1—3，缺省1；作者可为每案选择不同强模型主编。每位主编读取同一硬事实与独立轻量方法包，直接完成一套兼顾结构、商业、人物与创意的全书方向，不再把完整资料重复转交给另一层编剧；客户端不能提交或改写来源清单。
- `GET /api/v1/v7/books/:bookId/planning-recipes/runs/:runId`：恢复本轮请求席位、各案真实进度和已成功方案。一案完成即可选择；两案以上才执行一次非阻断比较点评。单席失败保留其他方案并只补失败席，不得整批清空重做。成员、模型、调用和提示词内部信息只在管理员审计接口中可见。
- `POST /api/v1/v7/books/:bookId/planning-recipes/runs/:runId/confirm`：作者确认某席原案或主编整理案，产生不可变确认配方版本；方法只作为软参考，不会自动创建或确认规划树。
- `POST /api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/generation-runs`：按确认配方、当前正式来源和精确父树版本创建规划成员任务。结果只保存为候选树，必须由作者另行确认；任务期间来源变化则停止写入。
- `GET /api/v1/v7/books/:bookId/planning-tree-generation-runs/:runId`：恢复规划树任务状态和候选入口；失败按同岗位备用成员交接，结果未知时暂停以避免重复消耗。
- `GET /api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId`：读取当前全书树（`book`）、单卷树（`volume`）或单元链树（`chain`）。返回可直接竖向渲染的综合节点、当前修订、候选/确认状态和来自正式结算的实际进度；不返回来源清单、哈希、模型、方法编号或结算证据内部键。
- `GET .../history`：读取不可变版本的修订、状态和时间摘要，不回传内部版本ID或完整审计资料。
- `POST .../candidates`：保存一份完整候选树。Body包含`expectedRevision`、`tree`、带版本的`sourceRefs`和`idempotencyKey`；树层级和URL范围必须一致。
- `PATCH .../candidate`：对当前候选或已确认树执行节点修改、直接子节点增删或同父重排，并生成新的完整候选快照，不原地覆盖旧版本。
- `POST .../confirm`：确认当前候选。确认后旧确认版本转为历史，正文和结算不被修改。
- `GET /api/v1/v7/books/:bookId/planning-maintenance-runs/:runId`：读取一次正式结算后的规划维护任务。维护成员只能追加节点实际和未来调整建议，不能改写确认树或正文。
- `GET /api/v1/v7/books/:bookId/planning-adjustment-suggestions`：读取尚待作者决定的未来调整建议。
- `POST /api/v1/v7/books/:bookId/planning-adjustment-suggestions/:suggestionId/decision`：作者选择`accept`或`dismiss`。采纳项只会作为下一版候选规划的目标来源，不会直接修改当前确认规划或实际记录。
- `POST /api/v1/internal/worker/v7/books/:bookId/planning-maintenance`：登记过的内部Worker在正式章、事件或卷结算生效后触发增量维护；服务端核对`ownerId`、结算版本、证据和当前确认树，重复结算幂等。
- `GET /api/v1/admin/v7/planning-runtime/:runKind/:runId?ownerId=&bookId=`：管理员只读审计配方、树生成或维护任务的来源快照、成员交接、调用、作者决定和写入结果。
- 正文实际进度没有作者直写HTTP入口；只有可信结算服务可以触发内部维护能力，并且必须提交已生效结算版本。规划调整与实际回写均按`owner_id + book_id`隔离。

### 3.4 V7人物角色管理

- `POST /api/v1/v7/books/:bookId/characters/sync`：把同书正史人物和开书主角确定性对齐到V7人物目录；不调用模型，不凭名字推断人物关系。
- `GET /api/v1/v7/books/:bookId/characters`、`GET .../characters/:profileId`：读取人物总览或单人详情，明确分开稳定档案、当前正史状态、关系、角色知情边界和历史来源。
- `POST /api/v1/v7/books/:bookId/characters`：作者新增正式人物身份及首个确认档案版本。`POST .../characters/:profileId/versions`追加候选或作者确认版本，`POST .../versions/:versionId/activate`显式切换活动版本；`POST .../aliases`同步更新同书人物身份和档案别名并阻止与其他人物重名，`PATCH .../organization`只调整核心、重要、配角等组织层级，归档和恢复不永久删除历史。以上写操作均要求幂等操作编号并保留操作者记录。
- `POST /api/v1/v7/books/:bookId/character-context-packs`：上游提交当前任务、同书结构化人物候选、关系读取深度和Token预算；人物资料成员只从候选中选择真正相关的人物与字段。`GET .../character-context-packs?taskKind=&taskId=`读取历史，`GET .../character-context-packs/:packId`恢复单次状态和完成后的最小资料；作者响应不返回模型、提示词、哈希或内部失败详情。
- `POST /api/v1/internal/worker/v7/books/:bookId/character-maintenance`：登记Worker在正式章、事件或卷结算生效后触发人物增量维护；同一结算幂等。维护只生成有证据的档案/正史缺口候选与分级问题，不直接修改正文或正史投影。
- `GET /api/v1/v7/books/:bookId/character-maintenance-runs/:runId`、`character-change-candidates`、`character-review-issues`：分别恢复维护进度、待处理人物变化和审查问题。明确失败的资料包或维护任务可调用其`/retry`重新交接并使用新尝试编号；结果未知时禁止重试，避免重复扣量。
- `POST .../character-change-candidates/:candidateId/decision`：作者采纳或忽略人物变化建议。采纳档案建议后仍需创建并激活新档案版本；采纳正史缺口后仍需进入正史审核，不会直接改写人物实际。`POST .../character-review-issues/:issueId/decision`只记录问题已处理或忽略。
- `GET /api/v1/admin/v7/character-memory/runs/audit?ownerId=&bookId=&runId=`：管理员查看冻结成员、调用状态、用量和结构化结果；接口再次校验管理员身份，不返回密钥或思维链。
- 所有人物接口按会话`owner_id + book_id`隔离。人物资料包在正史修订变化后失效；结果未知不重调，普通失败按冻结备用成员顺序交接。

### 3.5 V7第一卷创作闭环

- `POST /api/v1/v7/books/:bookId/creation-workflows`：从本书已确认全书路线和全书树启动一个可恢复的卷创作任务。`candidateCount`为1—3，缺省1；作者可按席位选择不同规划成员。服务端冻结正式开书资料、确认设定、当前父树、最近实际、相关人物与少量方法配方；客户端只能提交本卷目标、候选数量、成员偏好和幂等编号，不能自报正式来源。
- `GET /api/v1/v7/books/:bookId/creation-workflows/:workflowId`：恢复当前检查点、请求案数、各席成功方案、非阻断比较点评、作者决定、章纲候选、正文候选与下一步。部分成员失败时保留其余成功方案；作者只看到真实大白话状态，不返回模型、提示词、哈希、内部键或堆栈。
- `POST .../options/choose`：作者选择卷方案或链方案。每类决定只能确认一次，重复幂等请求返回原决定，不能从旧页面改选另一个方案覆盖已经确认的方向。
- `POST .../continue-to-chain`：在卷方案确定后继续当前单元链；同样接受1—3案和成员偏好，缺省1。两案以上才比较；链内容仍是候选，作者确认前不进入正式规划。
- `POST .../outlines`：按已确认链生成1—3份完整章纲候选，缺省1。`memberKeys`可指定不同规划成员，`replaceCandidateId`只重新设计指定候选；每案独立审查和保存，其他成功章纲不受影响。
- `POST .../outlines/confirm`：采用一份已通过审查的章纲候选，并原子提升为正式章纲序列、保存作者决定、选中候选和工作流检查点；重复请求返回同一正式章纲编号。
- `POST .../manuscripts`：只读取确认章纲和最小可信资料生成正文候选，再交给独立审校；主笔不读取其他候选过程，审校只绑定本次精确正文版本。
- `POST .../managed/activate`：作者看见剩余章数和预计写作/复核次数后，明确选择“托管写完本链”。可同时指定主笔与审校成员；任务按章顺序执行，失败可换成员后再次激活，结果未知则冻结，不会重复下单。普通章纲确认不会隐式启动连续模型调用。
- `POST .../cancel`：停止尚未完成的创作任务并写入幂等控制收据；取消只终止未来工作，保留已完成方案、章纲、正文、审校、结算和调用审计。
- `POST .../manuscripts/finalize`：作者定稿不可变正文，并在同一事务写入`settle_chapter`正式化事件。重复请求返回原结果，不重写正文或重复入队。
- `GET .../write-back`：读取结算、人物维护、规划维护和故事状态维护的真实进度。单个消费者明确失败时可独立交接重试；结果未知时停止重发，正文定稿不回滚。
- `POST /api/v1/internal/worker/v7/creation-formalization/process`：登记Worker从正式化积压中按顺序追赶章结算及独立维护消费者；接口受Worker令牌保护。Worker关闭时事件仍保留在outbox，恢复后幂等追赶。
- `POST /api/v1/internal/worker/v7/managed-creation/process`：受保护的单次托管追赶入口。默认部署不调度该入口，避免服务重启后未经作者再次确认便继续产生模型调用；当前作者显式激活后由API进程持续完成本链。
- `GET /api/v1/v7/books/:bookId/story-state`：读取由定稿正文证据产生的故事线、伏笔和开放问题洁净投影；规划、摘要和未确认候选不能冒充实际。
- `GET /api/v1/v7/admin/books/:bookId/creation-workflows/:workflowId/audit`：管理员只读查看本轮请求候选数、资料包数量与字符量、成员/模型快照、逐次调用用量、卷链方案、章纲草案、决定、正文版本、审校、结算、outbox和维护状态；不返回调用输出正文。该接口要求管理员会话并再次校验`owner_id + book_id`。独立后台兼容旧API响应，前后端滚动更新期间不会因缺少新字段白屏。
- 全链路按`owner_id + book_id + workflow_id`隔离。只有确认全书方向和确认全书树才能启动；第一卷增加开篇抓力、黄金前三章和首个明确回报责任，普通卷改读上一卷实际，不机械复用首卷公式。

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
