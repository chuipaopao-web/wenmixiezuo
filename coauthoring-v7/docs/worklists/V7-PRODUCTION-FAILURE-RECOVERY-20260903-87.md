# V7 第87批工单：生产故障热修——结果未知死锁、西施思考烧穿、开书意外失败悬挂

- 日期：2026-09-03
- 触发：真实作者生产故障两例——`1746495718@qq.com` 卷规划"西施"席位反复失败；`2521623943@qq.com` 全书方向确认后"生成正式框架树"无法推进。老板要求同时全面检查开书→设定→规划→卷→链→章→正文→结算的失败处理。
- 手段：三路只读代码审计（西施失败链路 / 方向卡死链路 / 开书设定与章纲正文结算），加服务器只读诊断脚本 `scripts/ops/diagnose-account-failures.ts`（交 codex 上生产执行拿真实数据回填定性）。

## 一、确认并修复的缺陷（4 处代码 + 2 处 UI）

### 修复① 创作模型网关缺 GLM-5.3 思考烧穿升级重试（西施失败主因）

- 位置：`apps/api/src/infrastructure/models/v7-creation-model-gateway.ts`
- 现状：第85批只给规划网关（`v7-planning-model-gateway.ts`）加了"max_tokens+无可提交文字"识别后 +16k 升级重试一次；创作网关（资料策划/卷方案/章纲/正文/结算全部调用）漏配。生产数据（第84批部署后只读 SQL）：`glm-5.3/coding` 近48小时成功52失败59，失败集中在思考烧穿。西施（deputy-glm-5-3，context_editor 席）恰好只走创作网关，因此"总是失败"；同底座的规划席（幼薇）第85批后已恢复。
- 修复：与规划网关同源——`isThinkingBurnFailure`（`ModelAdapterError` + `retryable` + 消息含 `max_tokens` 与 `没有形成可提交文字`）命中后先复核会员额度（不足则保留原始失败，不静默透支），再用 `maxOutputTokens + 16_000` 重试一次；重试仍失败则消息追加"已用加大额度重试一次，仍未形成可提交文字"后按原结果未知语义落档。
- 测试：`tests/integration/domain/v7-creation-pipeline.test.ts` 新增"创作任务思考烧穿时用加大额度升级重试一次，重试仍烧穿则明确失败"（覆盖重试成功与重试仍失败两分支，断言两次调用预算 `[1000, 17000]` 与落档状态）。

### 修复② 结果未知的规划树任务永久死锁（2521623943 卡死主因）

- 链路定性（代码层）：规划树任务一旦落 `unknown`（结果未知：进程重启、调用中断超过16分钟活跃窗口等）：
  1. `continueRouteToTree`（`v7-planning-tree-generation-service.ts:169-175`）对 unknown 只复用不替代；
  2. `retry` 明确拒绝 unknown（防重复扣量，正确）；
  3. `cancelGeneration` 的 WHERE 只有 `queued/working`，unknown 点停止是空操作；
  4. 作者端时光机 `result_unknown` 恢复面板只有"核对这次结果"（重新拉取），无任何逃生口。
  四条路全封死 = 作者永久卡在"全书方向已经确认"。
- 修复：
  - `apps/api/src/infrastructure/db/repositories/v7-planning-runtime-repository.ts` `cancelGeneration` 放行 `unknown`（作者明确决定的停止；迟到成功只被丢弃，不产生新的模型消耗）。停止后视图按既有约定呈现 `failed`，"继续未完成步骤"或再次"生成正式框架树"会经 `createReplacement` 幂等创建当前形状替代任务。
  - `coauthoring-v7/author-app/src/TimeMachinePage.tsx` `PlanningRecovery` 增加可选 `onStop`；`result_unknown` 面板新增"停止这次任务，重新开始"按钮。
- 幂等不破坏：替代任务 recoveryKey 由 sourceRunId+快照+配方+路线哈希决定，重复续接不重复创建；原任务模型调用记录原样保留审计。
- 测试：`tests/integration/domain/v7-planning-editorial-runtime.test.ts` 新增"结果未知的规划树任务可由作者停止，再续接成全新替代任务"（unknown → 停止 → DB `cancelled` → 续接得到新 runId → ready → 原任务调用数不变）。

