# 左栏精简与删除确认可用性 Implementation Plan

> **For agentic workers:** 本项目明确要求由当前Codex单独开发，禁止调用其他开发Agent。本计划在当前会话串行执行，并继续遵守测试先行、逐步验证和提交门禁。

**Goal:** 让归档书永久删除确认不再因手工抄写易错而卡住，把“任务”变成左栏同级功能标签，并从左栏移除任务详情块和卷章目录，同时保证正文页仍能浏览全部章节。

**Architecture:** 后端严格确认词、归档门禁、墓碑事务保持不变，只改善前端确认词填入和错误提示。左栏只保留书架与七个主功能标签；现有按卷分页章节浏览器移动到正文工作区，由正文页在“章节列表”和“当前章节”之间切换。

**Tech Stack:** React 19、TypeScript、原生CSS、Vitest、Testing Library、Fastify现有删除API。

## Global Constraints

- 只修改 `D:\wenmixiezuo`，不得读取运行时依赖、修改、停止或重启 `D:\AI智囊团`。
- 不降低永久删除安全门禁；API仍只接受精确的 `YES <书名> <短ID>`，活动书仍不可永久删除。
- 不删除任何现有书籍或生产数据，不新增数据库迁移，不调用付费模型。
- 左栏不再展示任务列表或卷章目录；任务详情和章节浏览能力必须迁入对应中心页面，不能只隐藏功能。
- 1500章规模继续按卷、每页最多80章加载，不能把全书章节一次挂载到DOM。

---

### Task 1: 用失败测试锁定老板要求

**Files:**
- Modify: `tests/integration/experience/workspace-ui.test.tsx`

**Interfaces:**
- Consumes: `App`、现有测试工作区fixture与fetch router。
- Produces: 删除确认填入、七标签左栏、正文内章节浏览三个回归合同。

- [x] **Step 1: 修改删除测试**

输入 `YSE` 后断言出现“确认词不匹配”，点击“填入完整确认词”后断言输入框值等于 `YES 雾钟档案 ookui1`、删除按钮启用，最终请求仍发送完整确认词。

- [x] **Step 2: 修改左栏测试**

断言“创作功能”导航包含“任务”，左栏不存在“当前任务”“卷章目录”，旧 `.task-center` 与 `.chapter-tree` 节点为零。

- [x] **Step 3: 修改正文测试**

点击“正文”后断言中心区出现“章节列表”，选择第一章后出现正文，再点击“章节列表”可返回中心章节浏览器。

- [x] **Step 4: 运行测试确认失败**

Run: `npx vitest run tests/integration/experience/workspace-ui.test.tsx`

Expected: FAIL，缺少“任务”标签、确认词填入按钮和正文内章节浏览器。

---

### Task 2: 改善永久删除确认交互

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`

**Interfaces:**
- Consumes: `permanentDeleteShortId(book.bookId)` 和既有 `onConfirm(confirmationText)`。
- Produces: `PurgeBookDialog` 的“填入完整确认词”按钮与不匹配提示；API载荷不变。

- [x] **Step 1: 实现受控填入按钮**

在确认口令输入框旁增加 `type="button"` 的“填入完整确认词”，点击只把既有 `required` 字符串写入受控输入框，不直接触发删除。

- [x] **Step 2: 实现明确错误状态**

输入非空且不匹配时显示 `role="alert"` 的说明；“彻底删除”仍由 `confirmation === required` 控制，最终仍需第二次点击。

- [x] **Step 3: 运行删除专项测试**

Run: `npx vitest run tests/integration/experience/workspace-ui.test.tsx -t "归档书只有" tests/integration/data-safety/book-lifecycle.test.ts`

Expected: PASS；活动书、错误口令、事务墓碑合同无回退。

---

### Task 3: 精简左栏并把章节浏览归入正文页

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

**Interfaces:**
- Consumes: `WorkspaceData`、`fetchVolumeChapters`、`selectedChapterId`、`onSelectChapter`。
- Produces: 七个 `RailViewButton`；`ManuscriptWorkspace`；中心 `ManuscriptChapterBrowser`。

- [x] **Step 1: 把任务加入主导航**

在“版权”之后增加同样式“任务”按钮，点击设置 `view='tasks'`；删除左栏 `TaskCenter` 渲染及其未使用组件。

- [x] **Step 2: 从左栏移除卷章目录**

删除左栏 `VolumeChapterTree` 渲染；保留按卷分页、搜索、状态筛选逻辑并重命名为 `ManuscriptChapterBrowser`，使其成为正文页面内容。

- [x] **Step 3: 增加正文工作区状态**

`ManuscriptWorkspace` 在尚未选章时显示章节列表，选章后显示 `ManuscriptView`；正文标题提供“章节列表”按钮，返回后仍可回到当前章节。切书通过 `key={bookId}` 重置为列表。

- [x] **Step 4: 调整中心样式与长篇边界**

章节浏览器占满中心区并独立滚动；桌面使用宽列表，窄屏降为单列；卷分页仍为80章。删除只属于旧左栏的 `.task-center` 和 `.chapter-tree` 样式，不删除任务中心共用样式。

- [x] **Step 5: 运行完整UI测试**

Run: `npx vitest run tests/integration/experience/workspace-ui.test.tsx`

Expected: PASS，左栏无任务详情和卷章目录，任务与正文入口均可用，axe无新增违规。

---

### Task 4: 同步当前决定、验收和交付证据

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `TASKS.md`
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/left-navigation-delete-usability-20260720.md`

**Interfaces:**
- Consumes: 老板2026-07-20最新UI决定与本计划测试结果。
- Produces: 可执行的当前规格、任务账本和真实证据。

- [x] **Step 1: 新增决定并替代旧左栏规则**

记录任务成为第七个主功能标签、左栏任务详情/卷章目录删除、正文页承载章节浏览和删除确认填入辅助；不修改来源快照。

- [x] **Step 2: 更新当前规格和使用说明**

所有当前文档统一为“左栏七标签、正文内章节列表、严格确认词可辅助填入但仍需最终点击”。

- [x] **Step 3: 运行完整门禁**

Run: `git diff --check && npm run verify && npm run migrate`

Expected: 0退出；Schema仍为19且 `applied: []`。

- [x] **Step 4: 本地运行与视觉检查**

只重启文秘写作自身服务，验证API 43111、Web 43110、Worker和1600×900页面；不得触碰智囊团。

- [x] **Step 5: 提交后正式验收与备份**

Run: `npm run acceptance`，提交并推送 `origin/main`，最后核对 `git status --porcelain` 为空且 `git rev-parse HEAD` 等于 `git rev-parse origin/main`。

Expected: acceptance 3/3、审计失败0、远程与本地一致。

## Self-Review

- Spec coverage：删除可用性、任务标签、左栏任务块删除、左栏卷章目录删除、正文章节入口、长篇分页和安全门禁均有对应任务。
- Placeholder scan：计划中没有TBD、TODO或未定义实现承诺。
- Type consistency：沿用 `WorkspaceData`、`ChapterData`、`fetchVolumeChapters`、`onSelectChapter`，不新增API或Schema。
- Execution：老板已明确要求直接调整，项目又禁止其他开发Agent，因此本计划立即在当前会话串行执行，不再请求执行方式。
