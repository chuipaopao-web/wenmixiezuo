# API与事件契约 v1

## 1. 通用规则

- 基础路径：`/api/v1`。
- 传输：JSON；文件上传和导出使用明确的文件接口。
- 所有书籍范围接口从路径或令牌上下文获得 `owner_id` 与 `book_id`，服务端Repository再次验证。
- 任务、模型调用和工具调用等可重试操作使用持久幂等键；带乐观锁的资源命令使用明确版本号。
- 所有资源返回稳定ID、版本、创建时间和修改时间。
- 正史等重大命令必须携带服务端创建的 `confirmationId`；永久删除则只接受服务端给出的完整严格确认词。
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

除根级 `/health` 外，下表路径均位于 `/api/v1`。本文件只列当前首版已经注册并通过契约测试的接口。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | API、数据库、目录、迁移及脱敏模型运行状态 |
| GET | `/runtime/readiness` | 汇总API和Worker是否可用 |
| GET | `/runtime/worker` | Worker真实心跳、能力和最近任务 |

未通过健康检查时，查看、导出和恢复入口可以保持可用，但不能领取新的模型任务。

`/health` 的 `modelRuntime` 只返回请求模式、活动模式、缺失凭证名称、是否禁止现金回退，以及模型/岗位/套餐的公开映射；不得返回API Key、Codex认证材料或供应商请求头。

## 3. 书籍与定位

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/books/drafts` | 从自然语言或标签创建定位草稿 |
| PATCH | `/book-drafts/{draftId}` | 修改定位草稿 |
| POST | `/book-drafts/{draftId}/confirm` | 原子创建书籍、9个Agent和基础配置 |
| GET | `/books` | 查询当前老板的书籍 |
| GET | `/books/{bookId}` | 查询书籍、定位、版本和生命周期 |
| POST | `/books/{bookId}/archive` | 归档书籍 |
| POST | `/books/{bookId}/restore` | 使用乐观版本恢复已归档书籍 |
| POST | `/books/{bookId}/purge` | 严格确认后永久删除并写墓碑 |

建书确认必须包含定位草稿版本，防止确认旧版本。

## 4. Agent与岗位

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/agents` | 返回9个Agent、岗位、模型和真实状态 |
| POST | `/books/{bookId}/agents/{agentId}/activate` | 按任务激活按需专家 |

岗位和模型调整必须生成新的配置快照，不能修改历史任务使用的快照。

## 5. 对话与讨论

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/messages` | 分页查询书籍消息 |
| POST | `/books/{bookId}/messages` | 老板发送自然语言消息 |
| POST | `/books/{bookId}/discussions` | 建立有范围和预算的讨论 |
| GET | `/books/{bookId}/discussions/{discussionId}` | 查询阶段、参与者、意见和草案 |
| POST | `/books/{bookId}/discussions/{discussionId}/confirm` | 确认候选方案为项目决定 |

每条意见返回真实 `agentId`、岗位、`modelProvider` 和 `modelId`。离线或未回复成员不生成伪造意见。
普通消息会创建 `conversation_reply` 持久任务，由活动主编在最多12条近期消息、活动故事圣经和已确认决定组成的有界上下文中真实回复；聊天不会自动写入长期记忆。自然创作意图会创建 `discussion` 任务并自动选择相关岗位，`讨论 <问题>` 仍可作为显式快捷方式。相关岗位先回复，主编读取真实意见后汇总，再以 `确认方案 <decisionId>` 零Token确认。

普通消息若被识别为明确的资料治理命令，例如“增加隐藏身份标签”“给张三增加隐藏身份标签”或“把暗线作为伏笔的别名”，由活动主编调用受限知识工具。单书、对象明确且可撤销的操作直接执行，消息回复包含变更ID、对象、前后值、正史/候选状态、投影状态和撤销入口；歧义、同名、跨书或批量影响只产生一个必要澄清问题。其他Agent提出的标签只能进入候选。

标记为 `creative_planning` 的确认会生成或新增版本并选择 `creative_plan`、`story_bible`、`master_outline` 和请求范围内的 `chapter_outline`。普通讨论确认不自动改写规划成果。

## 6. 规划成果

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/artifacts` | 按类型查询创作方案、故事圣经和大纲 |
| POST | `/books/{bookId}/artifacts/generate` | 创建规划任务 |
| GET | `/books/{bookId}/artifacts/{artifactId}/versions` | 查询版本历史 |
| POST | `/books/{bookId}/artifacts/{artifactId}/select` | 选择活动版本 |
| POST | `/books/{bookId}/artifacts/{artifactId}/revert` | 从历史版本创建新版本 |

