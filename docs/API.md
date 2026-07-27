# API与事件契约 v1

## 1. 通用规则

- 基础路径：`/api/v1`。
- 传输：JSON；文件上传和导出使用明确的文件接口。
- 所有书籍范围接口从路径或令牌上下文获得 `owner_id` 与 `book_id`，服务端Repository再次验证。
- 任务、模型调用和工具调用等可重试操作使用持久幂等键；带乐观锁的资源命令使用明确版本号。
- 所有资源返回稳定ID、版本、创建时间和修改时间。
- 正史等重大命令必须携带服务端创建的 `confirmationId`；书籍永久删除只接受规范化后的 `YES`，并由服务端校验书籍已归档。
- 供应商专属字段只能存在模型适配器配置，不进入领域API。

成功响应：

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid",
    "version": 1
  }
}
```

错误响应：

```json
{
  "error": {
    "code": "BOOK_VERSION_CONFLICT",
    "message": "当前书籍版本已经变化",
    "details": {},
    "retryable": false
  },
  "meta": {
    "requestId": "uuid"
  }
}
```

## 2. 健康与启动

除根级 `/health` 外，下表路径均位于 `/api/v1`。表中接口是当前长篇release契约；兼容入口会明确标记弃用，契约测试和路由清单负责防止文档漂移。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | 只返回API状态、release、时间；详细能力走受会话保护的 `/capabilities` |
| GET | `/runtime/readiness` | 汇总API和Worker是否可用 |
| GET | `/runtime/worker` | Worker真实心跳、能力和最近任务 |

未通过健康检查时，查看、导出和恢复入口可以保持可用，但不能领取新的模型任务。

`/health` 不返回数据库、目录、模型或资产细节。受会话保护的 `/capabilities` 中，`modelRuntime` 只返回请求模式、活动模式、缺失凭证名称、是否禁止现金回退，以及模型/岗位/套餐的公开映射；`localUtilityRuntime` 只返回资产/哈希/设备/能力/降级状态和策略版本。不得返回API Key、Worker Token、Codex认证材料、供应商请求头或本地模型文件绝对路径。

## 3. 书籍与定位

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/opening-taxonomy` | 读取带版本、来源说明、分类扩展包和分组标签库的本地开书目录 |
| POST | `/opening-synopsis/analyze` | 无状态识别最多5000字符的剧情梗概，返回可修改的开书字段候选，不保存原文 |
| POST | `/books/drafts` | 创建开书草稿；当前Web提交完整 `openingBlueprint`，旧字段只用于历史兼容 |
| PATCH | `/book-drafts/{draftId}` | 修改开书草稿及其定位版本 |
| POST | `/book-drafts/{draftId}/confirm` | 原子创建书、开书资料、主角候选、11个创作Agent、预算、会话和主编主动开场任务 |
| GET | `/books` | 查询当前老板的书籍 |
| GET | `/books/{bookId}` | 查询书籍、定位、版本和生命周期 |
| POST | `/books/{bookId}/archive` | 归档书籍 |
| POST | `/books/{bookId}/restore` | 使用乐观版本恢复已归档书籍 |
| POST | `/books/{bookId}/purge` | 已归档书输入YES后永久删除并写墓碑 |

建书确认必须包含开书草稿版本，防止确认旧版本。开书资料校验频道、一个主分类、最多8个题材、2—8个主要标签及作品边界；自定义标签不能冒充分类键。旧客户端提交的目标读者字段继续兼容，但新书不再要求填写。开书参考资料和软标签不得声称已形成正史生成门禁。叙事视角仍在首个正式写作工单前确认；“情绪引擎”不属于开书API。

