# UI-20260717-02 女性成员身份与紧凑侧栏验收记录

## 追踪信息

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- 决定：`DEC-005`
- 实施计划：`docs/superpowers/plans/2026-07-17-agent-identities-compact-rails.md`
- 功能提交：`28c5077 feat: add female agent identities`
- 执行与复核：当前Codex单独完成，未调用其他开发Agent。

## 交付范围

1. 九名成员固定为貂蝉、婉儿、文姬、秋香、妲己、昭君、清照、道韫和弄玉。
2. 界面职业名称改为主编、编剧、设定师、主笔、审校、体验官、文编、研究员和版权顾问。
3. 完整职责继续保存在岗位模板职责字段，不再作为成员栏名称。
4. 九名成员在右栏全部直接显示，不再默认折叠四名按需专家。
5. 状态位于姓名下方，采用空闲、排队中、后台工作中、需要处理和离线；颜色与AI智囊团状态语义一致。
6. 后台工作中必须同时匹配任务状态、分配成员、Worker就绪状态和当前任务心跳。
7. 模型来源保留在悬停说明、无障碍标签和调用记录中，不占成员栏第二行。
8. 桌面左右栏从约208/224像素收窄到176/190像素；1180像素以下为168/180像素，900像素以下继续使用抽屉。

## 数据迁移

- `0008_agent_personas.sql` 将现有Agent显示身份升级为女性姓名，并把第一版职责长称分离为短岗位。
- 代码复核指出“剧情、设定、版权”等仍是领域名称，已经新增 `0009_role_titles.sql` 修正为真实职业名称；没有改写已执行迁移。
- 当前数据库的 `schema_migrations` 已记录0008和0009，Schema版本为9。
- 重复执行 `npm run migrate` 返回 `applied: []`、`currentVersion: 9`。
- 迁移只更新显示字段，没有改变 `role_key`、Agent ID、任务引用、权限、正文、记忆、模型快照或预算。

## 自动验证

| 门禁 | 命令 | 结果 |
|---|---|---|
| 目标回归 | `npm test -- --run tests/integration/experience/workspace-ui.test.tsx tests/integration/runtime/agent-team.test.ts tests/foundation/migration.test.ts tests/foundation/contracts.test.ts tests/foundation/api-health.test.ts tests/foundation/web-app.test.tsx` | 6个文件、18项测试通过 |
| 类型检查、全量测试、构建 | `npm run verify` | 通过 |
| 全量测试明细 | `vitest run` | 52个文件、99项测试通过 |
| 生产构建 | `npm run build` | API、Web、Worker通过 |
| 重复迁移 | `npm run migrate` | Schema 9，`applied: []` |
| 发布验收 | `npm run acceptance` | 3项测试通过，审计 `failures: []` |
| 差异格式 | `git diff --check` | 通过 |

## 运行与视觉验证

- `GET http://127.0.0.1:43111/health` 返回 `status=ok`、`database=ok`、Schema 9和正确 `release_id`。
- 实际工作区接口返回9名女性成员及9个新职业名称，顺序为主编、编剧、设定师、主笔、审校、体验官、文编、研究员、版权顾问。
- 桌面截图：`data/verification/agent-identities/workspace-desktop-final.png`，1600×1000。
- 窄屏截图：`data/verification/agent-identities/workspace-narrow-final.png`，500×844。
- 人工视觉检查：九名成员、头像和状态均直接可见；最长“弄玉（版权顾问）”未截断；两侧栏明显变窄；中间创作区获得主要宽度；窄屏无横向溢出。

## 备份与安全

- 数据迁移前创建备份 `backup-2026-07-16T19-50-48-876Z-4b9feb3d`。
- 备份验证返回 `verified: true`，数据库SHA-256为 `753b035ebb656eef6730c0b88f158e302c54c6662ba06eef0dd654447cf27a76`，并在隔离恢复目录完成验证。
- 没有修改、停止或重启 `D:\AI智囊团`；本次只重启文秘写作自身以加载新构建和迁移。
- 本次无付费、无API Key、无永久删除、无生产数据恢复。

## 代码复核

独立复核发现并修复三项问题：

1. 将“剧情、设定、读者、文风、考据、版权”等领域短称改成真实职业名称。
2. 九名成员全部直接显示，避免按需专家虽然存在却默认不可见。
3. 1180像素以下隐藏顶栏服务文字，只保留状态图标，防止更窄右栏在大字体模式下挤压操作按钮。

复核后无Critical或Important遗留。由于项目规则要求业务代码由当前Codex单独完成，本次采用独立本地复核，没有调用其他开发Agent。

## 回滚

- 界面和代码可通过 `git revert 28c5077` 创建可追溯反向提交。
- 已执行迁移不能被修改或从迁移账本删除；如需恢复旧显示名，应新增向前迁移。
- 若需要使用迁移前备份替换正式数据，属于生产数据恢复，必须先取得老板明确授权。