### 修复③ 开书任务 `interrupted` 遇非预期错误永久悬挂

- 位置：`apps/api/src/infrastructure/db/repositories/v7-opening-agent-repository.ts` `markUnexpectedFailure`。
- 现状：`claim` 接受 `interrupted`（恢复执行），但 `markUnexpectedFailure` 的 WHERE 只有 `queued/working`——恢复执行途中一旦抛非预期异常（如内部状态损坏），任务永远停在"连接结果未知"，既不运行也不失败。
- 修复：WHERE 纳入 `interrupted`，恢复失败也落到明确 `failed`（`internal_failure`）。
- 修复③b（UI）：`coauthoring-v7/author-app/src/NewNovelPage.tsx` interrupted 恢复面板补"重新连接这次任务"按钮（GET 会触发引擎调和；此前只能整页刷新碰运气）。
- 测试：`tests/integration/domain/v7-opening-agent-platform.test.ts` 新增"恢复执行遇到非预期错误时，interrupted 任务也落到明确失败而不是永远悬挂"。

### 审计确认健壮、不需改动的点

- 开书确认对称性（第84批 `openingPackageUnchanged`）、设定编辑部租约/重试事务、会员门禁四类错误分类、历史任务冻结名册隔离、结算幂等、unknown 冻结防重复扣量、字符预算四级降级。
- 规划网关 `start()` 吞 `V7PlanningModelCallInProgressError` 是跨实例交接语义（16分钟活跃窗口内另一实例确在执行；超时后经 `reuseModelCall` 归档为 unknown），配合修复②后有逃生口，不再改。

## 二、审计发现、暂不修复、留后续批次（按嫌疑度）

1. 【中高】正文写作（`novel_writer` purpose）的 GLM-5.3 固定 16k 显式思考，不在 `usesGlmVisibleOutputRoute` 动态余量覆盖内；默认主笔司马相如（deepseek）不受影响，作者手选曹雪芹（glm-5.3）时有烧穿风险。修复①的 +16k 重试已部分兜底（max_tokens 截断场景），完整的直出路由改造留后续批次。
2. 【中】设定编辑部 `result_unknown` 无调和机制：retry/restart 均拒绝，只能整批重做或逐条重新设计（已成功席位保留）。需要设计"作者确认后安全续跑"的调和路径，单独立项。
3. 【中】结算 unknown 后 `retryFailed` 无法换成员绕过（幂等键含成员 key，unknown 调用永久占位）；正文有 `acknowledgedUnknownRequestId` 机制而结算没有。
4. 【中低】章纲/正文 context 超预算后原样重试必现失败，没有减源/降详情的自适应重试闭环。
5. 【低】任务中心 `item_redesign` 的 `restartable` 硬编码 false；`attemptMarker` 全局计数在多次补做时递增（不直接致败）；开书 revise 幂等键在主编出新版后旧 key 报 409（前端需换 key，待确认前端行为）；`assertCleanManuscript` 含"章纲要求"字样的误杀概率极低。

## 三、服务器诊断脚本（交 codex）

`scripts/ops/diagnose-account-failures.ts`（只读，纯 SELECT/PRAGMA）：按邮箱输出 routeRuns、treeGenerationRuns、creationWorkflows、失败 contextPacks、失败/最近模型调用（含成员显示名与 error_detail）、最近任务账本、西施相关调用。生产执行：

```
sudo -u wenmi /usr/bin/node node_modules/tsx/dist/cli.mjs scripts/ops/diagnose-account-failures.ts \
  1746495718@qq.com 2521623943@qq.com
```

预期：为两个账号的生产实况回填证据（西施调用 error_class 分布、卡死任务的 generation_run 状态），验证修复①②与线上故障的对应关系；若出现本工单未覆盖的形态（如历史损坏链），另开工单。

## 四、测试证据（本地）

- 三个目标集成文件全绿：`v7-planning-editorial-runtime.test.ts` 17 项（含新增）、`v7-creation-pipeline.test.ts`（含新增）、`v7-opening-agent-platform.test.ts` 19 项（含新增）。
- 六工作区类型检查 0 错误；全量门禁（根 vitest 全套 + backend + author-app + admin-console）见提交记录。
