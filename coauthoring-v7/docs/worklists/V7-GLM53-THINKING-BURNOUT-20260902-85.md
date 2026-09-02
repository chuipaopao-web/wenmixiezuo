# 第85批工单：GLM-5.3 思考失控导致规划成员批量失败（西施/主编/规划师全中招）

- 日期：2026-09-02
- 状态：已部署上线（生产 release `wm-v7-20260902-224500-f77079b`）
- 关联：第82批（规划治理与确定性归一）、第84批（开书确认死锁，RELEASE_ID wm-v7-20260902-203200-84a1f2c6，已上线并作为第85批回滚点）
- 作者反馈：zhengxifeng2024@163.com 无法开书；1248307030@qq.com 与管理员账号设计卷时西施失败

## 一、生产证据（只读查询，2026-09-02）

### v7_planning_generation_runs 近12次失败
- planner-deepseek-v4-pro：`规划成员引用的后台资产过多/引用了本轮未提供的后台资产`（独立问题，见第四节遗留）
- deputy-glm-5-3：链内失败信息显示西施 `火山方舟Coding Plan已执行但没有形成可提交文字（停止原因=max_tokens，内容块=2，类型=thinking,text，思考字符=44000~51000，输出Token=19000）` 或早期 `模型没有返回JSON对象`

### v7_planning_model_calls glm-5.3 按天成败
| 日期 | 成功 | 失败 | 成功率 |
|---|---:|---:|---:|
| 2026-08-31 | 35 | 12 | 75% |
| 2026-09-01 | 15 | 26 | 37% |
| 2026-09-02 | 2 | 21 | **9%** |

- 近48h glm-5.3：59 败 / 52 成；失败里 58 次为同一模式（max_tokens 截断、零可见文字），仅 1 次 429 ServerOverloaded。
- 对照：deepseek-v4-pro 140成/1败；kimi-k3 75成/2败。
- 首次截断失败：2026-08-31T02:30Z。此前（08-29）同路由实测 17 秒/799 Token 正常返回。
- 同一 run 连续 4 次重试，额度完全相同（19000）——现有重试为同预算原样重试，对此类失败必现。

## 二、根因

1. `ark-plan-model.ts` 对 GLM-5.3 结构化规划走“直出路由”（省略 thinking 字段），`max_tokens = maxOutputTokens + 1000` 固定余量（`GLM_VISIBLE_OUTPUT_REASONING_HEADROOM_TOKENS`）。
2. 2026-08-31 起方舟端点上的 GLM-5.3 行为变化：即使不发送 thinking 字段，模型也自行产出 4.4万~5.1万字符思考（约 1.8万~2万 Token），把 `maxOutputTokens + 1000` 的总额全部烧完，`stop_reason=max_tokens`，text 块为空 → 适配层判定“没有形成可提交文字”。
3. `thinking: disabled` 被端点 400 拒绝（08-18 实测）；显式 `enabled + budget_tokens` 也会被无视（08-22、08-29 实测）。
4. 网关重试使用冻结的同额度 runtime bundle，无预算升级，因此重试必然复现失败，作者页面表现为“西施设计失败”。

## 三、服务器实测（2026-09-02，探针 artifacts/deploy/wenmi-glm-probe.mjs，真实付费调用）

| 测试 | 配置 | 思考字符 | 输出Token | 耗时 | 结果 |
|---|---|---:|---:|---:|---|
| A | 直出路由 + max_tokens 40000 | 12,696 | 6,530 | 107s | ✅ end_turn，合法 JSON |
| B | 显式 thinking 16k + 40000 | 33,350 | 13,448 | 226s | ✅ 但思考多2.6倍、贵2倍 |
| C | 大资料包(约1.4万字符输入) + 直出 + 50000 | 29,362 | 15,550 | 239s | ✅ end_turn，合法 JSON |

结论：**维持直出路由（A），以“动态思考余量”加大 max_tokens 即可救活**；显式思考预算只会更差（B）。

## 四、修复方案（本批代码改动）

### 1. 动态思考余量（核心修复）
- `model-runtime-config.ts` 新增 `glmPlanningHeadroomTokens(promptChars)`：`clamp(ceil(promptChars/3), 8_000, 32_000)`。
- `thinkingTokenAllowance` 增加可选第4参 `promptChars`；GLM 直出路由命中时：传了 promptChars 用 `glmPlanningHeadroomTokens`，未传按 8_000 兜底（不再用旧的 1_000）。
- 依据：生产最坏思考≈2万 Token（5.1万字符），加上规划输出预算 19k，总额约 39k~40k；大提示词（编译后可达数万~十万字符）按 1/3 折算并封顶 32k，可覆盖；小提示词保底 8k（实测小提示词思考≈5k Token）。
- `ark-plan-model.ts`：`max_tokens = maxOutputTokens + thinkingTokenAllowance(modelId, purpose, maxOutputTokens, request.prompt.length)`——适配层与预算冻结使用同一提示词、同一公式，保证一致。
- 全部6个调用点同步传入编译后提示词长度：`v7-planning-model-gateway.ts`、`v7-opening-agent-model-gateway.ts`、`v7-creation-model-gateway.ts`、`v7-character-memory-model-gateway.ts`、`v7-book-cover-design-service.ts`、`v7-book-title-design-service.ts`（预算冻结 reservedTokens 与适配层 max_tokens 必须同源，防止额度冻结失真）。

