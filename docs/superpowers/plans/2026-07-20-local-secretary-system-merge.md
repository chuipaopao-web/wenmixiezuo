# 小文秘书与系统可见身份合并 Implementation Plan

> **For agentic workers:** 本项目明确要求由当前Codex单独开发，禁止调用其他开发Agent。本计划在当前会话串行执行，采用测试先行和逐层验证。

**Goal:** 取消聊天中的独立“系统”说话者，把消息受理、任务回执、附件反馈、导航和友好故障说明统一交给“小文秘书”，同时保留内部审计来源和创作成员边界。

**Architecture:** SQLite历史 `sender_type='system'` 继续作为兼容性事件来源，不改写历史消息；新通知使用 `message_type='local_assistant_notice'`，前端把新旧系统来源统一渲染为小文秘书。确定性问候、身份说明、任务查看和资料库导航由本地代码完成，创作问题仍直达主编/编剧/主笔等真实成员。

**Tech Stack:** React、TypeScript、Fastify、Node.js SQLite、Vitest、Testing Library。

## Global Constraints

- 只修改 `D:\wenmixiezuo`，不得修改、停止或重启 `D:\AI智囊团`。
- 不新增创作Agent，不让小文秘书冒充成员意见，不修改正史、正文或模型绑定。
- 确定性本地回复不调用模型、不消耗模型Token；路由与操作必须有真实数据库证据。
- 旧消息无损兼容，不批量改写生产数据；原始 `sender_type` 只作内部来源，不再作为可见身份。
- 话术先说明结果，再给下一步；不展示“内部错误”“明确控制命令已执行”等机械文案。

---

### Task 1: 冻结合并合同与反例门禁

**Files:**
- Modify: `docs/DECISIONS.md`
- Create: `docs/LOCAL_SECRETARY_SYSTEM_MERGE_AUDIT.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/AGENT_SYSTEM.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/API.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `KNOWLEDGE.md`
- Modify: `TASKS.md`

- [x] 记录DEC-038与 `DR-20260720-01`，明确“一个可见身份、多个内部来源”。
- [x] 完成正确性/安全与创造性/输出质量两轮审查。
- [x] 锁定历史兼容、零模型调用、直接成员回复和错误脱敏合同。

### Task 2: 先建立失败回归

**Files:**
- Modify: `tests/integration/agents/local-assistant.test.ts`
- Modify: `tests/integration/domain/open-conversation-runtime.test.ts`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`
- Modify: `tests/foundation/api-health.test.ts`

- [x] 证明问候由小文秘书本地回复而非创建主编模型任务。
- [x] 证明任务/资料命令执行真实本地动作并返回自然话术。
- [x] 证明历史 `system` 消息显示“小文秘书”且不显示系统头像或系统名称。
- [x] 证明未处理服务错误使用友好、无敏感细节的说明。

### Task 3: 实现统一身份与自然话术

**Files:**
- Modify: `apps/api/src/application/local-assistant/local-assistant-service.ts`
- Modify: `apps/api/src/application/chat/conversation-service.ts`
- Modify: `apps/api/src/http/domain-routes.ts`
- Modify: `apps/api/src/http/server.ts`
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`

- [x] 将可见通知写为 `local_assistant_notice`，内部 `system` 来源只保留兼容性。
- [x] 增加本地问候、身份说明、真实任务概览与资料库导航。
- [x] 为所有路由结果提供自然、简短、有证据的话术，补齐点名成员等旧回退分支。
- [x] 前端统一头像、名称、错误提示和右栏身份，并按返回动作打开任务或资料库。

### Task 4: 验证、运行、证据与备份

**Files:**
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/local-secretary-system-merge-20260720.md`
- Modify: `TASKS.md`
- Modify: 本计划复选框

- [x] 运行目标红绿测试、类型检查、全量测试和三端构建。
- [x] 验证空库/升级迁移幂等、Repository隔离和历史消息兼容。
- [x] 启动文秘写作自身服务，验证Web/API/Worker与恢复路径，不触碰智囊团。
- [x] 保存证据、提交、运行正式验收并推送私有远程仓库。

## Self-Review

- Spec coverage：可见身份、内部来源、历史兼容、话术、导航、故障、零Token与创作边界均有合同。
- Placeholder scan：没有TBD、TODO或假功能承诺。
- Type consistency：公开 `sender_type` 兼容旧联合类型，语义由 `message_type` 与前端统一身份表达。
- Execution：老板已要求直接合并，项目禁止其他开发Agent，当前Codex在同一工作树串行完成。