## 4. Agent与岗位

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/agents` | 分开返回 `utilityAssistant` 与 `creativeAgents`：小文秘书工具角色、团队模板版本、11个创作Agent、公开合同、模型和真实状态；旧书可返回历史9实例 |
| GET | `/books/{bookId}/agents/{agentId}` | 返回公开职责、边界、激活条件、交付物、模型来源、当前任务、最后有效贡献和证据，不返回原始系统提示或思维链 |
| POST | `/books/{bookId}/agents/{agentId}/activate` | 按任务激活按需专家 |
| GET | `/books/{bookId}/editor-lease` | 返回活动主编、副编、epoch和可验证接管状态 |
| POST | `/books/{bookId}/editor-handoffs` | 在老板指定、正式交接或故障条件下原子接管 |
| GET | `/books/{bookId}/model-bindings` | 查询活动绑定、历史修订、允许模型池和实际共同来源 |
| POST | `/books/{bookId}/model-bindings/preview` | 预览未来剧情席、写手和三点评独立性及套餐影响，不改变当前配置 |
| POST | `/books/{bookId}/model-bindings/{revisionId}/activate` | 能力、独立性和现金保护检查通过后原子激活未来任务配置 |
| GET | `/books/{bookId}/local-assistant` | 返回小文秘书公开合同、真实状态、当前受理/检索任务、降级原因和本地策略版本，不返回隐藏提示或绝对模型路径 |

岗位和模型调整必须生成新的配置快照，不能修改历史任务使用的快照。

团队列表的每项必须至少包含 `publicSummary`，供190像素成员栏直接显示；详细接口返回 `publicResponsibilities`、`publicBoundaries`、`activationTriggers` 和 `deliverables`。内部提示、安全规则、密钥和隐藏工具参数不属于任何前端响应。研究员未激活时返回真实待命状态且没有伪造任务；激活必须绑定明确研究问题和来源预算。

## 5. 对话与讨论

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/messages` | 分页查询书籍消息 |
| POST | `/books/{bookId}/messages` | 原样持久化老板消息，可携带同书临时 `attachmentIds`，并返回 `messageId/contentHash/routingReceipt`；异步路由不能改写原文，本地回执统一以小文秘书身份呈现 |
| POST | `/books/{bookId}/chat-attachments` | `multipart/form-data` 上传单个图片或文件，本地保存并返回真实解析状态；单文件最多20 MiB |
| GET | `/books/{bookId}/chat-attachments/{attachmentId}/content` | 读取同书原附件内容，用于图片预览或文件查看 |
| POST | `/books/{bookId}/chat-attachments/{attachmentId}/discard` | 丢弃未发送附件；已绑定消息的附件不得移除 |
| POST | `/books/{bookId}/discussions` | 建立有范围和预算的讨论 |
| GET | `/books/{bookId}/discussions/{discussionId}` | 查询阶段、参与者、意见和草案 |
| POST | `/books/{bookId}/discussions/{discussionId}/confirm` | 确认候选方案为项目决定 |
| GET | `/books/{bookId}/routing-decisions/{routingDecisionId}` | 查询路由类别、风险/置信、点名、实体、所用规则/本地模型、选择/排除原因、任务和改派结果 |
| POST | `/books/{bookId}/routing-decisions/{routingDecisionId}/correct` | 老板显式改派或纠正路由；保留原决定并创建纠正事件 |
| GET | `/books/{bookId}/local-assistant/experiences` | 查询当前书的工具/路由经验候选、活动版本、反例、到期和回滚状态 |

每条意见返回真实 `agentId`、岗位、`modelProvider` 和 `modelId`。离线或未回复成员不生成伪造意见。
普通消息先按“确定性命令→显式点名→活动会话续接→低风险本地处理→专项岗位→剧情会话→主编升级”路由。低风险结果可以由小文秘书基于确定性查询或有来源的本地模型候选回复；点名消息直接创建对应成员任务；低置信或需要创作判断时创建 `conversation_reply` 持久任务。进入书籍默认即自由聊天，聊天不会自动写入长期记忆。

公开消息不再返回独立“系统”说话者。历史 `sender_type=system` 作为兼容来源保留，但客户端必须显示为小文秘书；新回执使用 `message_type=local_assistant_notice`。问候、身份说明、任务概览和资料库导航由确定性本地路径处理且不创建模型调用；未处理错误返回安全、自然的说明和请求追踪信息，不回显堆栈、SQL、绝对路径或秘密。

`conversation_reply` 与 `discussion_summary` 的 `content` 是默认可见的有效内容。若完整允许展示的最终回复与默认内容不同，`references_json` 追加 `{ "type": "effective_output", "version": 1, "format": "structured|fallback", "fullContent": "...", "contentHash": "sha256" }`；它可以与 `chat_attachment`、`discussionId`、`decisionId` 等既有引用共存。客户端必须允许按需展开，引用缺失或校验字段不合法时继续显示 `content`，不得报错或猜测缺失内容。该引用不包含思维链，不进入正式向量索引，不替代讨论意见表和模型调用审计。

面向普通作者的读模型不得直出模型协议、JSON字符串、内部ID/哈希、owner/book、模型快照或来源ID。服务端可以保留原始审计响应，Web工作台必须使用专用作者投影；状态与枚举返回稳定机器值时，客户端显示中文。被其他文本包裹的版本化结构结果可以使用转义感知的平衡对象提取，但只接受有效白名单字段；`fallback` 不得把原始协议、所有岗位长输出或规划载荷直接作为可展开内容。高级诊断接口与普通作者读模型必须分离。

剧情创作意图不由小文秘书回答。接口保留老板完整原话，建立/续接活动剧情讨论，并按活动绑定创建两个异模型独立意见任务，默认DeepSeek＋GLM，Kimi可替换一席，豆包禁止进入。二者直接面向老板、提交前互不可见，并各自返回最小/推荐/最大章节跨度、剧情单元、前提和不确定性；随后主编读取真实意见、设定硬约束和有界交叉质疑后汇总，再以 `确认方案 <decisionId>` 零Token确认。只有重大改向创建新独立轮次，普通追问不重复初始化全套会话。

普通消息若被识别为明确的资料治理命令，例如“增加隐藏身份标签”“给张三增加隐藏身份标签”或“把暗线作为伏笔的别名”，由活动主编调用受限知识工具。单书、对象明确且可撤销的操作直接执行，消息回复包含变更ID、对象、前后值、正史/候选状态、投影状态和撤销入口；歧义、同名、跨书或批量影响只产生一个必要澄清问题。其他Agent提出的标签只能进入候选。