### 2. 思考烧穿升级重试（兜底）
- `v7-planning-model-gateway.ts` 适配调用失败且错误特征为“max_tokens 截断 + 没有形成可提交文字”（`ModelAdapterError.retryable === true`）时：若会员额度允许（重新 `assertMembershipAllowsGeneration`，追加 16_000），用 `maxOutputTokens + 16_000` 升级重试一次；升级成功按正常结果落档，仍失败则记录合并后的失败信息。非技术性重试路径（technicalRetry）同样允许升级（它本来就是恢复动作）。

### 3. 测试
- 更新 `tests/foundation/ark-plan-model.test.ts`：GLM 直出用例的余量期望从 1_000 改为按公式（小提示词→8_000）。
- 新增：`glmPlanningHeadroomTokens` 边界（下限8k、上限32k、按1/3折算）；大提示词（约9万字符）下适配层 max_tokens = maxOutputTokens + 32_000。

## 五、明确不做（本批）
- **不换模型**：西施等 glm-5.3 岗位保留模型身份（老板决策方向）；实测证明调余量即可救活。
- **不改直出路由为显式思考**：实测 B 证明显式预算更差。
- 遗留（后续批次）：planner-deepseek-v4-pro 的“引用后台资产过多/未提供资产”校验失败（另一种失败类别，量少，单独处理）；作者侧“多成员并行候选、单成员失败不阻塞”（GPT 建议的大架构改造，与证据卡层合并为第86批设计议题）；按天模型健康分后台视图（数据已在 v7_planning_model_calls，仅缺展示）。

## 六、验收
1. 全量相关测试通过（含新增余量/升级重试用例）。
2. 部署后生产上 glm-5.3 规划调用成功率回升（观察 /health 与 v7_planning_model_calls 按天成功率，预期回到 75%+）。
3. 作者重试“设计卷”不再稳定复现“西施设计失败”。

## 七、部署回填（2026-09-02 第85批）

- 部署结果：`DEPLOYMENT_PASSED`
- 线上发布号：`wm-v7-20260902-224500-f77079b`
- GLM 修复实现提交：`f77079b`
- 发布元数据提交：`f57bd97`
- 实际部署源码提交：`12e1522`（仅追加 `RELEASE_ID` 尾部 7 位短 SHA 兼容；业务修复仍来自 `f77079b`）
- 源码包：`artifacts/deploy/12e1522-source.tar.gz`
- 源码包 SHA-256：`51ec538d2b25e668afe429cc2ed5373c8295d03de1877fe87d3903e5c767a984`
- 应用路径：`/opt/wenmi-releases/wm-v7-20260902-224500-f77079b/source/apps`
- 静态路径：`/opt/wenmi/releases/versions/363e8b5c7989d05e8fba`
- 静态切换：`static_switch_required=0`
- 数据库迁移：106 个，无新迁移
- 备份：`/opt/wenmi/data/backups/daily/20260902T151204Z-438739`
- 回滚应用保留点：`wm-v7-20260902-203200-84a1f2c6`
- 切换窗口：`switch_started_at=2026-09-02T15:19:07+00:00`
- 完成时间：`completed_at=2026-09-02T15:19:12Z`
- 线上验证：生产本机 `/health` 与公网 `https://wenmixiezuo.com/health` 均返回 `releaseId=wm-v7-20260902-224500-f77079b`、`status=ok`、`worker=ready`、`canStartModelTasks=true`；作者端首页 HTTP 200，独立后台 `/v7/` HTTP 200；API、Worker、Caddy 均为 `active`。
- 失败说明：本批前两次部署均在 cutover 前失败，线上未切换。第一次为部署脚本继承第84批 8 位发布号尾缀门禁；第二次为应用 `readReleaseId` 同样只允许 8 位尾缀。第85指定发布号使用 7 位短 SHA `f77079b`，因此补充最小兼容为 7-8 位尾缀后重打包部署成功。
- 数据安全：prune 仅删除前次失败留下的第85半成品发布目录，未触碰作者数据、数据库、备份、迁移或回滚版本。
