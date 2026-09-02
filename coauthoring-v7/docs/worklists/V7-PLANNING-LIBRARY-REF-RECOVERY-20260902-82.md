# 工单：规划后台资产引用门禁整类硬化失败恢复（2026-09-02 第82批）

## 背景与现象

第81批上线后，真实作者（`1746495718@qq.com`、`wanzidoufutang@163.com`）在时光机设计全书框架时仍失败，报错“规划成员引用了本轮未提供的后台资产”。任务已运行 127 分钟（成员“红玉”），最终整树失败，只能“继续未完成步骤”重跑。

## 根因

`coauthoring-v7/backend/planning-trees/planning-tree-agent-runtime.ts` 的 `validateDesignStrategy` 对 `designStrategy.libraryRefs` 做三类硬失败：

1. 引用了本轮候选包之外的 `assetType:key`（第110行）；
2. 重复引用同一资产（第111行）;
3. 超出 `libraryUseLimit`（第99行）与 `applicationNote` 为空（第112行）。

失败链条：生成提示词中 `服务端冻结资料` 含已确认上层规划 JSON（其中带上一层自己的 `designStrategy.libraryRefs`），模型按上层方向设计时顺手把这些 key 抄进本轮输出；而本轮候选包由资料策划重新召回，不含上层的 key。结构修复重试（temperature 0.22）看到的仍是同一份冻结资料，照样重复引用；后备成员逐个同样失败 → 整树失败。

而产品合同本身声明资产只是“少量候选，可以为 0”（提示词第48行、候选包 `instruction`），引用记录是簿记字段而非剧情内容——为簿记字段硬失败整棵树与合同自相矛盾。

## 修复方向（确定性归一，不调用模型、不截断剧情）

在 `validateDesignStrategy` 中把四类硬失败改为确定性归一（与 `normalizeNodeFormats` 同一原则：只消除簿记等价差异，不判断剧情）：

- `libraryRefs` 缺失或非数组 → 视为 `[]`（合同允许为 0）。
- `assetType` 漂移（如写错类型名但 key 正确）→ 按候选包内 key 唯一匹配归一。
- 候选包外的引用 → 直接丢弃（不改剧情、不补写说明）。
- 重复引用 → 保留首次。
- 超过 `libraryUseLimit` → 保留前 N 项。
- `applicationNote` 缺失 → 丢弃该引用。

保留硬失败的只有结构性问题：`designStrategy` 整体缺失、`originalStrategies` 不在 1–6 项、`decisionNote` 缺失——这些是创意核心承诺，修复重试可以纠正。

## 验收标准

1. 候选包外引用、重复、超限、类型漂移的输出都能通过解析并保存候选，剧情内容不被改写。
2. `originalStrategies` 1–6 与 `decisionNote` 的既有约束不变。
3. `planning-layer-reference-pack.test.ts` 覆盖以上各形态；既有规划集成测试全绿。
4. backend 重建 dist 后 apps/api、apps/worker 类型检查通过。

## 实现记录

- `planning-tree-agent-runtime.ts` `validateDesignStrategy`：`libraryRefs` 缺失/非数组视为零引用；按复合键匹配候选卡，类型名漂移但 key 唯一时归一到候选卡的真实类型；候选包外引用、缺 `applicationNote`、重复引用均确定性丢弃；超过 `libraryUseLimit` 保留原始顺序前 N 项。保留硬失败的仅剩 `designStrategy` 缺失、`originalStrategies` 不在 1–6、`decisionNote` 缺失。
- 生成提示词第48行同步声明"冻结资料中上层规划的引用会被直接忽略"，降低模型照抄概率。
- 结构修复重试（repair prompt）与后备成员循环保持不变，继续兜底真正的结构错误。

## 测试证据

- `planning-layer-reference-pack.test.ts` 10/10 通过（新增：未知引用丢弃剧情不变、缺失/非数组视为零引用、类型漂移按 key 归一、去重+超限截断+缺说明丢弃）。
- `tests/integration/domain/v7-planning-editorial-runtime.test.ts` + `v7-setting-editorial-department.test.ts` 49/49 通过。
- `tests/integration/domain/v7-planning-source-snapshots.test.ts` + `tests/unit/v7-creation-context-compiler.test.ts` 19/19 通过（第81批回归无回退）。
- backend `tsc -p tsconfig.json` 构建 dist 通过；apps/api 与 apps/worker `tsc --noEmit` 均 0 错误。

## 遗留设计项（另行开批）

- 资料策划"证据卡层"：把长文式任务说明升级为带来源短卡（人物事实卡/世界观卡/伏笔卡/责任卡），任务输入层按卡装配；超预算时优先裁解释、不裁硬事实；生成后对证据卡做回校。当前快照预算（全书18k/卷14k/链10k字）与三级降级继续有效，证据卡层是增量演进而非推翻。