聊天消息默认持久归档但不进入正式向量索引。对话附件固定属于临时层：同一消息最多6个，图片只预览，TXT/Markdown/JSON/CSV/LOG、可提取文字PDF和DOCX返回真实解析状态；扫描PDF返回无文本而不是伪造OCR结果。附件上下文合计最多12,000字符，保留文件名、哈希和附件ID回链，不自动进入正史、正式正文或正式向量投影。后续DEC-016运行时接口必须把 `authorityState`（临时/候选/正史/派生）、`lifecycleState`、来源版本和保留类别分开返回；归档、恢复和清理操作必须幂等，永久删除继续走归档状态、YES、二次点击和墓碑接口。

`POST /books/{bookId}/purge` 仅接受已归档书籍；活动书返回冲突。请求体为 `{ "confirmationText": "YES" }`；服务端对输入执行 `trim().toUpperCase()` 后必须等于 `YES`，否则返回 `PERMANENT_DELETE_CONFIRMATION_INVALID`。成功事务必须先写墓碑、清理全部同书作用域数据、最后删除书籍，防止旧备份静默复活；任一步失败整体回滚。

标记为 `creative_planning` 的确认会生成或新增版本并选择 `creative_plan`、`story_bible`、`master_outline` 和请求范围内的 `chapter_outline`。普通讨论确认不自动改写规划成果。

## 6. 规划成果

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/planning-workspace` | 查询设定框架、总纲、真实卷树、章纲索引、章节状态、活动/候选版本和资料缺口 |
| GET | `/books/{bookId}/artifacts` | 按类型查询创作方案、故事圣经和大纲 |
| POST | `/books/{bookId}/artifacts/generate` | 创建规划任务 |
| GET | `/books/{bookId}/artifacts/{artifactId}/versions` | 查询版本历史 |
| POST | `/books/{bookId}/artifacts/{artifactId}/select` | 选择活动版本 |
| POST | `/books/{bookId}/artifacts/{artifactId}/revert` | 从历史版本创建新版本 |
| GET | `/books/{bookId}/plot-span-estimates` | 查询两名编剧独立估算、主编推荐、前提、不确定性和历史版本 |

返回历史版本时不能直接改旧文件或旧记录。

`planning-workspace` 是前端专用的有界聚合读模型，不创建第二份权威数据。默认只返回卷摘要、章索引和当前选择状态；具体成果内容按页签/卷/章节继续请求。1500章必须支持 `volumeId`、状态筛选、搜索和游标分页，不能一次返回全书全部章纲。每个节点至少携带稳定ID、父级、顺序、标题、类型、状态、活动版本、候选数量、来源和更新时间；设定框架与资料库通过来源ID关联，不能复制并各自修改同一事实。

## 7. 章节与稿件

当前使用 `POST /books/{bookId}/writing-runs` 从已确认规划启动“下一章”，不要求作者提交1/3/5批次数。若创作方案、活动故事圣经、总纲或下一章的老板确认章纲缺失，接口返回结构化 `409 OPERATION_INCOMPLETE`，且不会创建章节或章节任务；对话入口不会把错误直接展示给作者，而是在当前自由聊天中发起或复用规划讨论。历史 `/chapter-batches` 仅作为弃用兼容入口，不能在新UI出现，也不能调度多章；带 `count > 1` 的旧请求返回迁移提示。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/chapters` | 查询卷章、阶段和结算状态 |
| POST | `/books/{bookId}/writing-runs` | 依据活动规划决定启动唯一下一章；不接受批次数 |
| GET | `/books/{bookId}/chapters/{chapterId}` | 查询章纲、稿件、事实和结算 |
| GET | `/books/{bookId}/chapters/{chapterId}/manuscripts` | 查询不可变完整稿件版本 |
| POST | `/books/{bookId}/chapters/{chapterId}/select-manuscript` | 选定候选稿 |
| POST | `/books/{bookId}/chapters/{chapterId}/settle` | 触发事实与正史结算 |
| GET | `/books/{bookId}/chapters/{chapterId}/content` | 按字符范围读取正文，单次最多100000字符 |

创建后章任务时，服务端必须检查前章 `settled` 状态。

## 8. 任务和控制

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/tasks` | 查询当前和历史任务 |
| GET | `/books/{bookId}/tasks/{taskId}` | 查询任务书、阶段、依赖、调用和产物 |
| POST | `/books/{bookId}/tasks/{taskId}/pause` | 在安全检查点暂停 |
| POST | `/books/{bookId}/tasks/{taskId}/resume` | 版本校验后继续 |
| POST | `/books/{bookId}/tasks/{taskId}/cancel` | 真实取消底层调用并收口 |

结果不明的调用不能通过普通重试接口重新调用，必须先由活动主编处理。

## 9. 记忆、检索与上下文

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/library/overview` | 查询资料库总览、类型数量、冲突和任务相关缺口 |
| GET | `/books/{bookId}/library/entities` | 按角色、势力、地点、道具、事件、规则等类型查询实体卡 |
| GET | `/books/{bookId}/library/timeline` | 查询带证据和正史版本的故事时间线 |
| GET | `/books/{bookId}/library/graphs/relationships` | 查询有向、带时间和观点主体的关系图谱 |
| GET | `/books/{bookId}/library/graphs/emotions` | 查询按人物和场景组织的计划/实际情绪曲线、证据与推断状态；只读分析投影 |
| GET | `/books/{bookId}/library/map` | 查询地点事实、空间关系、移动约束和可重建布局 |
| GET | `/books/{bookId}/library/gaps` | 查询与任务/章节相关的硬缺口、建议和可选灵感 |
| GET/POST | `/books/{bookId}/library/tags` | 查询或创建版本化标签定义 |
| PATCH | `/books/{bookId}/library/tags/{tagId}` | 改名、增加别名、调整展示或归档标签 |
| POST | `/books/{bookId}/library/tag-assignments` | 给明确对象增加带故事时间、证据和状态的标签 |
| POST | `/books/{bookId}/library/tag-assignments/{assignmentId}/archive` | 可逆归档标签赋值 |
| GET | `/books/{bookId}/memory` | 按层级、实体、章节和状态查询记忆 |
| GET | `/books/{bookId}/facts` | 查询事实、证据、故事时间和正史状态 |
| GET | `/books/{bookId}/entities/{entityId}` | 查询实体历史和当前状态 |
| POST | `/books/{bookId}/retrievals` | 执行并持久化四通道混合检索，返回计划、通道状态、融合命中和证据闭环 |
| POST | `/books/{bookId}/retrieval/preview` | 预览某任务将召回的资料 |
| GET | `/books/{bookId}/context-packs/{contextPackId}` | 查询模型调用的资料来源和预算 |
| POST | `/books/{bookId}/facts/{factId}/correct-request` | 创建事实纠正确认单 |

