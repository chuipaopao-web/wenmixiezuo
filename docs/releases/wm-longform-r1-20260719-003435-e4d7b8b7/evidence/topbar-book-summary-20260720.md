# 顶栏书籍信息增量证据

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- 决定：DEC-035
- 任务：UI-20260720-01
- 日期：2026-07-20
- 开发者：当前Codex，未调用其他开发Agent

## 交付范围

- 在桌面48像素顶栏的中间网格位显示真实书名、中文状态、卷数、章数和正史修订。
- 不恢复功能名、功能跳转按钮或主内容区第二条书籍摘要。
- 小于900像素和沉浸阅读隐藏摘要，保持现有移动抽屉和正文阅读体验。
- 不改变数据库、API、附件、检索、上下文、Agent、模型绑定或任何生产数据。

## 验证证据

| 门禁 | 结果 |
|---|---|
| UI专项 | `tests/integration/experience/workspace-ui.test.tsx`，17/17通过，包含真实书名/状态/卷章/正史修订和axe检查 |
| 完整验证 | `npm run verify`，API/Web/Worker/测试类型检查通过；102个测试文件、221项测试通过；三端生产构建通过 |
| 迁移 | `npm run migrate`，Schema 19，`applied: []`，本UI增量无数据库变化 |
| 本地运行 | API `127.0.0.1:43111` health=`ok`；release_id匹配；runtime session 200；Worker=`ready`、`canStartModelTasks=true`；Web `127.0.0.1:43110` 返回200 |
| 视觉 | `topbar-book-summary-20260720.png`，1600×900真实Edge无头截图；顶栏书籍信息位于老板箭头指定位置，主内容区无第二条摘要 |

## 设计与风险检查

- 这是既有工作台的保留式局部调整，继续使用浅绿色令牌、现有字体、图标和边框，不引入第三方设计系统或新依赖。
- 书名超长时单行省略，元数据保持单行；窄屏主动隐藏，不挤压设置和移动抽屉按钮。
- 全书章节数来自卷聚合；正史使用书籍权威 `canonRevision`，没有用最多80章的工作窗口推算全书数量。
- 旧 `.topbar-center` 功能名和 `.workspace-book-summary` 主内容摘要仍由自动测试锁定为不存在。
- 回滚只需非破坏性revert本UI增量，不涉及数据或迁移回滚。

## 提交后门禁

- 功能提交：`087a39c`（`feat: restore compact book summary in topbar`）。
- 功能提交后在干净工作树执行 `npm run acceptance`：3/3通过；审计 `failures: []`；工作树为clean。
- 证据提交推送后再次执行正式验收，并核对本地HEAD与私有远程 `origin/main` 一致；最终值记录在交付回执中。
