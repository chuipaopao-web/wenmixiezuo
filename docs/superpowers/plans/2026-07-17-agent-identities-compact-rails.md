# 女性成员身份与紧凑侧栏 Implementation Plan

> **For agentic workers:** 本项目规则要求当前 Codex 单独实施，不调用其他开发 Agent；以下步骤在当前会话内按 TDD 串行执行。

**Goal:** 将九个职责长称改为女性成员姓名加短岗位，使用智囊团式真实状态标签，并继续缩窄左右侧栏。

**Architecture:** `role_key` 继续作为稳定业务身份；领域层把 `roleName` 缩短为岗位名，把 `displayName` 定义为女性成员名。新增向前迁移同步现有书籍，前端按真实任务和 Worker 状态派生智囊团式状态，不伪造在线或工作状态。

**Tech Stack:** React、TypeScript、原生 CSS、Fastify、SQLite、Vitest、Testing Library。

## Global Constraints

- 仅在 `D:\wenmixiezuo` 修改，保持服务只监听 `127.0.0.1`。
- 不修改、停止或重启 `D:\AI智囊团`。
- 不新增付费能力，不读取或保存 API Key。
- 已合并迁移不可修改；本次新增 `0008_agent_personas.sql`，代码复核后用 `0009_role_titles.sql` 将领域短称修正为真正的职业名称，不改写已执行迁移。
- 内部 `role_key`、职责和任务分派逻辑不变。
- 状态只能由真实任务、Worker 和激活状态派生。

---

### Task 1: 固定九名成员身份与短岗位契约

**Files:**
- Modify: `tests/integration/runtime/agent-team.test.ts`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`
- Modify: `tests/foundation/migration.test.ts`
- Modify: `tests/foundation/contracts.test.ts`

**Interfaces:**
- Produces: 九组 `roleKey -> displayName/roleName` 断言，以及空闲、后台工作中、排队中状态断言。

- [ ] 先写断言：`貂蝉（主编）` 等九名成员均可见，职责长称不再出现在成员栏，模型字符串不占第二行。
- [ ] 运行目标测试，确认旧实现失败。
- [ ] 为迁移列表、Schema 9 和现有数据升级补充断言。

### Task 2: 领域角色和现有数据向前升级

**Files:**
- Modify: `apps/api/src/domain/roles.ts`
- Modify: `apps/api/src/application/agents/agent-team-service.ts`
- Create: `apps/api/src/infrastructure/db/migrations/0008_agent_personas.sql`
- Create: `apps/api/src/infrastructure/db/migrations/0009_role_titles.sql`
- Modify: `apps/api/src/contracts/api.ts`
- Modify: `scripts/acceptance-audit.mjs`
- Modify: `tests/foundation/api-health.test.ts`
- Modify: `tests/foundation/web-app.test.tsx`

**Interfaces:**
- Produces: `roleName` 为简短职业名称，`displayName` 为女性成员名，Schema 版本为 9。

- [ ] 给 `RoleDefinition` 增加 `memberName`，写入九个确定性女性身份。
- [ ] 新团队创建时把 `memberName` 写入 Agent 实例显示名。
- [ ] 新迁移更新现有 `role_templates.display_name` 和 `agent_instances.display_name`，不改变主键和任务引用。
- [ ] 更新 Schema 契约和发布审计锁。
- [ ] 运行领域、迁移和健康测试，确认通过。

### Task 3: 智囊团式成员状态与更窄侧栏

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`

**Interfaces:**
- Consumes: `AgentData.displayName`、`AgentData.roleName`、工作区任务和 Worker 心跳。
- Produces: `姓名（短岗位）` 主行；第二行只显示 `空闲`、`排队中`、`后台工作中`、`需要处理` 或 `已暂停`。

- [ ] 将成员状态从单个 `working` 布尔值改为按成员任务派生的状态对象。
- [ ] 模型来源保留在成员行 `title` 中，避免信息丢失但不占侧栏宽度。
- [ ] 桌面三栏改为约 `176px / 自适应创作区 / 190px`，1180 像素以下进一步收紧，900 像素以下继续使用抽屉。
- [ ] 运行 UI 目标测试并检查无障碍扫描。

### Task 4: 当前规格、账本与验收证据

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/AGENT_SYSTEM.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `TASKS.md`
- Create: `docs/releases/wm-v1-20260716-220959-d5dd704d/increments/2026-07-17-agent-identities.md`

**Interfaces:**
- Produces: 新决定、姓名岗位表、状态语义、回滚方法和验证证据。

- [ ] 记录短岗位与女性身份决定，职责仍留在独立列。
- [ ] 记录 Schema 9 迁移、迁移前验证备份及安全回滚边界。

### Task 5: 完整门禁和远程备份

**Files:**
- Verify only.

- [ ] 运行目标测试、`npm run typecheck`、`npm run test`、`npm run build`。
- [ ] 在空库运行迁移，在当前库运行升级并重复迁移确认 `applied: []`。
- [ ] 启动文秘写作，检查健康接口、九名成员响应、桌面和窄屏截图。
- [ ] 运行 `npm run acceptance` 和 `git diff --check`。
- [ ] 提交后再次运行干净工作树验收，推送 `origin/main` 并校验远端哈希。

## Self-Review

- 规格覆盖：女性姓名、短岗位、智囊团式状态、继续收窄双侧栏均有独立任务和测试。
- 无占位：计划没有未决定的姓名、字段、命令或验收条件。
- 类型一致：API 继续返回已有 `roleName` 与 `displayName`，不新增前端传输字段。
