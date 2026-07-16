# UI-20260717-03 任务中心二级页面验收记录

## 追踪信息

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- 决定：`DEC-006`
- 实施计划：`docs/superpowers/plans/2026-07-17-task-center-secondary-page.md`
- 功能提交：`b892afe feat: move budget into task center`
- 执行与复核：当前Codex单独完成，未调用其他开发Agent。

## 交付范围

1. 左栏“当前任务”标题升级为可点击的任务中心入口，继续显示当前任务数量。
2. 点击入口后，中间内容区打开“任务中心”二级页面。
3. 任务中心集中显示进行中的任务、最近任务、预算和待确认事项。
4. 左栏和任务中心的任务行均可打开原有任务详情，取消继续调用真实任务状态机。
5. 待确认事项只在任务中心出现，接受与拒绝继续调用真实确认接口。
6. 右侧栏只显示团队标题、九名成员、头像和真实状态，不再显示预算或待确认。
7. 760像素以下任务页自动改为单列；移动端右侧团队继续使用原有抽屉。

## TDD与自动验证

| 门禁 | 命令 | 结果 |
|---|---|---|
| 红灯验证 | `npm test -- --run tests/integration/experience/workspace-ui.test.tsx` | 新增契约按预期失败2项：预算仍在右栏、任务入口不存在 |
| 目标回归 | 同一体验测试命令 | 1个文件、8项测试通过 |
| 类型检查、全量测试、构建 | `npm run verify` | 通过 |
| 全量测试明细 | `vitest run` | 52个文件、100项测试通过 |
| 生产构建 | `npm run build` | API、Web、Worker通过 |
| 重复迁移 | `npm run migrate` | Schema 9，`applied: []` |
| 发布验收 | `npm run acceptance` | 3项测试通过，审计 `failures: []` |
| 差异格式 | `git diff --check` | 通过 |

## 运行与视觉验证

- `GET http://127.0.0.1:43111/health` 返回 `status=ok`、`database=ok`、Schema 9和正确 `release_id`。
- Worker接口返回 `ready`。
- 桌面截图：`data/verification/task-center/task-center-desktop.png`，1600×1000。
- 窄屏截图：`data/verification/task-center/task-center-narrow.png`，500×844。
- 桌面DOM审计：视口宽度和文档滚动宽度均为1600像素；任务中心标题、预算和待确认均位于中间页；右栏文本只包含“团队”、9名成员及状态。
- 窄屏DOM审计：视口宽度和文档滚动宽度均为500像素；任务布局为单列472像素；右栏保持隐藏抽屉状态。
- 人工视觉检查：桌面任务信息层级清晰，右栏明显更纯净；九名成员完整可见；窄屏没有截断、挤压或横向溢出。

## 故障定位与修复

全量验证首次发现 `worker-execution.test.ts` 在Windows上偶发 `EPERM`：测试向Worker发送 `SIGTERM` 后立刻关闭SQLite并删除临时目录，子进程仍可能持有文件。对照仓库内两个稳定Worker测试后，修复为等待子进程真实退出，再关闭数据库和删除目录。三项Worker进程测试和随后全量100项测试均通过。

视觉审计初次使用Chrome网络调试端口时，本机安全环境允许端口监听但阻断DevTools HTTP与WebSocket握手。最终改用Chrome本地 `--remote-debugging-pipe`，不开放调试端口，不修改系统网络设置，完成真实页面点击、DOM尺寸审计和截图。

## 安全与回滚

- 本次没有数据库迁移、API Key、付费服务、永久删除或生产数据恢复。
- 没有修改、停止或重启 `D:\AI智囊团`。
- 本次只读取并展示现有工作区聚合数据，没有写入示例预算或伪造待确认状态。
- 功能可通过 `git revert b892afe` 创建可追溯反向提交；回滚不改运行数据。

## 代码复核

- 任务、预算、确认和团队组件的职责已经分离。
- 任务取消与重大确认仍使用既有真实REST接口。
- `WorkspaceData` 和公共API未变，不需要Schema升级。
- 桌面与移动端使用同一内容语义，只改变布局。
- 复核后无Critical或Important遗留。