返回历史版本时不能直接改旧文件或旧记录。

## 7. 章节与稿件

`POST /books/{bookId}/chapter-batches` 与对话中的 `写N章` 共用准备门禁。若创作方案、活动故事圣经、总纲或任一请求章节的老板确认章纲缺失，接口返回 `409 OPERATION_INCOMPLETE`，且不会创建章节或章节任务。对话入口会在这种情况下改为发起或复用创作规划讨论。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/chapters` | 查询卷章、阶段和结算状态 |
| POST | `/books/{bookId}/chapter-batches` | 安排1章或连续3至5章 |
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
| GET | `/books/{bookId}/library/graphs/emotions` | 查询按人物和场景组织的情绪图谱与证据状态 |
| GET | `/books/{bookId}/library/map` | 查询地点事实、空间关系、移动约束和可重建布局 |
| GET | `/books/{bookId}/library/gaps` | 查询与任务/章节相关的硬缺口、建议和可选灵感 |
| GET/POST | `/books/{bookId}/library/tags` | 查询或创建版本化标签定义 |
| PATCH | `/books/{bookId}/library/tags/{tagId}` | 改名、增加别名、调整展示或归档标签 |
| POST | `/books/{bookId}/library/tag-assignments` | 给明确对象增加带故事时间、证据和状态的标签 |
| POST | `/books/{bookId}/library/tag-assignments/{assignmentId}/archive` | 可逆归档标签赋值 |
| GET | `/books/{bookId}/memory` | 按层级、实体、章节和状态查询记忆 |
| GET | `/books/{bookId}/facts` | 查询事实、证据、故事时间和正史状态 |
| GET | `/books/{bookId}/entities/{entityId}` | 查询实体历史和当前状态 |
| POST | `/books/{bookId}/retrieval/preview` | 预览某任务将召回的资料 |
| GET | `/books/{bookId}/context-packs/{contextPackId}` | 查询模型调用的资料来源和预算 |
| POST | `/books/{bookId}/facts/{factId}/correct-request` | 创建事实纠正确认单 |

接口不得返回模型内部思维链或原始嵌入向量；只返回人类可读语义、来源、采用原因、检查结果和可审计产物。标签定义不等于事实，候选/派生标注必须与老板确认标注分开返回；带生死、知情、归属、核心关系或世界规则含义的赋值必须携带对应事实与确认状态。资料缺口必须携带任务相关理由，不返回要求填满所有可选字段的虚假总完成率。

## 10. 正史与确认

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/books/{bookId}/canon` | 查询当前 `canonRevision` 和变更历史 |
| GET | `/books/{bookId}/confirmations` | 查询待确认和历史确认单 |
| POST | `/books/{bookId}/confirmations/{confirmationId}/accept` | 严格确认指定对象和版本 |
| POST | `/books/{bookId}/confirmations/{confirmationId}/reject` | 拒绝并解除相应任务 |

D级事实未确认时，当前章节不能结算，依赖该事实的任务暂停；无关的只读研究和其他书籍不受影响。

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
| GET | `/books/{bookId}/agents/{agentId}/continuity` | 查询成员当前关注、最后有效贡献和可审计岗位日志 |
| GET | `/books/{bookId}/quality-windows` | 查询20/50/100/200章滚动趋势和证据，不返回自动文学裁决 |

成员连续性接口不得返回模型思维链、完整隐藏提示词、全部聊天或其他书籍日志。主编治理岗位日志必须使用版本、当前 `editor_epoch`、幂等键和可撤销操作；模型生成的日志只能先成为候选。

阶段结算响应必须区分 `narratively_closed` 与 `technical_checkpoint`，逐项返回正史版本、来源范围和探针状态。下钻预览必须返回 `triggerReasons`、`activityClass`、`path`、`maxDepth`、`localCandidateCount`、`injectedItemCount`、`injectedTokens`、采用/排除理由和是否取得原文证据；不得返回原始向量或未授权整段正文。正式生产遇到失败探针、错误水位或关键依据不足时返回明确降级/阻断状态，不能用摘要猜测。
