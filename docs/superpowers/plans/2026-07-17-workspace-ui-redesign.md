# 文秘写作工作台界面重设计实施计划

> **For agentic workers:** 本计划由当前 Codex 内联执行；老板和项目规则禁止调用其他开发 Agent。

**Goal:** 把工作台调整为浅绿色、内容优先的紧凑三栏界面，显示九岗位原型头像，把可查看、可取消且能说明章节的当前任务移到左栏，并提供可持久化的底色和字体设置。

**Architecture:** 保留现有 React 单页工作台、REST 轮询与本地模块化单体。前端新增轻量偏好设置模块和头像映射，不引入新 UI 框架；任务 API 只补充数据库已有的章节、任务书和取消状态字段，不新增迁移。头像从 `D:\AI智囊团` 只读复制到文秘写作自己的 `public` 目录，运行时保持完全独立。

**Tech Stack:** React 19、TypeScript、Vite、Fastify、SQLite、Vitest、Testing Library、原生 CSS、Phosphor Icons。

**Design dials:** `DESIGN_VARIANCE=4`，`MOTION_INTENSITY=2`，`VISUAL_DENSITY=7`。整体沿用智囊团的低饱和浅绿和清晰分栏，但压窄两侧栏、减少卡片堆叠，把横向空间优先交给创作与正文。

---

### Task 1：锁定任务与偏好设置契约

**Files:**
- Modify: `apps/api/src/application/tasks/task-service.ts`
- Modify: `apps/web/src/lib/api/client.ts`
- Create: `apps/web/src/app/workspace-preferences.ts`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`
- Test: `tests/integration/experience/workspace-api.test.ts`

**Steps:**
1. 先增加失败测试，要求工作区任务返回 `chapterId`、任务书、检查点和取消请求状态。
2. 增加失败测试，要求设置面板能切换浅绿/米白/雾蓝/夜间底色和小/标准/大/特大字体，并写入 `localStorage`。
3. 扩展 `TaskRecord` 和前端 `TaskData`；字段只读取现有 `tasks.chapter_id`、`task_brief_json`、`checkpoint_json`，不改数据库结构。
4. 实现有容错的偏好读取、保存和 CSS 变量映射。
5. 运行目标测试，确认由红转绿。

### Task 2：接入九岗位原型头像

**Files:**
- Create: `apps/web/public/avatars/team-collage-source.jpg`
- Create: `apps/web/src/app/role-avatars.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`

**Steps:**
1. 只读复制智囊团九宫格原型图到文秘写作自己的静态目录。
2. 按九个固定岗位建立唯一九宫格位置映射；未知岗位使用稳定回退位置。
3. 在右侧成员行显示圆形头像、岗位、真实模型来源和真实状态，不用装饰性假状态。
4. 对头像添加可访问名称，并测试九个岗位都有头像。

### Task 3：把当前任务迁到左栏并支持详情与取消

**Files:**
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`

**Steps:**
1. 增加 `cancelTask(bookId, taskId)` 客户端方法。
2. 在左栏书籍与目录之间加入“当前任务”，只把活跃任务置顶，历史记录可折叠查看。
3. 任务行显示第几章、任务类型、当前阶段、状态和执行岗位；点击打开详情。
4. 详情展示任务 ID、任务目标/范围、检查点、阶段、尝试次数和取消状态。
5. 对可取消状态提供“取消任务”，调用真实取消接口，成功后刷新工作区；终态任务不显示取消按钮。
6. 测试详情打开、章节信息和取消请求路径。

### Task 4：重构内容优先布局与设置面板

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`
- Modify: `tests/integration/experience/offline-pwa.test.ts`

**Steps:**
1. 桌面布局改为约 `208px / minmax(0, 1fr) / 224px`，顶部三段宽度同步；中间对话和正文占据剩余空间。
2. 默认采用浅绿色主题，定义米白、雾蓝和夜间四套具备对比度的 CSS token；不跟随系统强制覆盖用户选择。
3. 顶栏增加设置入口，设置弹窗提供底色预览、字体尺寸和恢复默认值；变更即时预览并持久化。
4. 右栏只保留紧凑团队、预算和待确认，移除重复任务区。
5. 优化聊天流、编辑框、正文宽度、空状态、焦点态、移动抽屉和减少动效模式。
6. 执行 axe 无障碍测试并修复真实问题。

### Task 5：运行、视觉与回归验收

**Files:**
- Modify: `docs/IMPLEMENTATION_PLAN.md`（若存在 UI 验收状态条目）
- Modify: `TASKS.md`（记录本次界面变更与证据）
- Create: `artifacts/verification/ui-redesign/*`（截图和命令证据，若该目录已被证据规则采用）

**Steps:**
1. 运行工作区 UI 与 API 目标测试。
2. 运行 `npm run typecheck`、`npm test`、`npm run build`、`npm run migrate` 和 `npm run acceptance`。
3. 用桌面启动链路启动 API、Worker、Web，验证 `127.0.0.1` 端口、健康检查、页面加载和任务取消链路，再安全停止本次启动的进程。
4. 以桌面和手机视口生成截图，人工检查浅绿主题、侧栏宽度、正文空间、头像、任务详情和设置面板；发现问题立即修复并重跑。
5. 检查无未说明 TODO、无密钥、无 `D:\AI智囊团` 运行时路径。

### Task 6：提交与远程备份

**Files:**
- Modify: Git index and local history only

**Steps:**
1. 检查 `git diff --check` 和 `git status`，确认仅包含本次范围文件。
2. 创建一条清晰的功能提交。
3. 推送 `main` 到私有仓库 `chuipaopao-web/wenmixiezuo`。
4. 比对本地与远程提交哈希，并在交付中给出测试、运行、截图和提交证据。
