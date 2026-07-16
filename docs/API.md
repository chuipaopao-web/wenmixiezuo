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
| GET | `/health` | API、数据库、目录和迁移状态 |
| GET | `/runtime/readiness` | 汇总API和Worker是否可用 |
| GET | `/runtime/worker` | Worker真实心跳、能力和最近任务 |

未通过健康检查时，查看、导出和恢复入口可以保持可用，但不能领取新的模型任务。

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
老板在主对话输入 `讨论 <问题>` 时，系统会创建同一套持久讨论与任务记录；Worker完成真实调用和汇总后，再以 `确认方案 <decisionId>` 零Token确认。

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
| GET | `/books/{bookId}/memory` | 按层级、实体、章节和状态查询记忆 |
| GET | `/books/{bookId}/facts` | 查询事实、证据、故事时间和正史状态 |
| GET | `/books/{bookId}/entities/{entityId}` | 查询实体历史和当前状态 |
| POST | `/books/{bookId}/retrieval/preview` | 预览某任务将召回的资料 |
| GET | `/books/{bookId}/context-packs/{contextPackId}` | 查询模型调用的资料来源和预算 |
| POST | `/books/{bookId}/facts/{factId}/correct-request` | 创建事实纠正确认单 |

接口不得返回模型内部思维链；只返回来源、采用原因、检查结果和可审计产物。

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
- `BACKUP_NOT_VERIFIED`
- `PERMANENT_DELETE_CONFIRMATION_INVALID`
