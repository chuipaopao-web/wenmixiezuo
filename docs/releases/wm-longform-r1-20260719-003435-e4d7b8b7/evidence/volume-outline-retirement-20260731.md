# 独立卷纲规划层退役证据

- `release_id`：`wm-longform-r1-20260719-003435-e4d7b8b7`
- 决定：`DEC-070`
- `design_review_id`：`DR-20260731-01`
- 数据库迁移：`0033_retire_volume_outline.sql`

## 交付结果

- 作者工作台规划页只保留“本书资料、设定大纲、剧情总纲、章纲”。
- 活动创作流程调整为“开书资料 → 设定大纲 → 剧情总纲 → 未来1—3章滚动章纲 → 正文”。
- 公共 API、讨论编排、模型资料包、写作准备门禁和叙事投影不再创建、确认、展示或读取独立卷纲。
- 正文目录仍可使用物理分卷整理章节；物理卷不再承担规划门禁。
- 历史卷纲 Artifact 和版本保留作审计，迁移后统一归档、取消活动指针，并从作者查询中隐藏。

## 工程验证

- `npm.cmd run typecheck`：通过。
- `npm.cmd test`：130 个测试文件、469 项测试全部通过。
- `npm.cmd run build`：API、Worker 与 Web 生产构建通过。
- `npm.cmd run migrate`：生产库升级到 Schema 33；第二次执行无新增迁移。
- 数据库完整性：`integrity_check=ok`，外键违规为 0。
- 生产数据迁移结果：活动卷纲 Artifact 0、已选卷纲版本 0、卷纲活动指针 0、旧卷纲阶段 0；2 条历史卷纲 Artifact 保留。
- `npm.cmd run verify:backup`：隔离备份恢复通过；备份 `backup-2026-07-31T02-40-18-661Z-e18d830c` 已验证并丢弃隔离恢复副本。
- 本地运行：Web `127.0.0.1:43110` 返回 200；API `/health` 返回 `ok`；Worker 会话状态为 ready。
- 活动书籍 Artifact 探针只返回 `chapter_outline`、`master_outline`、`story_bible`、`writing_contract`，卷纲数量为 0。
- `git diff --check`：通过。

## 证据边界

本次证据证明功能退役、迁移安全、历史可追溯和短流程工程正确性，等级最高为 E2。它不证明删除卷纲后真实长篇文学质量达到 E3/E4；后续纵向样本若出现人物选择空间、合理惊喜、情绪力度或整体阅读质量显著下降，应按 `DR-20260731-01` 的停止条件复核，但不得恢复重复的作者卷纲页面。