接口不得返回模型内部思维链或原始嵌入向量；只返回人类可读语义、来源、采用原因、检查结果和可审计产物。标签定义不等于事实，候选/派生标注必须与老板确认标注分开返回；带生死、知情、归属、核心关系或世界规则含义的赋值必须携带对应事实与确认状态。资料缺口必须携带任务相关理由，不返回要求填满所有可选字段的虚假总完成率。

检索预览响应必须包含查询意图/子意图、正史版本、故事时点、观点主体、实体消歧、活动工作集、各通道水位和本地候选量；结果按H硬约束、E证据、I灵感分组，并返回同源证据簇、冲突组、RRF分量/岗位调整、正式事实或最小原文闭环、采用/排除原因、实际注入资料与Token。普通模式可以把底层数值折叠为可读原因，高级诊断可查看版本化分量，但不能把融合分展示为事实置信度。

当前执行接口请求至少包含 `query`、`canonRevision`，可选 `roleKey`、`mode`、`taskId`、`limit`、`sourceTypes`、`worldTime`、`knowledgeTime` 和 `viewpointEntityId`。响应的 `channels` 固定公开 `structured/fts/vector/relation` 各自的 `ready/degraded/skipped`、原因、候选/采用数和耗时；`hits` 不返回原始向量，包含车道、来源版本/哈希/最小定位、同源簇、闭环结果和融合排序。BGE向量使用版本化保守距离门槛拒绝无关近邻；命中不足时返回空结果，不以最像片段强填答案。

## 10. 正史与确认

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/canon` | 查询当前 `canonRevision` 和变更历史 |
| GET | `/books/{bookId}/confirmations` | 查询待确认和历史确认单 |
| POST | `/books/{bookId}/confirmations/{confirmationId}/accept` | 严格确认指定对象和版本 |
| POST | `/books/{bookId}/confirmations/{confirmationId}/reject` | 拒绝并解除相应任务 |
| GET/POST | `/books/{bookId}/expression-profile` | 查询或创建版本化表达/视角基线；首个正式工单前必须为confirmed |
| GET | `/books/{bookId}/writing-orders/{writingOrderId}` | 查询冻结工单及其最小来源清单，不返回内部思维链 |
| GET | `/books/{bookId}/chapters/{chapterId}` | 同时返回不可变稿件、三点评面板/报告、修订单和正文确认门禁 |

D级事实未确认时，当前章节不能结算，依赖该事实的任务暂停；无关的只读研究和其他书籍不受影响。

正式正文还有独立于事实确认的正文确认门禁：三点评通过后任务进入 `waiting_confirmation`，接受才选择该不可变稿、抽取带原文指针的候选并结算；拒绝不改变正史，轮次允许时使用同一任务和新完整版本定点重写。确认单严格绑定 `manuscript_version_id + expected_canon_revision`，不能把对旧稿的确认复用于新稿。

## 11. 研究与版权

| 方法 | 路径 | 用途 |
|---|---|---|
| POST/GET | `/books/{bookId}/research/sources` | 保存并查询带时间、地区、语言和哈希的研究来源 |
| POST/GET | `/books/{bookId}/research/claims` | 保存并查询只处于候选态的证据主张 |
| GET | `/books/{bookId}/research/offline-status` | 明确返回离线研究不可用边界 |
| POST | `/books/{bookId}/copyright/sources` | 将参考原文登记到隔离区 |
| POST | `/books/{bookId}/copyright/structure-cards` | 生成去专名、去原事件顺序的结构卡 |
| POST | `/books/{bookId}/copyright/cleanroom-packages` | 构建主笔可用的干净室包 |
| POST | `/books/{bookId}/copyright/checks` | 执行文本与结构分维度检查 |
| GET | `/books/{bookId}/copyright/summary` | 查询隔离数量与审查结果，不返回原文 |

主笔接口不能读取原文区、详细逐章摘要、人物映射或拆书FTS。

## 12. 预算和用量

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/usage` | 单书、任务和模型用量 |
| GET | `/books/{bookId}/budgets` | 当前预算模式、冻结和保护线 |
| GET | `/books/{bookId}/budgets/reconciliation` | 无主预留巡检：无模型调用且无调和记录的预留必须为0；返回 orphanReservationCount/awaitingProviderCount/invariantHolds |
| POST | `/books/{bookId}/model-calls/{requestId}/reconcile` | 中断调用手动调和：按本地证据推进到 reusable（找到结果按真实用量 settle）/retry_safe（可证明未执行则 release）/awaiting_provider（无法查询保持冻结） |
| POST | `/books/{bookId}/editor/revert` | 主编模型恢复后安全回切：body `{chiefAgentId}`；有 working/未知调用时返回原因不切，无则在安全边界原子回切（新 epoch） |

