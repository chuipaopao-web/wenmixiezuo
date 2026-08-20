# 当前API与事件契约

## 1. 通用规则

- 前缀：`/api/v1`；健康检查为 `/health`。
- API仅监听 `127.0.0.1`；公网由同机HTTPS反向代理转发 `/api`，不得直接暴露API、SQLite或Worker端口。
- 所有书内接口从路径获取 `bookId`，服务端从已验证登录会话绑定 `owner_id`；客户端不能提交或替换所有者。
- 成功响应包含 `data` 与请求追踪ID；失败响应包含稳定错误码、可读消息、是否可重试和必要详情。
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
- `GET /api/v1/admin/users`：管理员按关键字和状态查看账号。
- `PATCH /api/v1/admin/users/:userId/status`：管理员暂停或恢复账号。
- `GET /api/v1/membership/me`：当前账号会员状态（套餐、算力值配额/已用/剩余、到期时间）；管理员返回 `isAdmin: true` 不限额。
- `GET /api/v1/admin/memberships`：管理员查看全部账号的会员与算力值消耗（周期内消耗与累计消耗）。
- `POST /api/v1/admin/memberships/:userId`：管理员开通或续费会员，套餐 `monthly`（包月3亿）/`quarterly`（包季10亿）/`yearly`（包年百亿），算力值即token。
- `POST /api/v1/admin/memberships/:userId/revoke`：管理员撤销会员。
- 生成门禁：账号体系内的非管理员用户必须持有生效会员且周期内算力值未用完，否则任务创建返回 `MEMBERSHIP_REQUIRED` 或 `MEMBERSHIP_QUOTA_EXHAUSTED`（403，附管理员联系方式）。
- `GET /api/v1/capabilities`：当前模型、检索和运行能力。

## 3. 书架与开书

- 书籍草稿：创建、更新、确认。
- `GET /api/v1/books`：书架。
- 书籍详情、开书资料、定位、表达基线、归档、恢复和彻底删除。
- `POST /api/v1/books/:bookId/branding-designs`：主编依据第一卷已确认方案、设定基线和开书信息设计书名或书籍简介候选（`kind` 为 `title` 或 `synopsis`）；第一卷未确认返回409并提示先设计第一卷。
- `GET /api/v1/books/:bookId/branding-designs/latest?kind=`：当前类型最新一轮主编设计及其候选。
- `GET /api/v1/opening-taxonomy`：频道、分类、题材和标签目录。
- `GET /api/v1/books/:bookId/workflow`：当前卷—事件工作流状态。

确认开书会原子创建书籍、定位版本、团队、模型绑定、预算、设定工作区和首个设定任务。

## 4. 设定对象协作

- `GET /api/v1/books/:bookId/setting-outline-workspace`：当前设定工作区。
- `GET /api/v1/books/:bookId/setting-outline-workspace/:itemKey/collaboration`：当前项AI方案与任务。
- `POST .../collaboration/start`：主编和两位编剧独立提案。
- `POST .../collaboration/synthesize`：按作者选中的方案整理候选。
- `POST .../collaboration/revise`：按作者本轮意见修订候选。
- 设定项确认、跳过/留白和整份设定基线确认使用独立命令。

这些接口直接读写当前设定对象、候选、作者选择和确认结果。

## 5. 作者想法与附件

作者想法按 `surface`、`subjectType`、`subjectId` 附着开书、设定、卷、事件、章纲或正文，并保存原话、意图等级、版本和状态。附件使用 `/author-attachments` 上传、读取、绑定和丢弃。

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

- 团队模板、逐书成员、岗位公开说明、真实状态和模型绑定。
- 任务中心、任务详情、暂停、取消、失败重试和结果未知调和。
- 模型调用、预算和用量只显示可审计元数据，不返回密钥或思维链。


## 13. 备份、恢复和删除

备份、导出、导入和恢复操作均有操作ID、状态和校验结果。普通删除为归档。彻底删除只允许已归档书，先查看影响，再输入大小写不敏感的 `YES` 并二次提交；服务端原子清理并写墓碑。

## 14. SSE事件

事件至少覆盖任务排队/开始/阶段/完成/失败/取消，模型调用开始/完成/中断，预算变化，投影水位，书籍版本变化和Worker心跳。事件只是状态通知，客户端重新读取正式对象作为最终状态。

## 作者可见功能名合同

接口向作者返回的功能名称统一为：信息、设定、分卷、规划、章纲、正文、资料库、取名、团队、任务、灵感、设置。公开显示名来自 Contracts 共享合同。

API路由、请求字段和数据库surface继续使用稳定英文键，不随显示名改动：book_profile、setting、volume_plan、event、chapter_outline、manuscript。这样已有书籍、幂等键、任务恢复、上下文包和来源引用不需要迁移。接口返回历史自由文本前必须经过作者展示清洗，把旧称转换为当前名称，但不回写历史记录。

## 13. 认证与错误语义

`/health` 与注册/登录是公开入口；Worker内部执行使用独立Worker令牌；其他 `/api/v1` 接口都要求有效账号会话。写请求继续校验精确 Origin、Host、`Sec-Fetch-Site` 和 JSON 内容类型。登录失败统一返回“邮箱或密码不正确”，不泄露邮箱是否存在；暂停账号返回明确联系管理员提示；无效或空 JSON 返回自然中文格式错误，不向前端暴露堆栈、SQL或内部路径。

## 14. 分层设计的作者投影

设定协作接口使用稳定proposalId接收整份方案与片段选择，融合请求可同时提交wholeProposalIds、selectedFragments和作者文字。作者响应只返回方案正文、理由、收益、代价、成员显示名和可恢复任务键；供应商、模型内部ID、讨论任务ID和决策ID只在审计接口保留。

卷规划内容向后兼容增加routeCard、storySpine和firstVolumeLaunch。第一卷生成候选必须包含三章开篇职责和重大高潮字数上限；旧客户端省略这些字段时仍能读取旧版本和保存原有字段，后端字段只增不删。

公开事件软参考不返回专业来源字段。事件大纲生成最多接收一个阅读感受选择；旧请求中的选择数组继续可解析，但只采用明确的主选择，不能拼接多套完整节拍。
