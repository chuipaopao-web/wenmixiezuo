# V7 当前 API 契约

> 本文件只记录当前 V7 作者端、独立后台、Worker 和共享平台底座实际注册的接口。已删除的旧产品路由不再作为兼容合同；历史数据库迁移不等于接口仍可调用。

## 通用边界

- API 前缀为 `/api/v1`，健康检查为 `/health`。
- 业务身份只来自已验证会话；作者请求不能用客户端字段覆盖 `owner_id`。
- 所有书内读取和写入同时校验 `owner_id + book_id`。
- 管理员接口必须经过管理员会话；内部 Worker 接口还要求登记的 Worker 身份和令牌。
- 作者响应不返回模型供应商、模型内部标识、提示词、哈希、堆栈、路径或协议字段。
- 写接口使用期望版本和/或幂等键；重复请求不能重复创建正式版本或重复计费。
- 正文正式化创建不可变版本，后续修改产生新版本。

## 账号、会员与反馈

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/membership/me`
- `POST /api/v1/feedback`

独立后台继续使用：

- `GET /api/v1/admin/users`
- `PATCH /api/v1/admin/users/:userId/status`
- `GET /api/v1/admin/memberships`
- `POST /api/v1/admin/memberships/:userId`
- `POST /api/v1/admin/memberships/:userId/revoke`

## V7 开书与书架

- `GET /api/v1/v7/opening-taxonomy`
- `POST /api/v1/v7/opening-agent/tasks`
- `GET /api/v1/v7/opening-agent/tasks`
- `GET /api/v1/v7/opening-agent/tasks/:taskId`
- `POST /api/v1/v7/opening-agent/tasks/:taskId/revisions`
- `POST /api/v1/v7/opening-agent/tasks/:taskId/abandon`
- `POST /api/v1/v7/opening-agent/tasks/abandon-all`
- `POST /api/v1/v7/opening-books`
- `GET /api/v1/v7/books`
- `POST /api/v1/v7/books/:bookId/archive`
- `POST /api/v1/v7/books/:bookId/restore`
- `GET|PUT /api/v1/v7/books/:bookId/book-profile`

开书任务只保存作者输入、候选、主编审查、明确状态和恢复证据。只有作者确认的资料可建立正式 V7 书籍。

## 书名与封面

- `POST /api/v1/v7/books/:bookId/title-designs`
- `GET /api/v1/v7/books/:bookId/title-studio`
- `GET /api/v1/v7/design-tasks`
- `POST /api/v1/v7/books/:bookId/cover-designs`
- `GET /api/v1/v7/books/:bookId/cover-studio`
- `POST /api/v1/v7/books/:bookId/cover-designs/:designId/adopt`
- `GET /api/v1/v7/books/:bookId/cover-designs/:designId/image`
- `GET /api/v1/v7/books/:bookId/cover-designs/:designId/download`

## 设定编辑部

- `GET /api/v1/v7/books/:bookId/setting-department`
- `POST /api/v1/v7/books/:bookId/setting-recommendations`
- `GET /api/v1/v7/books/:bookId/setting-recommendations/current`
- `GET /api/v1/v7/books/:bookId/setting-recommendations/:taskId`
- `POST /api/v1/v7/books/:bookId/setting-recommendations/retry`
- `PUT /api/v1/v7/books/:bookId/setting-selection`
- `POST /api/v1/v7/books/:bookId/setting-batches`
- `GET /api/v1/v7/books/:bookId/setting-batches/:batchId`
- `POST /api/v1/v7/books/:bookId/setting-batches/:batchId/retry`
- `POST /api/v1/v7/books/:bookId/setting-final-reviews`
- `GET /api/v1/v7/books/:bookId/setting-final-reviews/current`
- `POST /api/v1/v7/books/:bookId/setting-final-reviews/:taskId/retry`
- `POST /api/v1/v7/books/:bookId/setting-items/:itemKey/{redesigns|fusions|revisions|review-tasks|confirm}`

## 全书规划

规划树统一使用 `treeKind + scopeId` 标识当前树，不使用旧卷纲、事件纲和章纲接口：

- `GET /api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId`
- `GET /api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/history`
- `PATCH /api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/candidate`
- `POST /api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/confirm`
- `POST /api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/generation-runs`
- `GET /api/v1/v7/books/:bookId/planning-tree-generation-runs/:runId`
- `POST /api/v1/v7/books/:bookId/planning-tree-generation-runs/:runId/cancel`
- `POST /api/v1/v7/books/:bookId/planning-routes/runs`
- `GET /api/v1/v7/books/:bookId/planning-routes/runs/:runId`
- `POST /api/v1/v7/books/:bookId/planning-routes/runs/:runId/{decision|retry-missing|cancel}`
- `GET /api/v1/v7/books/:bookId/planning-routes/latest`
- `GET /api/v1/v7/books/:bookId/planning-adjustment-suggestions`
- `POST /api/v1/v7/books/:bookId/planning-adjustment-suggestions/:suggestionId/decision`
- `GET /api/v1/v7/planning-tasks`

## 人物记忆

- `POST /api/v1/v7/books/:bookId/characters/sync`
- `GET|POST /api/v1/v7/books/:bookId/characters`
- `GET /api/v1/v7/books/:bookId/characters/:profileId`
- `POST /api/v1/v7/books/:bookId/characters/:profileId/{versions|aliases|archive|restore}`
- `POST /api/v1/v7/books/:bookId/characters/:profileId/versions/:versionId/activate`
- `PATCH /api/v1/v7/books/:bookId/characters/:profileId/organization`
- `GET|POST /api/v1/v7/books/:bookId/character-context-packs`
- `GET /api/v1/v7/books/:bookId/character-context-packs/:packId`
- `POST /api/v1/v7/books/:bookId/character-context-packs/:packId/retry`
- `GET /api/v1/v7/books/:bookId/character-change-candidates`
- `GET /api/v1/v7/books/:bookId/character-review-issues`

人物维护生成带来源的候选或问题，不覆盖不可变正文，也不能把计划当成实际发生。

## 创作与正式化

- `POST /api/v1/v7/books/:bookId/creation-workflows`
- `GET /api/v1/v7/books/:bookId/creation-workflows/latest`
- `GET /api/v1/v7/books/:bookId/creation-workflows/:workflowId`
- `GET /api/v1/v7/books/:bookId/creation-library`
- `GET /api/v1/v7/books/:bookId/manuscripts/:manuscriptVersionId`
- `POST /api/v1/v7/books/:bookId/creation-workflows/:workflowId/{cancel|member|options/retry|options/redesign|options/choose|continue-to-chain|continue-to-next-chain|outlines|outlines/confirm|manuscripts|managed/activate|manuscripts/finalize}`
- `GET /api/v1/v7/books/:bookId/creation-workflows/:workflowId/write-back`
- `GET /api/v1/v7/books/:bookId/story-state`
- `GET /api/v1/v7/creation-tasks`

正式化端点：

- `POST /api/v1/internal/worker/v7/creation-formalization/process`
- `POST /api/v1/internal/worker/v7/managed-creation/process`

正式正文与正式化 outbox 在同一事务建立；Worker 失败或重启后从 outbox 幂等追赶。

## 团队与治理

作者可见团队：

- `GET /api/v1/v7/editorial-department`
- `GET /api/v1/v7/editorial/planning-members`
- `GET /api/v1/v7/editorial/creation-members`

管理员治理：

- `GET /api/v1/admin/v7/agent-governance`
- `PATCH /api/v1/admin/v7/agent-governance/members/:memberKey`
- `PATCH /api/v1/admin/v7/agent-governance/task-policies/:taskKind`
- `GET|PATCH /api/v1/admin/v7/opening-agent/members[/:memberKey]`
- `GET|PATCH /api/v1/admin/v7/setting-agent/members[/:memberKey]`
- `GET /api/v1/admin/v7/visual-agent/members`

提示词与 Context 资产：

- `GET /api/v1/admin/v7/prompt-context/summary`
- `GET /api/v1/admin/v7/prompt-context/assets`
- `GET /api/v1/admin/v7/prompt-context/assets/:assetKey/versions`
- `POST /api/v1/admin/v7/prompt-context/assets/:assetKey/{drafts|preview|publish|restore-draft}`
- `GET /api/v1/admin/v7/prompt-context/manifests`
- `GET /api/v1/admin/v7/prompt-context/manifests/:manifestId`
- `POST /api/v1/admin/v7/prompt-context/manifests/:manifestId/verify-rebuild`

## 独立后台经营与审计

- `GET /api/v1/admin/dashboard`
- `GET /api/v1/admin/user-operations`
- `GET /api/v1/admin/usage`
- `GET /api/v1/admin/issues`
- `PATCH /api/v1/admin/issues/:sourceType/:sourceId`
- `GET /api/v1/admin/membership-stats`
- `GET /api/v1/admin/feature-capabilities`
- `GET /api/v1/admin/v7/planning-runtime/:runKind/:runId`
- `GET /api/v1/v7/admin/planning-tasks`
- `GET /api/v1/v7/admin/creation-workflows`
- `GET /api/v1/v7/admin/books/:bookId/creation-workflows/:workflowId/audit`

旧 `/api/v1/books/*`、旧 SSE、旧模型方案、旧 AI 成员、旧叙事方法、旧提示词目录和 `/api/v1/capabilities` 均不再注册。

## 运行状态

- `GET /health`
- `GET /api/v1/runtime/worker`
- `GET /api/v1/runtime/readiness`

`/health` 是公开部署探针；详细运行状态受会话与请求策略保护。
