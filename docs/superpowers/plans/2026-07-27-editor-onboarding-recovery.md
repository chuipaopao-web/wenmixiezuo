# 主编主动接待可靠性修复 Implementation Plan

> **For agentic workers:** 本任务按老板要求由当前 Codex 单独实施，不调用开发子 Agent。

**Goal:** 新书确认后直接进入对话页，由活动主编读取本书资料主动引导设定大纲；主编调用异常时自动交由真实候任副编继续，前端不再显示无解释的空白页。

**Architecture:** 沿用 DEC-054、DEC-046 与 `DR-20260723-01`，不改变数据库、岗位合同、正史规则或剧情工作流。开书仍只创建一个幂等 `conversation_reply` 任务；模型结果未知或技术失败时复用现有 editor epoch 接管与原任务续跑机制。前端根据同一开场任务的真实状态展示等待或失败说明，不生成假回复。

**Tech Stack:** TypeScript、Fastify、SQLite、独立 Worker、React、Vitest。

## 约束与停止条件

- 不触碰 `D:\AI智囊团`，不新增付费调用或密钥。
- 开场只读取开书定位资料；不自动生成正文、剧情总纲或章纲，不启动双编剧。
- 开场对话不进入正史；刷新页面不得重复创建任务或回复。
- 只有真实模型成功后才以对应成员身份保存消息；失败状态必须可见且可追踪。
- 若修复需要改变11人岗位或模型绑定合同，立即停止并升级老板；本计划不授权该变更。

### Task 1：建立故障基线与回归测试

**Files:**
- Modify: `tests/integration/domain/open-conversation-runtime.test.ts`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`

- [x] 复现主编调用结果未知后任务直接失败、页面为空。
- [x] 增加“结果未知触发副编接管并从原任务续跑”测试。
- [x] 增加空会话按开场任务真实状态显示等待/失败说明的界面测试。

### Task 2：修复后台开场接管

**Files:**
- Modify: `apps/api/src/application/chat/conversation-reply-pipeline-service.ts`

- [x] 将 `interrupted/provider_result_unknown` 识别为不可原模型重试、但可触发候任主编接管的故障。
- [x] 保持点名成员不自动转交；普通主编开场和开放回复才允许接管。
- [x] 接管成功后由现有 epoch 事务把原任务重新排队，并原子切换候任成员的模型快照，禁止创建第二个开场任务。

### Task 3：修复对话页开场状态

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`

- [x] 新书仍直接打开对话页。
- [x] 没有可见消息但开场任务排队或执行时，显示“主编正在整理开书资料”。
- [x] 开场任务失败、阻塞或中断时，显示真实故障和任务入口提示，不伪造主编回复。

### Task 4：恢复本次已失败的新书开场并验收

**Files:**
- Modify: `TASKS.md`
- Evidence: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/increments/`

- [x] 在代码修复生效后，仅将当前书的唯一失败开场任务安全重排队，保留原调用和失败审计记录。
- [x] 验证接管副编使用自己的 Kimi 模型快照真实回复；首轮过长输出被保留审计，收紧合同后以353输出Token形成可展示短开场。
- [x] 执行类型检查、目标测试、全量测试、构建、迁移和本地运行验证。
- [x] Git 提交；回滚使用单次 `git revert`，不删除书籍、消息或调用证据。
