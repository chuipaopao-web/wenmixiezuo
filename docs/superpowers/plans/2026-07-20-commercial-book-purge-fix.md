# 商用书籍永久删除修复 Implementation Plan

> **For agentic workers:** 本项目明确要求由当前Codex单独开发，禁止调用其他开发Agent。本计划在当前会话串行执行，采用测试先行和逐层验证。

**Goal:** 归档书输入 `YES` 并再次点击按钮即可永久删除，同时让真实开书产生的全部书内数据在一个事务中完整清理，不再返回“内部错误”。

**Architecture:** UI与API都把确认口令规范化为大小写不敏感、忽略首尾空白的 `YES`；活动书仍不可永久删除。删除服务在事务内先写墓碑，再清理当前书的全部 `owner_id + book_id` 数据及可移植记录的从表，最后删除书籍；开启事务级延迟外键检查，提交前由SQLite验证不存在悬空引用。

**Tech Stack:** React、TypeScript、Fastify、Node.js SQLite、Vitest、Testing Library。

## Global Constraints

- 只修改 `D:\wenmixiezuo`，不得修改、停止或重启 `D:\AI智囊团`。
- 不对任何真实书籍执行永久删除，只使用隔离测试数据库验证。
- 保留“先归档、再输入YES、再点击彻底删除”三步；活动书仍返回409。
- 成功删除必须留下删除墓碑并通过 `PRAGMA foreign_key_check`；失败必须整体回滚。
- 不新增迁移，不修改既有迁移，不调用模型，不产生现金费用。

---

### Task 1: 锁定真实开书删除失败

**Files:**
- Modify: `tests/integration/data-safety/book-lifecycle.test.ts`

**Interfaces:**
- Consumes: `initializeDomainBook`、`BookLifecycleService.permanentlyDelete`。
- Produces: 真实开书全数据删除与外键完整性回归合同。

- [x] **Step 1: 创建真实开书失败测试**

使用 `initializeDomainBook` 创建包含配置、团队、预算、故事圣经和会话的数据，归档后调用永久删除，并断言书籍及 `book_configs` 消失、`PRAGMA foreign_key_check` 为空。

- [x] **Step 2: 运行测试确认根因**

Run: `npx vitest run tests/integration/data-safety/book-lifecycle.test.ts -t "真实开书"`

Expected: 旧实现于 `DELETE FROM books` 失败，错误为 `FOREIGN KEY constraint failed`。

---

### Task 2: 冻结YES商用确认合同

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/PROJECT_CHARTER.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/API.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `TASKS.md`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`
- Modify: `tests/integration/data-safety/book-lifecycle.test.ts`

**Interfaces:**
- Consumes: 老板2026-07-20最新明确决定。
- Produces: `confirmationText = "YES"` 的UI、API、领域与验收合同。

- [x] **Step 1: 记录DEC-037并同步当前规格**

明确替代对象名+短ID口令：输入 `YES`（大小写不敏感、忽略首尾空白）后再次点击即可；活动书、未归档书和非YES仍不能删除。

- [x] **Step 2: 修改UI与领域失败测试**

UI断言 `YSE` 不可提交、`YES` 可提交且请求体为 `{ confirmationText: "YES" }`；领域测试断言 `好` 失败、` yes ` 成功。

- [x] **Step 3: 运行测试确认旧合同失败**

Run: `npx vitest run tests/integration/experience/workspace-ui.test.tsx -t "归档书" tests/integration/data-safety/book-lifecycle.test.ts`

Expected: 旧对象名+短ID确认实现不接受单独 `YES`。

---

### Task 3: 修复确认和全书删除事务

**Files:**
- Modify: `apps/api/src/domain/permanent-delete.ts`
- Modify: `apps/api/src/application/books/book-lifecycle-service.ts`
- Create: `apps/api/src/infrastructure/db/repositories/book-purge-repository.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`

**Interfaces:**
- Produces: `requiredPermanentDeleteText(): "YES"`；`validatePermanentDeleteText(confirmationText): string`；`deleteScopedBookRows(database, scope): void`。

- [x] **Step 1: 简化确认口令**

领域层使用 `confirmationText.trim().toUpperCase() === "YES"` 校验并对规范值 `YES` 计算哈希；UI同步校验并删除完整口令与自动填入按钮。

- [x] **Step 2: 清理可移植记录从表**

在同一事务内先按当前书籍关联的 `portable_operation_id` 与 `portable_manifest_id` 删除 `portable_files`、`import_quarantine_checks` 和 `restore_impact_reports`。

- [x] **Step 3: 清理全部书内作用域表**

从 `PRAGMA table_list` 只选择主库普通表/虚拟表，读取 `PRAGMA table_info`，对同时包含 `owner_id` 与 `book_id` 的表执行参数化作用域删除；排除 `books` 并最后删除它。表名只能来自SQLite元数据且使用双引号转义。

- [x] **Step 4: 延迟外键并原子提交**

`BEGIN IMMEDIATE` 后设置 `PRAGMA defer_foreign_keys = ON`；任何失败回滚，只有墓碑、全部作用域数据和书籍删除均成功才提交，提交后再删除登记文件。

- [x] **Step 5: 运行专项测试**

Run: `npx vitest run tests/integration/data-safety/book-lifecycle.test.ts tests/integration/data-safety/backup-restore.test.ts tests/integration/domain/operations-api.test.ts tests/integration/experience/workspace-ui.test.tsx`

Expected: 全部通过；真实开书数据删除后无外键残留，活动书与非YES仍被阻断。

---

### Task 4: 全量验收、运行与备份

**Files:**
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/commercial-book-purge-fix-20260720.md`
- Modify: `TASKS.md`
- Modify: 本计划复选框

**Interfaces:**
- Produces: 可追溯的红绿测试、全量门禁、运行、提交和远程备份证据。

- [x] **Step 1: 完整门禁**

Run: `git diff --check && npm run verify && npm run migrate`

Expected: 0退出；Schema 19、`applied: []`。

- [x] **Step 2: 只重启文秘写作并探针**

使用 `scripts/stop-desktop.ps1` 和 `scripts/start-desktop.ps1`，验证Web 43110、API 43111、Worker ready；不触碰智囊团。

- [ ] **Step 3: 提交、验收和远程备份**

提交后运行 `npm run acceptance`，推送 `origin/main`，核对工作树干净且本地HEAD等于远程main。

## Self-Review

- Spec coverage：YES确认、活动书门禁、真实开书外键错误、原子回滚、墓碑、防复活、文件清理、UI/API同步、全量验收均有任务。
- Placeholder scan：没有TBD、TODO或未定义实现承诺。
- Type consistency：确认值统一为字符串 `YES`；删除服务继续返回void，公开API响应不变。
- Execution：项目禁止其他开发Agent，老板要求直接修复，因此由当前Codex在本会话串行完成。