`GET /workspace` 返回的 `editor` 字段（`describeLease`）含 `activeEditorAgentId`/`editorEpoch`/`leaseExpiresAt`/`takeoverState`(stable|preparing|ready)/`expired`，前端据此显示"西施接管中"而非把过期租约当 stable。`POST /messages`、`POST /discussions` 在入口做编码健康诊断（U+FFFD 替换符或连续6+问号判损坏），损坏文本返回 400 不进入模型。

费用未知且可能产生按量现金支出时，任务暂停或切换费用明确路线，不能只提示后继续。

## 13. 文件、备份和导入导出

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/backups` | 创建一致性备份任务 |
| GET | `/backups` | 查询快照、哈希和验证状态 |
| POST | `/backups/{backupId}/verify` | 在隔离目录执行真实恢复验证 |
| POST | `/books/{bookId}/projections/rebuild` | 按书重建叙事投影 |

## 14. SSE事件

连接：`GET /api/v1/events?after={eventSeq}&bookId={bookId}`。

事件信封：

```json
{
  "eventSeq": 1024,
  "eventId": "uuid",
  "eventType": "task.phase.changed",
  "ownerId": "uuid",
  "bookId": "uuid",
  "occurredAt": "ISO-8601",
  "data": {}
}
```

首版事件类型至少包含：

- `agent.presence.changed`
- `task.created`
- `task.phase.changed`
- `task.blocked`
- `task.completed`
- `model_call.started`
- `model_call.interrupted`
- `tool_call.changed`
- `discussion.changed`
- `confirmation.created`
- `confirmation.resolved`
- `manuscript.version.created`
- `chapter.settled`
- `canon.revision.changed`
- `library.changed`
- `tag.changed`
- `budget.threshold.reached`
- `backup.changed`
- `worker.health.changed`

## 15. 标准错误码

- `VALIDATION_ERROR`
- `BOOK_NOT_FOUND`
- `BOOK_SCOPE_VIOLATION`
- `BOOK_VERSION_CONFLICT`
- `CANON_REVISION_CONFLICT`
- `EDITOR_EPOCH_CONFLICT`
- `CHAPTER_DEPENDENCY_UNSETTLED`
- `AGENT_CAPABILITY_UNAVAILABLE`
- `INDEPENDENT_REVIEW_REQUIRED`
- `BUDGET_EXHAUSTED`
- `CONFIRMATION_REQUIRED`
- `CONFIRMATION_MISMATCH`
- `COPYRIGHT_BLOCKED`
- `MODEL_CALL_INTERRUPTED`
- `TASK_ALREADY_RUNNING`
- `OPERATION_INCOMPLETE`
- `TAG_DEFINITION_CONFLICT`
- `TAG_ASSIGNMENT_AMBIGUOUS`
- `BACKUP_NOT_VERIFIED`
- `PERMANENT_DELETE_CONFIRMATION_INVALID`

## 16. 超长篇连续性目标增量（E0，尚未注册）

下列接口属于DEC-014与DEC-015运行时目标，目前没有注册或契约测试，不能冒充可用API：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/longform-status` | 总字数/章节、当前卷/故事弧、正史与索引水位、滚动质量窗口 |
| GET | `/books/{bookId}/commitments` | 查询主支线承诺、伏笔、人物目标、预计窗口和证据 |
| GET | `/books/{bookId}/continuity` | 查询场景/章节/故事弧/卷/全书主脊节点及来源 |
| GET | `/books/{bookId}/stage-settlements` | 查询故事弧/卷阶段结算、活动状态、探针和来源 |
| GET | `/books/{bookId}/stage-settlements/{settlementId}` | 查询阶段结算详情并可导航到章节/场景/正史原文 |
| POST | `/books/{bookId}/retrieval/drilldown-preview` | 预览触发原因、卷→故事弧→章节/场景→原文路径、候选与实际注入预算 |
| GET | `/books/{bookId}/retrieval/chunk-snapshots` | 查询DEC-017切片策略、来源覆盖、校验、正史水位和当前/历史快照 |
| GET | `/books/{bookId}/retrieval/chunks/{chunkId}` | 高级诊断指定块的原文范围、父子/邻接、叙事模式和投影状态，不返回向量 |
| GET | `/books/{bookId}/agents/{agentId}/continuity` | 查询成员当前关注、最后有效贡献和可审计岗位日志 |
| GET | `/books/{bookId}/quality-windows` | 查询20/50/100/200章滚动趋势和证据，不返回自动文学裁决 |

