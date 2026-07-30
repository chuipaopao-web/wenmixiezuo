# 分阶段剧情总纲 Implementation Plan

> **For agentic workers:** 本项目按 `AGENTS.md` 禁止调用其他开发 Agent；由当前 Codex 在同一任务中逐项实现、测试和复核。

**Goal:** 将剧情总纲改成由两名编剧独立规划、主编有据整合、按连续章节阶段保存和展示的全书级规划。

**Architecture:** 沿用现有讨论、版本化 Artifact 和规划状态机，不新增数据库。把 `master_outline` 的当前合同升级为 `stage_master_v2`：每阶段保存章节范围、主线遭遇/解决/结果、起承转合、阶段结束状态、待回收信息与伏笔及后续方向；旧版总纲继续只读兼容。相同结构贯穿编剧提示词、主编汇总、服务端校验、前端展示与叙事图谱投影。

**Tech Stack:** TypeScript、Fastify、SQLite、React、Vitest。

## Global Constraints

- 仅在 `D:\wenmixiezuo` 开发，不修改、停止或重启 `D:\AI智囊团`。
- 不新增模型、密钥、付费服务或数据库迁移。
- 起承转合是阶段摘要维度，不是逐章硬模板；章节范围是可版本化预计值，不是正史。
- 两名编剧继续异模型独立规划；主编只能基于真实编剧产物整合，不能伪造意见。
- 旧版 `master_outline` 保持可读取，新确认的剧情总纲必须使用 `stage_master_v2`。

---

### Task 1: 冻结产品语义和审查合同

**Files:**
- Create: `docs/MASTER_OUTLINE_STAGE_PLANNING_AUDIT.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/AGENT_SYSTEM.md`
- Modify: `docs/API.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/DESIGN_GOVERNANCE_AUDIT.md`
- Modify: `docs/COVERAGE_MATRIX.md`
- Modify: `KNOWLEDGE.md`
- Modify: `TASKS.md`

**Interfaces:**
- Produces: `DEC-069` 与 `DR-20260730-03`，作为代码和验收的唯一当前规格。

- [x] **Step 1:** 写明阶段字段、编剧/主编边界、旧版兼容、创造性保护与回滚条件。
- [x] **Step 2:** 将总纲、卷纲、章纲的职责差异同步到当前产品、数据、Agent、API 和验收文档。
- [x] **Step 3:** 运行 `rg -n "DEC-069|DR-20260730-03|stage_master_v2" docs KNOWLEDGE.md TASKS.md`，确认没有规格缺口。

### Task 2: 用失败测试冻结总纲合同

**Files:**
- Modify: `tests/integration/domain/planning-artifact-structure.test.ts`
- Modify: `tests/foundation/mock-model.test.ts`
- Modify: `tests/integration/experience/projections-research.test.ts`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`

**Interfaces:**
- Consumes: `stage_master_v2`。
- Produces: 对解析、跨阶段范围、编剧产物、图谱投影和作者展示的回归测试。

- [x] **Step 1:** 新增完整两阶段样例，断言章节范围、主线三段、起承转合、阶段总结、待回收项和后续方向。
- [x] **Step 2:** 新增缺少解决结果、范围重叠或跳章、缺少起承转合时拒绝保存的测试。
- [x] **Step 3:** 新增前端阶段卡片和主线投影测试，先运行目标测试并记录预期失败。

### Task 3: 升级服务端结构与讨论合同

**Files:**
- Modify: `apps/api/src/application/artifacts/planning-artifact-service.ts`
- Modify: `apps/api/src/domain/artifact-schemas.ts`
- Modify: `apps/api/src/application/discussions/discussion-pipeline-service.ts`
- Modify: `apps/api/src/infrastructure/models/deterministic-model.ts`

**Interfaces:**
- Produces:
  - `StructuredMasterOutline.majorStages[]`
  - `outlineSchema: "stage_master_v2"`
  - 严格的 `parseMasterOutlineDepositOutput(summary)`。

- [x] **Step 1:** 令解析器校验阶段编号、连续章节范围、主线闭环、起承转合、总结、待回收项和后续方向。
- [x] **Step 2:** 令两名编剧在独立阶段各自输出完整 `master_outline` 合同，并在进入交叉质疑前逐份校验。
- [x] **Step 3:** 令主编只基于两份独立方案和交叉质疑整合相同合同，保留分歧与未知，不生成逐章事件。
- [x] **Step 4:** 更新零费用确定性模型，使自动测试覆盖真实结构。
- [x] **Step 5:** 运行目标领域测试，确认非法结构失败、合法结构通过。

### Task 4: 升级作者界面与图谱投影

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/author-presentation.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/api/src/application/projections/narrative-projection-service.ts`

**Interfaces:**
- Consumes: `stage_master_v2`。
- Produces: `MasterOutlineContent` 阶段卡片；主线图谱每阶段仅一条简洁梗概。

- [x] **Step 1:** 总纲页显示全书总览及按阶段排列的卡片，不显示原始 JSON 或英文键。
- [x] **Step 2:** 每张阶段卡固定显示预计章节、剧情主线、起承转合、阶段总结、待回收信息与伏笔、后续方向。
- [x] **Step 3:** 作者编辑支持阶段对象和嵌套字段，不把对象降级为只读机器结构。
- [x] **Step 4:** 图谱使用阶段章节范围与简洁主线闭环，不复制总纲全文。
- [x] **Step 5:** 运行 UI 与投影目标测试。

### Task 5: 完整验证、证据和提交

**Files:**
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/stage-master-outline-20260730.md`

**Interfaces:**
- Produces: 可复核的类型、测试、构建、迁移、运行、恢复和 Git 证据。

- [x] **Step 1:** 运行 `npm.cmd run typecheck`、目标测试和 `npm.cmd run verify`。
- [x] **Step 2:** 运行 `npm.cmd run migrate` 两次，验证空库/升级幂等；运行本机健康探针。
- [x] **Step 3:** 运行 `npm.cmd run verify:backup`、`npm.cmd run acceptance` 和 `git diff --check`。
- [x] **Step 4:** 按 Skill 做两轮自审：先查一致性/来源/越级，再查创造性/过度约束/上下文负担。
- [ ] **Step 5:** 保存证据、提交 Git，并确认工作树干净。
