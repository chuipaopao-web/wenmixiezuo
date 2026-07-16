# 文秘写作产品重命名实施计划

> **For agentic workers:** 本计划必须由当前 Codex 在本会话内逐项执行；老板与项目规则禁止调用其他开发 Agent。

**Goal:** 将首版产品从错误名称“文脉写作”完整、更正为“文秘写作”，并让所有可执行代码、测试、包标识、桌面入口与本地运行数据使用一致的新名称。

**Architecture:** 产品中文名统一替换为“文秘写作”，技术标识按大小写分别从 `wenmai`/`Wenmai`/`WENMAI` 改为 `wenmi`/`Wenmi`/`WENMI`。保留既有 `release_id`，因为它是不可变发布追踪键且 `wm` 同样适用于新名称；禁止改写 Git 历史和来源快照。

**Tech Stack:** React、TypeScript、Vite、Node.js、Fastify、SQLite、PowerShell、Vitest、Git。

## Global Constraints

- 只修改 `D:\wenmixiezuo`，不读取、停止、重启或修改 `D:\AI智囊团`。
- 不修改 `docs/SOURCE_REQUIREMENTS.md`、`docs/FINAL_SOLUTION.md`、`docs/CONSENSUS_LEDGER.md`。
- 现有本地数据库采用先复制、校验、再切换文件名的可逆迁移；不永久删除旧数据库。
- API Key 仍只从环境变量读取；旧前缀改为 `WENMI_`，不得记录密钥值。
- 由当前 Codex 单独实施与复核，不调用开发子 Agent。

---

### Task 1: 固化新决定与回归断言

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `tests/acceptance/delivery-entry.test.ts`
- Modify: `scripts/acceptance-audit.mjs`

**Interfaces:**
- Consumes: 老板最新决定“项目名称是文秘写作”。
- Produces: 可自动检查中文产品名、技术标识、桌面入口与旧名称残留的验收门禁。

- [ ] 在 `docs/DECISIONS.md` 新增决定，记录旧名、新名、技术标识映射、影响文件和生效范围。
- [ ] 把交付入口测试改为读取 `文秘写作-启动.cmd`、`文秘写作-停止.cmd`，并断言启动器的新标识。
- [ ] 在发布审计中检查新桌面入口和中文产品名，并拒绝受保护快照以外的旧名称残留。
- [ ] 运行目标测试，确认旧实现会因入口或名称不匹配而失败。

### Task 2: 统一源码、包与桌面入口

**Files:**
- Modify: `package.json`, `package-lock.json`, `apps/*/package.json`
- Modify: `apps/api/**`, `apps/web/**`, `apps/worker/**`, `scripts/**`, `tests/**`
- Rename: `文脉写作-启动.cmd` -> `文秘写作-启动.cmd`
- Rename: `文脉写作-停止.cmd` -> `文秘写作-停止.cmd`

**Interfaces:**
- Consumes: 中文映射 `文脉写作` -> `文秘写作`；技术映射 `wenmai` -> `wenmi`。
- Produces: `@wenmi/*` 工作区包、`WENMI_*` 环境变量、`wenmi-*` 服务和缓存标识、文秘写作桌面入口。

- [ ] 对非受保护文本文件进行大小写保持的机械替换。
- [ ] 重命名两个桌面 `.cmd` 文件，并同步测试和使用说明。
- [ ] 运行 `npm install --package-lock-only --ignore-scripts`，校验工作区包锁一致。
- [ ] 运行 `rg` 残留扫描；除本计划的历史映射说明外，受保护快照外不得出现旧名称。

### Task 3: 同步当前文档与本地运行数据

**Files:**
- Modify: `README.md`, `KNOWLEDGE.md`, `TASKS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/OWNER_GUIDE.md`, `docs/USER_GUIDE.md`, `docs/releases/**`
- Runtime migrate: `data/database/wenmai.sqlite` -> `data/database/wenmi.sqlite`
- Runtime update: `data/control/release-ledger.sqlite`

**Interfaces:**
- Consumes: 新技术标识和既有 schema 7 数据库。
- Produces: 文档只展示“文秘写作”；运行配置默认打开 `wenmi.sqlite`；任务账本产品名为“文秘写作”。

- [ ] 更新全部当前文档和发布证据中的产品名称、命令与文件链接。
- [ ] 关闭平台进程并确认 43110/43111 无监听。
- [ ] 复制原数据库为 `wenmi.sqlite`，执行 SQLite 完整性检查和 schema 版本检查；保留旧文件作为可逆备份。
- [ ] 更新忽略目录内发布账本的 `product_name`，不得改动 `release_id` 或阶段证据。

### Task 4: 全量验证与提交

**Files:**
- Verify: 全仓修改、迁移后的本地数据库与桌面入口。

**Interfaces:**
- Consumes: Tasks 1-3 的新名称实现。
- Produces: 可复现的类型、测试、构建、迁移、桌面启动/停止和残留扫描证据。

- [ ] 运行 `npm run acceptance`，要求验收测试和名称审计全部通过。
- [ ] 运行 `npm run verify`，要求类型检查、96 项以上自动测试和三端生产构建通过。
- [ ] 连续运行两次 `npm run migrate`，要求 `currentVersion=7` 且第二次 `applied=[]`。
- [ ] 使用 `WENMI_NO_BROWSER=1` 实机运行桌面启动器，检查新服务标识、release_id、Worker、Web 与 127.0.0.1 监听，再执行停止入口并确认端口释放。
- [ ] 运行最终 `rg` 扫描、`git diff --check` 和 `git status`，审查差异后提交一个明确的重命名提交。

## Self-Review

- 规格覆盖：包含中文显示名、代码标识、环境变量、包名、文件名、数据库、文档、测试与运行入口。
- 安全边界：来源快照、Git 历史、`release_id` 和项目外目录不修改；数据库采用复制迁移并保留旧文件。
- 无占位项：每个任务均有明确文件、动作、命令和通过条件。