成员连续性接口不得返回模型思维链、完整隐藏提示词、全部聊天或其他书籍日志。主编治理岗位日志必须使用版本、当前 `editor_epoch`、幂等键和可撤销操作；模型生成的日志只能先成为候选。

阶段结算响应必须区分 `narratively_closed` 与 `technical_checkpoint`，逐项返回正史版本、来源范围和探针状态。下钻预览必须返回 `triggerReasons`、`activityClass`、`path`、`maxDepth`、`localCandidateCount`、`injectedItemCount`、`injectedTokens`、采用/排除理由和是否取得原文证据；不得返回原始向量或未授权整段正文。正式生产遇到失败探针、错误水位或关键依据不足时返回明确降级/阻断状态，不能用摘要猜测。

切片诊断响应还必须区分原始证据范围与 `indexText/embeddingText` 策略，只返回可解释的短上下文头及其版本，不返回嵌入向量。历史或失败快照只用于诊断，不能通过普通参数成为正式检索当前指针。

## 17. DEC-020冻结增量接口（E0，尚未注册）

所有路径位于 `/api/v1`。除health外，接口需要每启动轮换的本机会话；写请求还验证精确Origin和Fetch Metadata。以下接口在对应E1实现和契约测试完成前不得对外宣称可用。

### 17.1 会话、能力和运维

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/runtime/session` | 精确Origin下建立短期HttpOnly本机会话 |
| GET | `/capabilities` | SQLite、模型、向量、离线资产和降级能力快照 |
| GET | `/operations/status` | 磁盘、队列、投影、备份、模型和Worker水位 |
| POST | `/operations/projections/{projectionId}/retry` | 幂等重试失败投影，不切换活动快照 |

### 17.2 资料、检索和连续性

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/library` | 按实体类型、标签、层级、时间、冲突和水位分页查询资料 |
| GET | `/books/{bookId}/library/entities/{entityId}` | 实体、别名、事实、关系、情绪、来源和三轴时间详情 |
| GET | `/books/{bookId}/library/graph` | 受节点/边/跳数限制的关系、情绪、势力或空间子图 |
| GET | `/books/{bookId}/library/gaps` | 与当前任务相关的资料缺口，不把有意未知当错误 |
| POST | `/books/{bookId}/library/tag-commands` | 主编受限自然语言标签治理；歧义/高影响生成候选确认 |
| POST | `/books/{bookId}/retrieval/query-plans` | 创建不可变检索计划并返回歧义/门禁 |
| GET | `/books/{bookId}/retrieval/{retrievalId}` | 查询四通道、H/E/I、证据簇、下钻、闭环和Token注入 |
| POST | `/books/{bookId}/retrieval/{retrievalId}/drilldowns` | 执行唯一一次有界补充检索 |
| POST | `/books/{bookId}/projection-snapshots/{snapshotId}/activate` | 仅在探针通过后原子切换单书活动快照 |

`library/graph` 默认最多200节点/500边、最多3跳；响应包含被截断和下一步筛选提示。检索响应不返回原始向量、隐藏提示或思维链。

### 17.3 工作流与写作

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/books/{bookId}/writing-orders` | 从已确认规划创建版本化工单和岗位资料包 |
| GET | `/books/{bookId}/writing-orders/{orderId}` | 查询门禁、H约束、自由区、来源和执行状态 |
| POST | `/books/{bookId}/writing-orders/{orderId}/start` | 通过准备门禁后启动唯一活动写手（主笔或副笔） |
| POST | `/tasks/{taskId}/cancel` | 持久化新epoch并传播真实取消 |
| POST | `/tasks/{taskId}/resume` | 从有效检查点新attempt恢复 |
| GET | `/manuscripts/{manuscriptId}/review-panel` | 查询冻结的三职责、实际成员/模型快照、选择原因、稿件哈希、轮次、预算和状态 |
| GET | `/manuscripts/{manuscriptId}/review-reports` | 查询三份结构化点评、证据、AI腔指标和政治/情色风险，不返回思维链 |
| POST | `/manuscripts/{manuscriptId}/review-rounds` | 为同一不可变稿件原子创建三席并行点评；缺席或重复模型返回409 |
| GET | `/manuscripts/{manuscriptId}/revision-order` | 查询主编合并后的单一定点修改单、分歧和阻断项 |
| POST | `/manuscripts/{manuscriptId}/confirm` | 老板确认正式不可变正文并触发结算 |

所有状态变更支持 `Idempotency-Key`，响应返回 `operationId/taskId/attemptId/epoch`。取消成功只表示提交栅栏建立；适配器确认和晚到结果处理通过SSE继续报告。

点评接口必须满足：三份报告绑定同一 `manuscriptVersionId`；模型快照固定、彼此不同并均与活动写手模型不同；GLM写手时事实席选择DeepSeek；每席都返回位置、严重度、证据和修改目标。Kimi文学报告额外返回 `aiStyleRiskScore`、`flaggedParagraphCount`、`totalParagraphCount`、`flaggedParagraphRatio`，并明确 `isAuthorshipProbability: false`。豆包体验报告额外返回 `politicalRisk`、`sexualContentRisk` 和 `policyVersion`。任一席有限重试后仍失败时返回可恢复的受阻状态，不能生成空报告或自动降为按量付费调用。

### 17.4 可移植和恢复

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/books/{bookId}/exports` | 创建版本化 `.wenmi-book` 复制导出 |
| GET | `/portable-operations/{operationId}` | 查询清单、哈希、阶段、失败和下载就绪 |
| POST | `/imports/quarantine` | 上传到隔离区并执行结构/哈希/限额扫描 |
| GET | `/imports/{importId}/impact` | 预览新ID、来源、Schema和重建影响 |
| POST | `/imports/{importId}/confirm-copy` | 确认以新 `book_id` 复制导入 |
| POST | `/backups/{backupId}/restore-dry-run` | 在隔离区预演生产恢复和影响 |
| POST | `/backups/{backupId}/restore-confirm` | 严格确认后创建恢复前备份并生产恢复 |

