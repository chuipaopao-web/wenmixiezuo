# 对话附件、左右布局与归档书严格永久删除证据

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- `design_review_id`：`DR-20260719-12`
- 决定：DEC-034
- 证据等级：E2工程证据；没有声称E3独立附件检索金标或E4真实模型文学质量。

## 已交付范围

- 中部不再重复显示功能标题或书籍摘要，各工作页占满主内容区。
- Agent/系统消息带头像靠左，老板消息带头像靠右；输入区移除帮助行并增加附件加号。
- 图片可预览；TXT/Markdown/JSON/CSV/LOG、可提取文字PDF和DOCX由本地解析。扫描PDF/图片不冒充OCR成功。
- 单文件20 MiB、单消息6个、附件上下文合计12,000字符；附件按书隔离，只属于临时层，不自动进入正史、正式正文或正式向量投影。
- 归档区提供彻底删除入口；活动书被后端409阻断，确认词严格为 `YES <书名> <短ID>`，沿用事务、墓碑和备份防复活契约。

## 新鲜验证

| 门禁 | 命令/证据 | 结果 |
|---|---|---|
| 设计审计 | `validate-audit.mjs docs/CHAT_ATTACHMENTS_UI_AUDIT.md` | PASS |
| 差异格式 | `git diff --check` | 通过；仅Windows换行提示 |
| 类型检查 | `npm run typecheck` | API、Web、Worker和测试类型均通过 |
| 全量自动测试 | `npm test` | 102个测试文件、221项通过 |
| 生产构建 | `npm run build` | API、Web、Worker通过；Web 4562模块完成 |
| 正式迁移 | `npm run migrate` | 应用0019到Schema 19；第二次 `applied: []` |
| 升级恢复 | `migration-0019-upgrade.test.ts` | Schema 18→19保留既有书籍、消息和正史 |
| 正式备份隔离恢复 | `npm run verify:backup` | `integrity_check=ok`、外键0、哈希一致，隔离副本验证后清理 |
| 本地运行 | 重启文秘写作并探测127.0.0.1 | health=ok、HttpOnly会话200、Worker ready、Web 200、运行时Schema 19 |
| 视觉 | `chat-attachments-purge-ui-20260719.png` | 1600×900真实Edge截图，确认顶部重复区消失、左右气泡和加号存在 |
| 发布测试 | `npm run acceptance` | 3/3功能验收通过；提交前仅“工作树未提交”门禁按设计未通过，提交后复跑 |

最新备份ID：`backup-2026-07-19T15-33-29-460Z-1b12c331`；数据库哈希：`d4da6e6bf94c22e82375b11fe3f5d365f3b4be1fa3598f7ebcf544780e9b62c3`；清单哈希：`6dd94e2d89bc970df5afb83195d30b7625f5204c6f0ac58e931da327a1e2b062`。

## 边界与回滚

扫描PDF、图片文字识别、临时附件语义检索和视觉模型理解未实现，也未伪装为可用。附件机制若在后续真实模型盲评中降低原创性、人物辨识度、情绪力度或整体阅读质量，关闭附件上下文注入并退回纯文本对话，原文件和消息继续保留。Schema 0019只向前新增，不回退旧迁移。
