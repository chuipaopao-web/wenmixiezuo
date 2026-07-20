# 正文空稿与规划职责投影修复证据

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- 决定：DEC-042
- `design_review_id`：`DR-20260720-04`定向复核
- 日期：2026-07-20
- 开发者：当前Codex单独完成；未调用其他开发Agent，未访问或修改 `D:\AI智囊团`
- 现金与密钥：未调用真实/付费模型，未读取、输出或写入API Key

## 根因与修复

1. 前端曾把“已有正文版本”错误当成编辑前提；无正文的计划章读取404后没有可编辑空状态，导致骨架持续显示，动作区也不渲染。
2. 作者草稿服务原本已经支持 `baseManuscriptVersionId=null` 的第一稿CAS，本次没有修改数据库和服务契约，只补齐前端状态与领域回归测试。
3. `story_bible.positioning` 被整体放在“基本设定”。本次保留一个完整版本化故事圣经，只做全书框架/基本设定字段投影；子区编辑合并回完整对象，隐藏字段不丢失。
4. 桌面正文目录从 `clamp(210px, 19vw, 286px)` 调整为 `clamp(176px, 13vw, 224px)`，正文编辑宽度上限从860px扩为960px；移动端继续使用上下分区。

## 定向证据

- 命令：`npm test -- --run tests/integration/creation/owner-manuscript-service.test.ts tests/integration/experience/workspace-ui.test.tsx`
- 结果：2个测试文件、24项测试全部通过。
- 覆盖：空稿第一稿null-CAS、自动选择第一章、重写/定稿首存前禁用、首存后启用、未保存修改门禁、框架/设定字段不重复、基本设定保存保留作品定位、目录宽度合同。
- Skill审计：`node .agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs docs/MANUSCRIPT_PLANNING_REFINEMENT_AUDIT.md`，结果PASS。

## 全量门禁

- `npm run verify`：通过。
  - TypeScript：API、Web、Worker和测试类型检查通过。
  - 自动测试：108个测试文件、267项测试全部通过。
  - 构建：API/Worker TypeScript生产构建和Web Vite构建通过；Web产物为 `index-BW8Y0-cq.js` 与 `index-B2_fcn17.css`，运行中的Web入口已读取最新JS而非上一构建。
- 首次无并发上限的全量测试曾出现Vitest fork异常回收：107文件/265项断言通过但存在1个未处理Worker退出，因此未计为通过。以 `--maxWorkers=4` 复跑后108文件/267项全过，并把4 Worker稳定上限写入正式Vitest配置；随后正式 `npm run verify` 再次全过。
- `git diff --check`：通过；仅Git提示当前Windows检出行结束符转换，不存在空白错误。

## 迁移、恢复与运行

- `npm run migrate` 连续执行两次：两次均 `applied: []`、`currentVersion: 23`，证明本修复不改Schema且正式库迁移幂等。
- `npm run verify:backup`：通过。
  - 备份：`backup-2026-07-20T05-22-54-179Z-3bafaea1`
  - 生产库完整性：`ok`；外键违规：0。
  - 隔离恢复：`verified: true`、完整性 `ok`、外键违规0；校验后隔离副本已丢弃，没有执行生产数据恢复。
- 通过项目的安全停止入口停止旧“文秘写作”进程，再用桌面启动脚本启动最新构建；没有停止、重启或修改AI智囊团。
- 运行探针：`http://127.0.0.1:43110` 返回200；API可建立HttpOnly本机会话；Worker为 `ready`；最新桌面错误日志大小为0。
- 正式数据只读实测：当前1本书《这游戏上线就给钱》，1个计划章且没有当前正文版本；这正是本次空稿编辑状态覆盖的真实场景。故事圣经仍为单一成果，正式artifact类型为 `chapter_outline,story_bible,writing_contract`。

## 正式验收状态

- 提交前执行 `npm run acceptance`：3个验收测试全部通过；审计除“工作树干净”外其余条款全部通过。“工作树干净”在施工尚未提交时按设计阻断，不把该轮记录为最终通过。
- 功能提交：`4f7bbcf`（`fix: refine manuscript and planning workspaces`）。提交后在干净工作树重跑 `npm run acceptance`：3个验收测试全部通过，所有审计条款通过，`failures: []`。
- 证据补录提交为 `ab3d826`；第二次干净工作树正式验收仍为3/3、`failures: []`。随后已成功推送 `38d3905..ab3d826` 至 `origin/main`。

## 证据边界与回滚

- 本证据达到E2工程证据：证明状态、版本、投影、构建、迁移、恢复和本地运行行为，不宣称E3/E4真实长篇创作质量。
- 本修复不修改模型上下文、检索、生成或审校，所以不把页面调整冒充创造性提升。基本设定可留空，不阻断开放讨论或试写。
- 若出现第一稿覆盖旧版本、隐藏规划字段丢失、未保存正文仍可定稿、跨书请求或移动端无法选章，停止发布并非破坏性revert业务/UI；不删除正文版本、正史、规划历史或Schema。
