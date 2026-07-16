# UI-20260717-01 工作台界面重设计验收记录

## 追踪信息

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- 决定：`DEC-004`
- 实施计划：`docs/superpowers/plans/2026-07-17-workspace-ui-redesign.md`
- 功能提交：`81b61f2 feat: redesign content-first writing workspace`
- 执行与复核：当前Codex单独完成；未调用其他开发Agent。

## 交付范围

1. 默认浅绿、米白、雾蓝、夜间四套工作台底色。
2. 小、标准、大、特大四档字体，本机持久化并可恢复默认。
3. 桌面栏宽调整为约 `208px / 自适应中栏 / 224px`，1180像素以下进一步收紧；900像素以下进入左右抽屉。
4. 九岗位使用从智囊团只读复制的九宫格原型头像；运行时只读取文秘写作自己的 `/avatars/team-collage-source.jpg`。
5. 当前任务迁到左栏，显示章节、类型、阶段和状态；详情显示任务目标、执行岗位、检查点、尝试次数和任务ID。
6. 取消按钮调用 `/api/v1/books/{bookId}/tasks/{taskId}/cancel`，完成后刷新真实工作区。
7. 工作区任务响应新增数据库已有的 `chapterId`、`brief`、`checkpoint` 和 `cancelRequested`，未新增或改写迁移。

## 自动验证

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型检查、全量测试、构建 | `npm run verify` | 通过 |
| 全量测试明细 | `vitest run` | 52个文件、98项测试全部通过 |
| UI/API目标回归 | `npm test -- --run tests/integration/experience/workspace-ui.test.tsx tests/integration/experience/workspace-api.test.ts` | 2个文件、9项测试全部通过 |
| 数据库迁移 | `npm run migrate` | Schema 7，`applied: []` |
| 发布验收 | `npm run acceptance` | 3项测试通过，审计 `failures: []` |
| 差异格式 | `git diff --check` | 通过 |

发布审计同时确认：阶段0至8验收包存在、无AI智囊团运行时依赖、无疑似硬编码密钥、无未说明代码占位、运行数据不入Git、桌面入口与使用说明存在。

## 运行与视觉验证

- 生产构建由Vite成功生成，API、Worker和Web通过 `scripts/start.mjs` 独立运行。
- 健康检查：`GET http://127.0.0.1:43111/health` 返回 `status=ok` 和本 `release_id`。
- 实际工作区只读检查返回9个岗位；服务只监听 `127.0.0.1:43110/43111`。
- 桌面截图：`data/verification/ui-redesign/workspace-desktop-final.png`，1600×1000。
- 窄屏截图：`data/verification/ui-redesign/workspace-narrow.png`，500×844。
- 人工检查通过：两侧栏明显压窄，中间对话区占主要宽度，九岗位头像可辨认，设置和团队入口在窄屏顶栏可见，聊天与输入区无横向溢出。

截图与运行日志位于被Git忽略的运行证据目录，避免把浏览器配置、日志和本机数据纳入版本库。

## 资产独立性与安全

- 智囊团源头像与文秘写作副本的SHA-256一致；只发生读取和复制。
- 没有修改、停止或重启 `D:\AI智囊团`，也没有在代码中保存该路径。
- 文秘写作运行时不依赖智囊团文件夹。
- 本次无真实API Key、无费用、无永久删除、无生产数据恢复。

## 代码复核

提交前独立复核发现并修复两项重要边界：

1. 任务详情改为根据 `taskId` 从每次轮询后的工作区重新派生，避免任务完成后详情仍显示旧的可取消状态。
2. 主题和字体单选项为键盘焦点增加可见外框，避免隐藏原生单选控件后丢失焦点反馈。

复核结论：无Critical或Important遗留；实现符合DEC-004和任务计划，可合入主分支。

## 回滚

如需回退，使用 `git revert 81b61f2` 创建可追溯反向提交。此次没有数据库迁移和运行数据转换，回滚不会删除书籍、正文、任务或设置以外的浏览器本机偏好。
