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

## 问题二（待服务器诊断定性）：分卷规划西施稳定失败

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

## 验收标准

1. 问题一测试 4 项通过，apps/api 类型检查 0 错误。
2. 受影响账号在部署后原样点"确认开书资料，创建书籍"能成功建书。
3. 问题二有服务器证据定性，处置方案记入本工单附录。

## 遗留

- 第82批 libraryRefs 修复已上线；第83批审计+磁盘卫生脚本待服务器执行。
- 证据卡层另行开批。
