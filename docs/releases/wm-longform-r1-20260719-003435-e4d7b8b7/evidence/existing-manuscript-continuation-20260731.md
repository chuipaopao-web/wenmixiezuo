# 已有正文导入与接续创作验收证据

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- 决定：DEC-077
- `design_review_id`：`DR-20260731-existing-manuscript-continuation-v1`
- 基线提交：`f8b1eab`
- Skill：`wenmi-longform-quality`
- Skill SHA-256：`DFBB5275C6521CAF248DBFB89229ACEAA34ADA4AAEC279CE2A272E8D4D11BF07`
- 证据等级：E2（工程可运行证据，不外推真实长篇文学质量）

## 交付行为

1. 空书可从“正文 → 续写已有作品”粘贴或选择 TXT，原文上限为 500 万规范化字符。
2. 预览阶段只保存导入草案及耐久原文件，不创建章节、正文版本或正史；作者可改标题、排除误识别段落。
3. 明确勾选确认后才导入；已有章节书、跨书访问、内容哈希变化和重复确认均有服务端门禁。
4. 导入正文使用不可变完整版本，逐章结算正史并建立可重建索引请求；不补造历史模型点评或三席审校。
5. 确认后生成最小“续写诊断资料包”交给主编，只诊断承接点与待确认问题，不自动写新章；未来新章继续走正常章纲、生成、三席点评、修订和结算链。
6. 切换书籍会清空旧预览；失败后可从最新检查点恢复；应用已有实例时启动器不会覆盖有效 PID 记录。

## 自动验证

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm.cmd run typecheck` | 通过 |
| 全量测试 | `npm.cmd test` | 133 个文件、484 项测试通过 |
| 专项测试 | `npx.cmd vitest run tests/unit/continuation tests/integration/continuation tests/integration/experience/workspace-ui.test.tsx` | 3 个文件、43 项测试通过 |
| 构建 | `npm.cmd run build` | API、Worker、Web 构建通过；Web 产物已生成 |
| 迁移 | `npm.cmd run migrate` | 当前 Schema 34，无待执行迁移 |
| 迁移契约 | 全量测试中的 foundation migration/upgrade 契约 | 空库与升级路径通过 |
| 备份恢复 | `npm.cmd run verify:backup` | 隔离恢复、完整性与外键检查通过；备份 `backup-2026-07-31T15-50-23-190Z-bacbb581` |
| 运行烟测 | `WENMI_RUNTIME_SMOKE=1 npm.cmd start` | API、Web、Worker、SQLite FTS5、向量运行时通过 |
| HTTP 探针 | API `127.0.0.1:43111`、Web `127.0.0.1:43110` | 健康接口正常，Web 返回 200 |
| Acceptance 专项 | `npx.cmd vitest run tests/acceptance` | 3 项通过 |
| 差异卫生 | `git diff --check` | 无空白错误（仅 Git 的 CRLF 提示） |
| 最终验收 | `npm.cmd run acceptance` | 3 项 acceptance 测试和 23 项 release 审计全部通过，失败项为 0；工作树在验收时干净 |

## 重点测试断言

- 中文“第N章/回”、英文 `Chapter N`、前言、无标题单章和换行/BOM 归一化。
- 预览不写章节/正文/正史，确认后原文逐字一致且字符范围、哈希稳定。
- 排除前言、标题修改、幂等重试、已存在章节拒绝、owner/book 隔离和 HTTP 契约。
- 导入创作者类型为 `import`；正史结算和索引请求存在；主编接续动作不会误启双编剧或自动写作。
- UI 完整流程、最新检查点恢复、跨书切换清理、空书状态和确认失败回取。

## 人工差异复核

项目合同要求当前 Codex 单独开发，不调用其他开发 Agent，因此未使用审查子 Agent。唯一负责人按审查清单检查了：授权边界、跨书隔离、事务原子性、幂等、源文件耐久性、永久删除覆盖、检查点恢复、上下文最小化、前端状态泄漏和无伪造 Agent 状态。删除链无需另加旁路：导入源位于书籍隔离目录，现有全书永久删除会清理带 `owner_id + book_id` 的表及该书目录。

## 局限与停止条件

- 章标题识别是确定性工程解析，不承诺识别所有非标准排版；预览与人工修改是强制安全边界。
- 本证据没有调用付费真实模型，也没有证明真实作者的文学接续质量。若出现原文丢失、跨书混入、确认前业务写入、重复正史、硬来源被预算截断或新章绕过审校，应立即停用入口并向前修复。
