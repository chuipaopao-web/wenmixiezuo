# 工单：开书确认死锁修复与分卷规划西施失败诊断（2026-09-02 第84批）

## 问题一（已定位，本批修复）：确认开书被"页面内容已经修改，请先提交主编复审"永久卡死

账号 `zhengxifeng2024@163.com` 无法开书。现象：资料页主编审查已通过（verdict=pass），作者端按钮显示"确认开书资料，创建书籍"（客户端 dirty=false，即页面内容与作者端视图完全一致），点击后服务端 409"页面内容已经修改，请先提交主编复审"，且永远无法通过。

### 根因（代码级，已核实）

`apps/api/src/application/books/v7-opening-book-service.ts:126` 用哈希比较"存储候选 vs 本次提交"：

```ts
openingPackageHash(candidate.content) !== openingPackageHash(submittedPackage)
```

两边不对称：

- 提交侧经过 `validateV7OpeningPackage` → `parseOpeningPackage`（backend opening-output-validation.ts），按固定形状**重建**对象：空 `authorInstructions` 直接省略键、`authorNotes` 恒为 `[]`、主角 `goal/dilemma/boundary` 恒为 `''`；
- 存储候选侧是 `revise()` 直接落库的**作者修订稿**（`validateV7OpeningRevisionDraft` 输出）：`authorInstructions` 恒有键（可能为 `[]`）、保留 `authorNotes` 和作者填写的 `goal/dilemma/boundary`、末尾附 `revisionDirective`。

关键触发路径：作者在审查面板点"采纳全部建议"且未触发模型重做时（`requiresModelRevision=false`，走 `package_re_review`），`revise()` 把作者修订稿直接存为 active 候选；复审通过后作者原样确认 → 哈希**永远**不一致 → 死锁。作者端 dirty=false（视图=候选去 revisionDirective），所以界面不给复审入口，彻底卡死。

### 修复

把"是否修改"的语义改为：**两侧经过同一个纯投影函数后做键序无关的稳定比较**。候选侧不再重新过严格 parse（修订稿可能合法地不满足设计期最小约束，重 parse 会误抛），只剥离内部字段（`revisionDirective`），剩余作者可见内容做排序键 JSON 比较：

- `v7-opening-package-contract.ts`：删除 `openingPackageHash`，新增 `openingPackageUnchanged(stored, submitted)`（内部 `stableJson` 递归排序对象键、过滤 `undefined`）。
- `v7-opening-book-service.ts`：确认检查改用 `!openingPackageUnchanged(candidate.content, submittedPackage)`。

行为变化：作者原样确认（任何候选形态）→ 通过；真实改动任何作者可见字段 → 仍 409（语义比旧版更准确，旧版键序差异也会误报）。书名/看点等真实编辑仍被拦截。

### 测试

`tests/integration/domain/v7-opening-confirm-consistency.test.ts`：

1. 候选含 `revisionDirective` + `authorInstructions: []` + 作者填写 `authorNotes/goal/boundary`，提交=作者端视图副本 → `unchanged=true`（生产死锁回归）。
2. 同内容不同键序 → `unchanged=true`。
3. 书名被改 → `unchanged=false`。
4. `undefined` 值与缺键等价 → `unchanged=true`。

## 问题二（已服务器诊断定性）：分卷规划西施稳定失败

账号 `1248307030@qq.com` 与管理员账号设计卷时，成员 西施（`deputy-glm-5-3`，glm-5.3 / volcengine-ark-coding-plan）失败，任务整体失败；妙玉（deepseek）、谢临川（kimi-k3 agent）显示已完成。多账号复现=系统性，非用户数据问题。第82批已于 18:04 CST 上线，需确认失败任务是否发生在新代码上。

### codex 服务器诊断步骤（只读）

```bash
DB=/opt/wenmi/data/database/wenmi.sqlite

# 1. 最近失败的规划任务（含成员快照与错误消息）
sqlite3 -header "$DB" "SELECT generation_run_id, owner_id, tree_kind, scope_id, status,
  assigned_member_key, error_message, created_at, updated_at
  FROM v7_planning_generation_runs WHERE status='failed'
  ORDER BY updated_at DESC LIMIT 15;"

# 2. 对上述 run_id，看每次模型调用的真实失败原因
sqlite3 -header "$DB" "SELECT member_key, provider, model_id, plan, state,
  substr(COALESCE(failure_message,''),1,300) AS failure, started_at, completed_at
  FROM v7_planning_model_calls WHERE run_id IN (<上一步的run_id列表>)
  ORDER BY started_at;"

# 3. 专看 glm-5.3 coding 通道最近是否整体异常（对照 deepseek/kimi 成功率）
sqlite3 -header "$DB" "SELECT model_id, plan, state, COUNT(*) AS n
  FROM v7_planning_model_calls WHERE started_at > datetime('now','-48 hours')
  GROUP BY model_id, plan, state ORDER BY model_id, state;"

# 4. 若 failure_message 显示 HTTP/配额错误，记录原文；若是解析失败，
#    取一条 output_text 前若干字节看 glm-5.3 返回了什么形态
sqlite3 "$DB" "SELECT substr(output_text,1,600) FROM v7_planning_model_calls
  WHERE model_id='glm-5.3' AND state!='succeeded' AND output_text IS NOT NULL
  ORDER BY updated_at DESC LIMIT 3;"
```

### 判读