普通导入接口永远不接受覆盖书籍参数。生产恢复确认契约与永久删除同级严格，且只能在本机设置/恢复页发起。

### 17.5 新增错误码

- `RUNTIME_SESSION_REQUIRED`
- `REQUEST_ORIGIN_REJECTED`
- `ENTITY_DISAMBIGUATION_REQUIRED`
- `TEMPORAL_SCOPE_INCOMPLETE`
- `RETRIEVAL_EVIDENCE_INSUFFICIENT`
- `RETRIEVAL_DRILLDOWN_EXHAUSTED`
- `PROJECTION_STALE`
- `PROJECTION_VALIDATION_FAILED`
- `VECTOR_CAPABILITY_UNAVAILABLE`
- `CONTEXT_BUDGET_EXCEEDED`
- `CANCEL_COMMIT_FENCE_REJECTED`
- `IMPORT_QUARANTINE_FAILED`
- `PORTABLE_MANIFEST_INVALID`
- `RESTORE_IMPACT_CONFIRMATION_REQUIRED`
- `DISK_SAFETY_LINE_REACHED`
- `LOCAL_UTILITY_MODEL_UNAVAILABLE`
- `MESSAGE_ROUTING_LOW_CONFIDENCE`
- `MESSAGE_ROUTING_POLICY_REJECTED`
- `ACTIVE_DISCUSSION_ROUTE_CONFLICT`
- `BOOK_STATUS_CONFLICT`

具体状态机、请求限额、Cookie、导入和错误脱敏见 `docs/RUNTIME_WORKFLOWS.md` 与 `docs/SECURITY_AND_OPERATIONS.md`。

## 18. 作者正文、主角状态与属性公式

### 18.1 正文版本与生产动作

- `POST /api/v1/books/:bookId/chapters/:chapterId/manuscripts/owner-drafts`：提交 `baseManuscriptVersionId/content/note`，以CAS创建作者不可变新稿；章节尚无正文时允许 `baseManuscriptVersionId=null` 创建第一份作者草稿，已有正文时必须提交当前版本ID。已结算章节、陈旧基准和竞争任务拒绝写入。
- `POST /api/v1/books/:bookId/chapters/:chapterId/rewrite`：绑定 `manuscriptVersionId/instruction` 创建或恢复真实重写任务，旧稿保留。
- `POST /api/v1/books/:bookId/chapters/:chapterId/finalize`：绑定当前稿创建正式审校任务；如果同稿已在等待老板确认则返回现有确认，不重复调用模型。
- 旧 `select-manuscript` 与直接 `settle` 对活动流程返回409及替代入口，不能绕过三席和老板确认。

### 18.2 主角面板

- `GET/POST /api/v1/books/:bookId/protagonists`：读取当前面板或创建/修订主角档案；
- `POST /api/v1/books/:bookId/protagonist-state/:entryId/classify`：作者为当前最新的“待归类”或其他状态项确认自由分类；服务端新增修订，保留事实值/来源/历史并关闭对应分类缺口，跨书或旧修订请求拒绝；
- `POST /api/v1/books/:bookId/protagonists/:profileId/archive`：归档档案；
- `POST /api/v1/books/:bookId/protagonists/:profileId/state`：追加候选或作者确认状态修订；
- `POST /api/v1/books/:bookId/protagonist-state/:entryId/archive`：从当前面板移出条目并保留历史。

### 18.3 属性公式

- `GET/POST /api/v1/books/:bookId/attribute-formulas`：读取活动公式或保存新版本；
- `POST /api/v1/books/:bookId/attribute-formulas/:formulaId/evaluate`：服务端使用声明变量安全试算；
- `POST /api/v1/books/:bookId/attribute-formulas/:formulaId/archive`：归档公式。

以上接口均先验证本机会话和书籍作用域；用户输入错误返回可理解的领域错误，不返回SQL、路径、堆栈或通用“内部错误”。资料库聚合响应附带 `protagonists` 与 `attributeFormulas`，但不返回公式执行能力或原始向量。
## 完整开书与分类目录（DEC-046）

