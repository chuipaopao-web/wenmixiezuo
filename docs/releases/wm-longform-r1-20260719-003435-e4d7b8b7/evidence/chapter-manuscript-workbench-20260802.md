# 章节式正文工作台验收证据

- release_id：`wm-longform-r1-20260719-003435-e4d7b8b7`
- design_review_id：`DR-20260802-chapter-manuscript-workbench-v1`
- 决定：DEC-089
- 范围：正文页章节目录、逐章导入与保存、优化候选、AI点评、整本旧稿可选导入
- 数据边界：全部验证使用前端模拟响应与隔离临时迁移目录；没有创建、修改或删除作者书架中的书籍。

## 功能结果

- 正文页默认显示扁平章节列表；空书显示唯一的“第1章”入口，非空书可新增下一章。
- 当前章支持直接粘贴或选择单章TXT，保存后形成新的不可变正文版本。
- “优化表达”“自然化（去AI腔）”“自定义优化”只生成候选版本，不覆盖作者原文。
- “AI点评”复用正式三席点评链，但点评完成后仍需作者确认，不能自动定稿或写入正史。
- 原整本TXT识别、预览、确认和断点恢复能力保留为明确的可选入口。

## 自动验证

| 门禁 | 命令 | 结果 |
|---|---|---|
| 专项界面与流程 | `npm.cmd exec vitest run tests/integration/experience/workspace-ui.test.tsx` | 39/39 通过 |
| 全量自动测试 | `npm.cmd run test` | 138个测试文件、564项测试通过 |
| 全仓类型检查 | `npm.cmd run typecheck` | 通过 |
| Web类型检查（最终修改后复验） | `npm.cmd run typecheck -w @wenmi/web` | 通过 |
| 全仓构建 | `npm.cmd run build` | API、Web、Worker通过；仅保留Vite包体积提示 |
| Web构建（最终修改后复验） | `npm.cmd run build -w @wenmi/web` | 通过；仅保留Vite包体积提示 |
| 空库迁移 | 隔离 `WENMI_DATA_DIR` 后执行 `npm.cmd run migrate` | 0001—0034成功，当前版本34 |
| 升级/幂等迁移 | 同一隔离目录再次执行 `npm.cmd run migrate` | 无待执行迁移，当前版本34 |
| 设计审计格式 | `node .agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs docs/CHAPTER_MANUSCRIPT_WORKBENCH_AUDIT.md` | 通过 |
| 差异空白检查 | `git diff --check` | 通过；只有仓库既有LF/CRLF提示 |

`npm.cmd run acceptance` 中3项验收测试均通过；审计脚本只因当前工作区仍包含本轮及此前尚未提交的开发修改而报告“工作树不干净”。没有为通过该检查而擅自提交、清理或覆盖用户修改。

## 证据边界

当前证据等级为E2：能证明接口、界面状态、版本保护、迁移和回归链可运行。它不能证明任意模型对任意小说都能稳定提升文学质量，也不能把“自然化”解释为可靠的AI作者概率检测。相关效果仍需多题材、多章节盲评后才能提升到E3/E4。
