# 新建书籍标签与书架归档 UI 实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use verification-before-completion before claiming this plan complete.

**Goal:** 在不改动创作运行链和数据库结构的前提下，交付可实际建书、可逆归档的 UI：书名与频道为唯一必填项，主要标签与必须遵守边界可选，且持续明确“主要选择 + 其他自由发挥”。

**Architecture:** 复用现有 React 单页工作台、定位草稿 `tags` 和书籍生命周期 API。标签目录放在 Web 端独立版本化模块；当前创建接口把频道写入定位分类、把选择写入定位标签。归档只调用已有可逆 archive/restore API，不暴露永久删除。

**Tech Stack:** React 19、TypeScript、Vite、Phosphor Icons、Vitest、Testing Library、axe-core。

---

### Task 1: 冻结标签语义与审计边界

**Files:**
- Create: `docs/ONBOARDING_TAGS_UI_AUDIT.md`
- Modify: `docs/DECISIONS.md`
- Modify: `TASKS.md`

**Step 1:** 记录唯一 `design_review_id`、Skill 哈希、事实/推断/老板偏好/未知项、替代方案与两轮审查。

**Step 2:** 明确主要标签是软方向、未选元素允许自然加入、只有老板明确选择的“必须遵守”是作品级硬边界。

**Step 3:** 运行审计器并确认输出 `PASS`。

Run: `node .agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs docs/ONBOARDING_TAGS_UI_AUDIT.md`

### Task 2: 先写 UI 行为测试

**Files:**
- Modify: `tests/integration/experience/workspace-ui.test.tsx`

**Step 1:** 增加创建界面测试，覆盖书名/频道必填、频道推荐、主要标签、自定义标签、可选硬边界、数量提示和自由发挥说明。

**Step 2:** 增加书架测试，覆盖活动书与归档书分区、归档确认、restore 请求和无永久删除入口。

**Step 3:** 运行目标测试并确认因新 UI 尚未实现而失败。

Run: `npm test -- tests/integration/experience/workspace-ui.test.tsx`

### Task 3: 实现标签目录和创建界面

**Files:**
- Create: `apps/web/src/app/onboarding-tags.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Modify: `apps/web/src/lib/api/client.ts`

**Step 1:** 定义频道、题材、故事特点和必须遵守目录，按男频、女频、不限、待确定排序，并支持搜索与自定义标签。

**Step 2:** 将创建弹窗改为紧凑双区布局；频道必选，标签可不选；超出建议数量只提醒不阻断。

**Step 3:** 创建时把频道与选中标签提交给既有定位草稿接口；不把全部标签库注入模型，不声称候选标签自动发现已经接通。

### Task 4: 实现可逆书籍归档界面

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Modify: `apps/web/src/lib/api/client.ts`

**Step 1:** 主书架只显示活动书，每本书提供独立管理按钮。

**Step 2:** “移到归档”先显示影响说明和确认；成功后刷新书架并选择下一本活动书。

**Step 3:** 已归档书进入折叠区并可恢复；不提供永久删除入口。

### Task 5: 同步当前规格并完成验证

**Files:**
- Modify: `docs/PRODUCT.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `KNOWLEDGE.md`
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/onboarding-tags-ui-20260719.md`

**Step 1:** 同步开书字段、软标签/硬边界与归档规则，明确当前 UI 增量没有启用新的运行时提示编译器。

**Step 2:** 执行 Web 目标测试、类型检查、全量测试、构建、迁移、运行探针和验收。

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run build`

Run: `npm run migrate`

Run: `npm run acceptance`

**Step 3:** 实际启动本项目并确认 `127.0.0.1:43110` 可访问；不修改、不停止、不重启 `D:\AI智囊团`。

**Step 4:** 将新鲜命令、结果、证据等级与回滚方式写入 release 证据，提交并推送当前 `main`。
