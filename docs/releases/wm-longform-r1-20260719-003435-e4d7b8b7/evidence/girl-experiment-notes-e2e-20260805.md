# 《少女的实验笔记》续写反向规划验收证据

- release_id：`wm-longform-r1-20260719-003435-e4d7b8b7`
- design_review_id：`DR-20260805-girl-experiment-notes-e2e-v1`
- 验证日期：2026-08-05
- 数据边界：保留且只保留一本可见测试书，不删除本次验证形成的正文、反向分析和设定讨论结果。

## 真实运行结果

- 书名：`少女的实验笔记`
- book_id：`4d348004-ed3e-4aac-8cf6-6473bc82957b`
- 开书任务：`354ee7e0-3490-4e55-8e82-757030eb4e83`
- 已有正文导入：`6d84ad13-ed0e-4ed3-9b0d-1208c613c912`
- 输入正文：约20000字，识别为9章；前端章节接口可见9章。
- 反向分析任务：`3917ecaa-ebd7-4048-90cf-3d23735efe0d`，9/9章完成模型分析。
- 设定项“策划理念”形成三份互相独立的真实模型方案：Kimi K3、DeepSeek V4 Pro、GLM 5.2。
- 作者选定后由主编综合，综合任务 `cffc77ae-90a4-4c46-b651-7cabb59336ca` 成功；确认结果已保存。
- 下一设定项“读者承诺与核心体验”已自动启动，任务 `ebd68039-f5f5-43f9-a85a-6c7c61b43db5` 成功，当前状态为“讨论中”。
- 运行态复核：API `ready`、Worker `ready`、`canStartModelTasks=true`；书架只有上述一本书。

机器可读运行证据位于本地数据目录：

- `data/verification/girl-experiment-notes-e2e/final-evidence.json`
- `data/verification/girl-experiment-notes-e2e/run-events.ndjson`
- `data/verification/girl-experiment-notes-e2e/state.json`

上述运行证据包含任务和模型结果摘要，不包含API Key；`data/` 按仓库规则不进入Git。可复现入口为：

- `scripts/evaluation/run-girl-experiment-notes-e2e.mjs`
- `tests/fixtures/girl-experiment-notes-20000.txt`

## 工程门禁

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全仓类型检查 | `npm.cmd run typecheck` | API、Web、Worker、Tests全部通过 |
| 全量自动测试 | `npm.cmd run test` | 140个测试文件、592项测试通过 |
| 全仓构建 | `npm.cmd run build` | API、Web、Worker通过；仅有Vite包体积提示 |
| 生产数据迁移 | `npm.cmd run migrate` | 当前schema版本35，无待执行迁移 |
| 恢复验证 | `npm.cmd run verify:backup` | 生产库完整性与外键检查通过；隔离恢复副本检查通过并丢弃 |
| 专项验收/恢复/隔离/UI | `npx.cmd vitest run tests/acceptance tests/contract/repository-isolation.test.ts tests/fault-injection tests/integration/data-safety/backup-restore.test.ts tests/integration/experience/workspace-ui.test.tsx` | 14个测试文件、65项测试通过 |
| 运行态健康 | `/health`、`/api/v1/runtime/readiness` | release_id正确；API与Worker就绪 |

恢复验证生成的备份编号为 `backup-2026-08-05T04-40-20-700Z-17afd198`；验证只在隔离恢复副本上执行，没有覆盖生产数据。

## 缺陷与修复

真实主编综合最初在模型调用前被上下文预算拒绝：设定讨论把与当前任务无关的续写基线和过长方案同时列为硬上下文，所需5361字符超过4500字符预算。修复后：

- 设定方案汇总不再注入续写基线；
- 老板原话、开书定位、已确认设定和三份候选分别采用有界压缩；
- 保留三份方案的核心创意、理由、风险和可组合部分；
- 添加超长三方案回归测试，防止再次在模型调用前失败。

修复后同一本书从持久化检查点继续，没有重复导入正文、重复创建书籍或重复调用已经成功的成员。

## 证据边界

当前证据可证明：真实套餐模型参与的“已有正文导入—逐章反向分析—三模型独立设定建议—主编综合—作者确认—自动推进下一项”链路可运行、可恢复并在前端数据源可见。它不外推为任意长篇题材的文学质量保证；跨阶段长期质量仍需按E3/E4纵向盲评门禁持续验证。
