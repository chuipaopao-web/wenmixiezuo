# 删除独立卷纲规划层 Implementation Plan

> **For current Codex:** `AGENTS.md` 禁止调用其他开发 Agent，本计划由当前 Codex 在同一任务中串行实现、测试和复核。

**Goal:** 从作者可见产品、活动创作流程、模型资料包和正式写作门禁中删除“卷纲”，将流程收敛为“开书资料 → 设定大纲 → 剧情总纲 → 未来 1—3 章章纲 → 正文”，同时保留物理分卷目录和历史卷纲审计数据。

**Architecture:** 沿用现有 SQLite、不可变 Artifact、规划状态机和持续创作会话。`master_outline` 的 `stage_master_v2` 继续承担全书阶段规划；中期故事弧保存在已确认讨论决定及其资料包中，章纲直接引用活动总纲和讨论决定。旧 `volume_outline` Artifact 通过向前迁移归档并从作者 API 隐藏，不重写旧迁移、不物理删除历史版本。

**Tech Stack:** TypeScript、Fastify、SQLite、React、Vite、Vitest。

## Global Constraints

- 只在 `D:\wenmixiezuo` 修改；不修改、停止或重启 `D:\AI智囊团`。
- “卷纲”指独立规划成果，不指正文目录中的物理“卷”分组。
- 不删除旧卷纲版本、来源或审计记录；迁移只清除活动指针并归档作者可见成果。
- 不因删层而一次生成更长章纲；仍只细化未来 1—3 章。
- 新流程不增加全量上下文；章纲只取活动总纲的相关阶段、当前讨论决定、必要正史和近期锚点。

---

### Task 1: 冻结决定、审查与当前规格

**Files:**
- Create: `docs/VOLUME_OUTLINE_RETIREMENT_AUDIT.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/API.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/AGENT_SYSTEM.md`
- Modify: `docs/LONGFORM_QUALITY.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/DEVELOPMENT_ROADMAP.md`
- Modify: `docs/ULTRA_LONGFORM_CONTINUITY.md`
- Modify: `KNOWLEDGE.md`
- Modify: `TASKS.md`

**Acceptance:**
- `DEC-070` 与 `DR-20260731-01` 明确新流程、历史兼容、创造性风险和回滚条件。
- 当前规格不再把卷纲列为作者页签、确认门禁、写作必需来源或 Agent 产物。
- 历史证据仍保持历史事实，不伪装成当前产品合同。

### Task 2: 用失败测试冻结无卷纲流程

**Files:**
- Modify: `tests/integration/domain/planning-artifact-structure.test.ts`
- Modify: `tests/integration/domain/discussion-runtime.test.ts`
- Modify: `tests/integration/experience/workspace-api.test.ts`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`
- Modify: `tests/integration/experience/projections-research.test.ts`
- Modify: `tests/helpers/domain-fixture.ts`
- Modify: `tests/foundation/mock-model.test.ts`

**Acceptance:**
- 总纲确认后可直接进入持续讨论与滚动章纲。
- 没有卷纲时正式写作准备仍可完成，但缺总纲或章纲仍被阻断。
- 作者 API 与 UI 不返回、不显示卷纲。
- 叙事主线投影只使用活动总纲阶段，不使用历史卷纲。

### Task 3: 收敛服务端状态机和生成链

**Files:**
- Modify: `apps/api/src/application/books/planning-state-service.ts`
- Modify: `apps/api/src/application/artifacts/planning-stage-artifact-service.ts`
- Modify: `apps/api/src/application/artifacts/planning-artifact-service.ts`
- Modify: `apps/api/src/application/creation/writing-readiness-service.ts`
- Modify: `apps/api/src/application/chat/conversation-service.ts`
- Modify: `apps/api/src/application/discussions/discussion-pipeline-service.ts`
- Modify: `apps/api/src/application/projections/narrative-projection-service.ts`
- Modify: `apps/api/src/infrastructure/models/deterministic-model.ts`
- Modify: `apps/api/src/domain/role-prompts.ts`
- Modify: `apps/api/src/http/domain-routes.ts`

**Acceptance:**
- 活动状态不再进入 `volume_outline_in_progress` 或 `volume_outline_ready`。
- 总纲活动版本直接成为章纲上游；章纲来源不再携带 `sourceVolumeOutlineVersionId`。
- 讨论路由、提示词、确定性模型、上下文包和叙事投影均无活动卷纲合同。
- 公共接口拒绝新建或确认卷纲，历史数据只读审计且不出现在作者工作台。

### Task 4: 删除前端卷纲入口和信息

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/src/app/author-presentation.ts`
- Modify: `apps/web/src/styles.css`

**Acceptance:**
- 规划页只有本书资料、设定大纲、剧情总纲和章纲。
- 进度提示、空状态、操作按钮、作者说明和错误文案不再出现“卷纲”。
- 历史聊天中的内部卷纲协议仍由展示层过滤，不能泄漏 JSON 或技术字段。

### Task 5: 向前迁移历史活动卷纲

**Files:**
- Create: `apps/api/src/infrastructure/db/migrations/0033_retire_volume_outline.sql`
- Modify: migration/repository contract tests as required

**Acceptance:**
- 旧 `volume_outline_in_progress` / `volume_outline_ready` 安全映射到有活动总纲时的 `master_outline_ready`，否则映射到 `master_outline_in_progress`。
- `volume_outline_version_id` 清空；旧卷纲 Artifact 归档且作者 API 隐藏；旧版本行保留。
- 已到 `chapter_outline_ready` 或 `writing_enabled` 的书不回退。
- 空库和升级库迁移均幂等通过。

### Task 6: 全量验证、证据和 Git 提交

**Files:**
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/remove-volume-outline-20260731.md`
- Modify: `docs/COVERAGE_MATRIX.md`

**Commands:**
- `npm.cmd run typecheck`
- Targeted Vitest suites for planning, discussion, workspace, projection and migration
- `npm.cmd run build`
- `npm.cmd run migrate` twice
- empty-database migration verification
- `npm.cmd run verify:backup`
- `npm.cmd run verify`
- `git diff --check`

**Acceptance:**
- 类型、目标测试、全量测试、构建、空库/升级迁移、运行健康、备份恢复和数据库完整性全部通过。
- 第一轮复核确认无越级、无串书、无历史破坏；第二轮复核确认未把总纲膨胀成卷纲替代物、未增加上下文负担或创意硬约束。
- 保存证据并创建 Git 提交；不能用确定性模型结果外推文学质量。