- 若 glm-5.3 通道集中 HTTP/4xx/5xx/配额错误 → 供应商通道问题（其余成员 success、glm 失败即证据），处理：调整绑定或联系方舟，不建议改代码。
- 若 glm-5.3 调用 success 但下游解析/校验失败（failure 在非模型层）→ 把 failure_message 与 output_text 取回，按第82批同类方法做确定性归一或修复合同。
- 若失败发生在第82批部署前的旧任务快照上 → 让作者点"继续未完成步骤"用新代码重试后再看。

### 部署后服务器诊断回填（已执行）

执行时间：第84批部署成功后，直接查询生产库 `/opt/wenmi/data/database/wenmi.sqlite`，只读查询，未改写作者数据、书籍、任务或模型调用记录。

关键证据：

- 第84批实际线上发布为 `wm-v7-20260902-203200-84a1f2c6`；部署结果 `DEPLOYMENT_PASSED`，`backup_run_id=20260902T133852Z-429407`，`completed_at=2026-09-02T13:41:38Z`。`/health` 已返回 `status=ok`、`worker=ready`、`canStartModelTasks=true`、`releaseId=wm-v7-20260902-203200-84a1f2c6`。
- 本批首次按提交 `1fd45d7` 部署时在远端门禁阶段失败，原因是 `tsconfig.tests` 对新增测试的泛型类型推断报错；线上未切换。随后只修复测试辅助函数类型，提交 `3fcaa03`，保持同一 `RELEASE_ID` 重新打包部署成功。
- 账号 `1248307030@qq.com` 的同书最新规划运行 `e3637679-22b0-4fa4-a875-fbd010bf303e` 为 `succeeded`，更新时间 `2026-09-01T23:32:31.054Z`。该账号之前的失败运行集中在 `2026-08-31` 至 `2026-09-01`，错误包括“上层规划已经更新”和“西施：模型没有返回JSON对象”，均早于第82批上线时间 `2026-09-02T10:04:37Z`。
- 管理员账号 `595341366@qq.com` 最近查询到的规划运行 `0f697924-9490-4105-a433-7c601bda359c` 为 `succeeded`，创建于 `2026-09-01T23:45:49.337Z`，更新时间 `2026-09-01T23:49:32.451Z`。
- 第82批上线后（`updated_at >= 2026-09-02T10:04:37Z`）生产库没有新的 `v7_planning_generation_runs.status='failed'` 规划失败记录。
- 近48小时模型调用统计：`deepseek-v4-pro/coding` 成功 140、失败 1；`kimi-k3/agent` 成功 75、失败 2；`glm-5.3/coding` 成功 52、失败 59。GLM 通道不是完全不可用，但稳定性明显低于 DeepSeek 与 Kimi。
- GLM 失败主因集中为火山方舟 Coding Plan 已执行但没有形成可提交文字，停止原因多为 `max_tokens`，内容块类型为 `thinking,text`，思考字符常见 4万至5万字，输出 Token 3500 或 19000；另有一次 `ServerOverloaded` 429。`glm-5.3` 非成功调用未保存可用 `output_text` 前缀，说明失败时没有形成可解析正文 JSON。

定性结论：

- `1248307030@qq.com` 与管理员账号的“西施失败”不是第84批新增问题，也不是作者数据损坏；主要是第82批之前的历史任务快照和 GLM 规划通道稳定性问题。
- “模型没有返回 JSON 对象”的直接原因不是解析器单独坏掉，而是 GLM 在规划大任务中大量预算耗在思考块上，触发 `max_tokens` 后没有形成可提交文本。
- 短期处置：不要把 `glm-5.3 / volcengine-ark-coding-plan` 作为规划关键路径的必成席位；失败时应保留其他成功成员候选，允许失败席位单独重试或自动切到更稳模型。
- 中期处置：配合证据卡、资料策划 Agent、ContextPack 瘦身和规划任务粒度拆分，降低 GLM 进入长思考/空输出的概率。

## 部署证据

- 线上版本：`RELEASE_ID=wm-v7-20260902-203200-84a1f2c6`
- 实际部署源码提交：`3fcaa03`（在 `1fd45d7` 基础上仅补测试类型修复）
- 源码包：`artifacts/deploy/3fcaa03-source.tar.gz`
- 源码包 SHA-256：`4b30854a51e4a2d74d54bf334461c6cda13f16fd95fe91e7df863d566eeb9a6c`
- 应用路径：`/opt/wenmi-releases/wm-v7-20260902-203200-84a1f2c6/source/apps`
- 静态路径：`/opt/wenmi/releases/versions/363e8b5c7989d05e8fba`（本批未切换静态）
- 备份：`/opt/wenmi/data/backups/daily/20260902T133852Z-429407`
- 回滚应用保留点：`wm-v7-20260902-174800-e5b21c74`
- 服务验证：API、Worker、Caddy 均为 `active`；公网作者端与独立后台均返回 HTTP 200。

## 验收标准

1. 问题一测试通过：新增确认一致性测试 5/5，本地 `tsconfig.tests` 类型检查 0 错误；远端发布门禁通过后才切换。
2. 第84批已部署上线，公网 `/health`、作者端、独立后台和服务状态验证通过。
3. 问题二已用生产 SQL 完成服务器证据定性，处置方案已记入本工单。

## 遗留

- 第82批 libraryRefs 修复已上线；第84批开书确认死锁修复已上线。
- 规划成员 GLM 失败率偏高，需要后续在模型路由、失败降级、资料包瘦身和任务粒度拆分中继续处理；本批只做只读诊断，不改模型绑定。
- 证据卡层另行开批。
