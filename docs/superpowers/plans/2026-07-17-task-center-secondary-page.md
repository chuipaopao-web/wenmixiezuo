# 任务中心二级页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目根据 `AGENTS.md` 由当前Codex以内联方式执行，不调用其他开发Agent。

**Goal:** 将预算与待确认从右侧成员栏迁入由左侧任务入口打开的二级任务页面，使右侧只显示九名团队成员。

**Architecture:** 保持现有工作区聚合API和数据模型不变，只调整React信息架构。新增 `tasks` 工作区视图，左栏任务中心入口负责切换视图；任务页面复用真实任务、预算、确认数据与既有操作函数；右栏检查器缩减为纯团队组件。

**Tech Stack:** React、TypeScript、Vite、原生CSS、Vitest、Testing Library、axe-core、Phosphor Icons。

## Global Constraints

- 只修改 `D:\wenmixiezuo`，不得修改、停止或重启 `D:\AI智囊团`。
- 不新增付费服务、API Key、数据库迁移或第三方依赖。
- 右侧栏只显示团队成员、头像和真实状态。
- 预算与待确认必须只在任务二级页面出现，并继续使用真实工作区数据和确认接口。
- 左栏当前任务仍显示章节、阶段和状态；单条任务详情与取消能力不得退化。
- 桌面和窄屏布局均不得产生横向溢出。

---

### Task 1: 锁定导航与内容归属

**Files:**
- Modify: `tests/integration/experience/workspace-ui.test.tsx`

**Interfaces:**
- Consumes: `App` 的现有工作区聚合数据和左栏任务列表。
- Produces: “右栏无预算/待确认、任务入口打开二级页、二级页显示预算/确认”的回归契约。

- [x] **Step 1: 写失败测试**

在工作台测试中断言初始右栏只有“团队”和九名成员，页面初始不存在“现金保护线”与“待确认”；点击 `打开任务中心` 后出现 `任务中心` 主标题、预算和待确认内容。

- [x] **Step 2: 运行目标测试确认失败**

Run: `npm test -- --run tests/integration/experience/workspace-ui.test.tsx`

Expected: FAIL，因为当前预算与待确认仍直接渲染在右栏，且没有任务二级视图。

### Task 2: 实现任务二级页面与纯团队右栏

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`

**Interfaces:**
- Consumes: `WorkspaceData.tasks`、`WorkspaceData.budget`、`WorkspaceData.confirmations`、`resolveConfirmation`、现有 `TaskButton`。
- Produces: `WorkspaceView` 的 `tasks` 视图、`TaskWorkspace` 二级页面、仅渲染成员的 `TeamInspector`。

- [x] **Step 1: 增加任务视图路由**

把 `tasks` 加入 `WorkspaceView`，让左栏任务标题成为带明确无障碍名称的按钮，点击后执行 `setView('tasks')` 并关闭移动端左抽屉。

- [x] **Step 2: 迁移预算与确认内容**

新增 `TaskWorkspace`，页面标题为“任务中心”，按“进行中的任务、预算、待确认、最近任务”组织现有数据；确认按钮继续调用 `onDecide`，任务行继续调用现有详情选择函数。

- [x] **Step 3: 收敛右栏组件**

将 `Inspector` 改为 `TeamInspector`，只接收 `workspace` 和 `worker`，只渲染团队标题、九名成员、头像和真实状态。

- [x] **Step 4: 完成桌面与移动样式**

用高密度分隔布局实现任务页面，不新增泛化卡片；数字使用等宽字体；在 `560px` 以下改为单列，确认按钮保持可点且不换行。

- [x] **Step 5: 运行目标测试确认通过**

Run: `npm test -- --run tests/integration/experience/workspace-ui.test.tsx`

Expected: PASS，且重大确认测试从任务中心完成真实接受操作。

### Task 3: 同步产品规则与验收证据

**Files:**
- Modify: `docs/PRODUCT.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `TASKS.md`
- Create: `docs/releases/wm-v1-20260716-220959-d5dd704d/increments/2026-07-17-task-center-page.md`

**Interfaces:**
- Consumes: 最终界面行为和验证结果。
- Produces: 与代码一致的产品说明、老板使用说明、验收标准和增量证据。

- [x] **Step 1: 更新当前规格**

明确左栏任务入口打开任务二级页，任务页承载任务、预算和待确认；右栏只显示团队成员。

- [x] **Step 2: 执行完整门禁**

Run: `npm run verify`

Expected: 类型检查、全部自动测试和API/Web/Worker构建通过。

Run: `npm run migrate`

Expected: `currentVersion: 9` 且 `applied: []`。

Run: `npm run acceptance`

Expected: 发布验收测试通过且审计 `failures: []`。

- [x] **Step 3: 执行运行与视觉验证**

确认 `http://127.0.0.1:43110` 可用，生成1600×1000和500×844截图；桌面右栏仅团队，任务页预算与待确认可见，窄屏无横向溢出。

- [x] **Step 4: 提交并远程备份**

提交功能和验收证据，推送 `origin/main`，并验证本地HEAD与远端 `refs/heads/main` 哈希一致、工作树干净。

## Self-Review

- 需求覆盖：两个功能均迁入任务二级页；右栏只保留团队；原任务详情、取消和确认接口继续使用。
- 占位扫描：没有 `TODO`、`TBD` 或未定义实现步骤。
- 类型一致性：全部数据沿用 `WorkspaceData`、`TaskData` 和现有回调签名，不修改公共API。