- `GET /api/v1/opening-taxonomy`：返回当前本地分类目录版本、来源说明、更新时间、男频/女频分类、平台分类级的跨分类大题材 `subjects`，以及按题材分组的 `tagGroups`。副本、排行榜、装备品质等书内机制只存在于标签组或设定目录，不进入题材组合。客户端默认只显示当前分类相关题材；完整题材可明确展开，完整标签库按组切换和搜索。该接口只读，不在线抓取第三方网站。
- `POST /api/v1/opening-synopsis/analyze`：请求体为 `{ "synopsis": string }`，去除首尾空白后必须为1—5000个字符。接口使用确定性本地识别返回目录版本、候选频道/分类/主角/基础字段/标签、已识别字段、待确认字段和短证据摘录；不调用付费模型，不创建书或草稿，不写聊天、正史、向量、任务、预算或模型调用记录。客户端必须校验目录版本、保留已有手工输入并只把结果作为可编辑候选。
- `POST /api/v1/books/drafts`：除兼容旧客户端字段外，当前Web入口提交 `openingBlueprint`。服务端校验男/女频道、一个主分类、0—8个题材、必须遵守以及2—8个主要标签；自定义标签最多13个。旧客户端的0—3个同频道 `auxiliaryCategoryKeys` 会兼容折算成题材，新Web不再提交该字段。未知自定义标签允许，但不能冒充目录分类键。`targetAudience` 仅为旧书和旧客户端兼容字段，可为空。
- 8项标签自动勾选由Web根据版本化分类目录确定性完成，不新增模型调用或API字段。
- `GET /api/v1/opening-taxonomy` 同时返回 `boundaryGroups`。客户端可以与自定义边界合并提交，最终由 `openingBlueprint.mustFollow` 的1—15条服务端校验兜底。
- `POST /api/v1/book-drafts/:draftId/confirm`：在同一事务创建版本化开书资料、初始主角候选资料与主编主动开场任务，返回 `kickoffTaskId`。主编开场把对应开书快照作为有界硬来源，不重复带入含相同信息的故事圣经，也不对尚无正史的新书执行空检索。事务失败不得留下书、团队、资料或任务。陈旧版本返回HTTP 409与 `BOOK_VERSION_CONFLICT`，客户端刷新草稿后可以重试；重复确认返回HTTP 409与 `BOOK_STATUS_CONFLICT`，不得重复创建。
- 旧草稿仍可按旧字段确认，避免升级后破坏已存在的编辑中草稿；新Web不再产生旧式不完整草稿。

## 19. DEC-049工作区会话投影

现有 `GET /api/v1/books/:bookId/workspace` 响应新增可公开的 `creativeSession`：会话ID、状态、模式、当前议题、黑板修订、成熟度、当前目标、候选方向、风险、未知项、下一步和活动预演分支。响应不返回老板消息数组、完整证据、内部事件、模型思维链或原始来源指纹。

聊天入口继续使用自然语言动作：普通剧情消息续接当前会话；“重大改向”启动新一轮双编剧；“锁定当前方向”进入跨度估算与滚动规划；“试写看看”进入临时稿；“暂停/继续”同时控制可暂停任务和创作会话。所有动作返回真实 `taskId/sessionId/status`，不能仅修改前端标签。

试写任务在未满足正式生产准备时仍可运行，但只生成临时稿；正式 `review_existing` 可对同一不可变稿件补齐三席点评与定稿链。工作区不暴露质量快照的内部聚合逻辑，正文版本与审校报告仍通过既有章节接口查询。
### 属性公式

`POST /api/v1/books/{bookId}/attribute-formulas` 接受可选 `category` 字段；省略时按旧数据兼容为 `uncategorized`。返回记录始终包含 `category`。设定原文通过现有消息接口提交并点名设定成员；真实回复会创建故事圣经候选版本并显示在基本设定中，未经作者确认不会替换活动版本或进入正史。

## 20. 团队配置与岗位补充提示词

- `GET /api/v1/books/:bookId/team-config`：返回当前书籍11名成员的公开岗位合同、可公开默认岗位提示词、真实模型来源、激活状态及活动补充提示词版本；不返回内部安全门禁、密钥、工具参数、输出协议或隐藏防护规则。
- `PUT /api/v1/books/:bookId/agents/:agentId/prompt-preference`：请求体为 `{ expectedVersion, content }`。内容最多4000字符，按书籍与Agent隔离，使用CAS防止并发覆盖；空内容创建“恢复默认”版本。
- 保存后仅影响新发起的模型调用。`model_calls.prompt_preference_id`记录实际版本；确定性测试适配器保持原始结构化输入，真实方舟/Codex适配器把补充要求放入系统指令层，并明确硬规则优先。

## 21. 设定大纲工作状态

- `GET /api/v1/books/:bookId/setting-outline-workspace`：读取本书已保存的设定项状态和作者自定义项。动态模板未修改的默认项不重复落库。
- `PUT /api/v1/books/:bookId/setting-outline-workspace/:itemKey`：保存一项的板块、名称、通俗说明、模板来源、状态、自定义标记和顺序。状态只接受待讨论、讨论中、候选待确认、已确认、稍后补充、刻意留白和不适用。
- 所有记录按书籍作用域校验；接口不确认正史、不修改故事圣经、不启动模型。
- Web点击“跳转讨论”通过既有消息接口发送 `讨论设定` 与结构化资料包。会话层固定建立活动主编加两名编剧的协同讨论任务，仍遵守预算、模型调用、任务恢复和候选确认门禁。
