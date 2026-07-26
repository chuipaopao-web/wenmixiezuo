# 书架首页与书内工作台 Implementation Plan

> **For agentic workers:** 本任务按老板要求由当前Codex单独实施，不调用开发子Agent。

**Goal:** 应用从独立书架首页进入；全局团队与设置留在首页，书籍相关功能只在打开书籍后出现。

**Architecture:** 保持现有SQLite、Repository、Worker和按书任务协议不变，只增加导航状态与全局团队模板只读接口。URL仅保存当前打开的书籍ID；回到首页即移除该参数。后台任务仍使用既有 `owner_id + book_id` 隔离并由Worker继续运行。

**Tech Stack:** React、TypeScript、Vite、Fastify、现有REST客户端与Vitest。

## Global Constraints

- 不停止、重启或修改 `D:\AI智囊团`。
- 不新增数据库迁移，不改变任务、预算、正史或模型调用语义。
- 首页不伪造在线成员状态；全局团队页显示岗位模板，真实状态只在书内显示。
- 切换或离开书籍不得暂停后台任务，不得混用附件、草稿或书籍数据。

---

### Task 1: 固化产品导航边界

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/DESIGN_GOVERNANCE_AUDIT.md`

- [ ] 记录书架首页、全局功能、书内功能和后台任务隔离决定。
- [ ] 记录两轮审查、Skill哈希、停止条件和Git回滚方式。

### Task 2: 增加全局团队模板读取

**Files:**
- Modify: `apps/api/src/http/domain-routes.ts`
- Modify: `apps/web/src/lib/api/client.ts`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

- [ ] 先写首页团队模板的失败测试。
- [ ] 增加只读 `/api/v1/team-template`，返回公开职责、边界、默认模型与可公开默认提示词。
- [ ] 禁止返回书籍Agent实例、活动状态、内部提示词或密钥。

### Task 3: 实现书架首页与书内导航

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

- [ ] 先写首页默认显示全部活动书卡片的失败测试。
- [ ] 首页只显示书架、团队、设置、创建和归档入口。
- [ ] 点击书卡进入书内三栏工作台；书内左栏提供返回书架和七项书内功能。
- [ ] 团队从书内功能移除；首页团队展示模板，书内右栏继续显示当前书真实成员状态。
- [ ] URL参数保存当前打开书籍；回首页清除参数。

### Task 4: 验证

**Files:**
- Test: `tests/integration/experience/workspace-ui.test.tsx`

- [ ] 验证首页不请求书内工作区。
- [ ] 验证打开、返回、切换书籍不串书，附件门禁继续生效。
- [ ] 运行 `npm.cmd run verify`。
- [ ] 提交Git；失败时使用单次revert回滚应用与文档，不改数据。
