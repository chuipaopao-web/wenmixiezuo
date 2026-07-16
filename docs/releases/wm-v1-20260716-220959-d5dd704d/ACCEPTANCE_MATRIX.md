# 首版最终验收覆盖矩阵

- `release_id`：`wm-v1-20260716-220959-d5dd704d`
- 实现提交：`fdfcb8a`
- 判定依据：`docs/ACCEPTANCE.md`
- 结果：全部条目具有实现、自动测试或本地运行证据；无未说明跳过项，无未解决 blocker/major。

## 1—3 完成定义、基础工程、数据迁移

| 验收项 | 证据 | 结果 |
|---|---|---|
| 24条共识与后续决定映射 | `docs/COVERAGE_MATRIX.md`、阶段0—8验收包 | 通过 |
| 类型、全测、构建、运行 | `npm run verify`；桌面实机启动 | 52文件/96测试、三应用构建、Web/API/Worker就绪 |
| 统一启动且只监听回环 | `start-desktop.ps1`、`runtime-config.test.ts`、实机端口检查 | `127.0.0.1:43110/43111` |
| 与AI智囊团独立 | 发布审计扫描运行时代码；未读取、停止、重启或修改项目外服务 | 通过 |
| 版本锁定与本地Git边界 | `package-lock.json`、Schema 7、release_id、`RELEASE.md`、本地main | 通过，未配置远程 |
| 空库、重复、升级、失败回滚、迁移防篡改 | `migration.test.ts`及阶段2/3/4/5/6升级测试；生产迁移重复执行 | Schema 7，重复执行 `applied:[]` |
| Repository自动隔离 | `repository-isolation.test.ts` | 错owner/book均不可读 |
| 原子9岗位建书 | `positioning-onboarding.test.ts`、`api-flow.test.ts` | 成功9个；注入失败零残留 |
| 两书全域零串线 | `release-journey.test.ts`、Repository/FTS/IndexedDB测试 | 消息、正文、知识、任务、记忆、缓存、预算、租约隔离 |
| 正文指针/文件/哈希一致 | `promotion-recovery.test.ts`、`release-journey.test.ts` | 双向校验通过 |
| FTS和图谱可重建 | `memory-retrieval.test.ts`、`projections-research.test.ts` | 按书重建且不改正文/正史 |

## 4—5 Agent、任务与双主编

| 验收项 | 证据 | 结果 |
|---|---|---|
| 9岗位身份、来源、范围、权限、记忆和状态 | `agent-team.test.ts`、`workspace-ui.test.tsx` | 5核心+4专家，真实provider/model显示 |
| 专家按需激活并收口 | `discussion-runtime.test.ts` | 命中读者专家，任务后回到standby |
| 同模型不冒充独立复核 | `agent-team.test.ts`、`writer-selection.test.ts` | 共同来源如实显示；独立审校强制不同provider/model |
| 状态由任务/心跳/调用驱动 | `presence-events.test.ts`、工作台断言 | 过期离线，结束清空current_task |
| 暂停、继续、取消和接管可恢复 | `task-state.test.ts`、`batch-resume.test.ts`、`tool-calls.test.ts` | 检查点续跑；HTTP/子进程真实取消 |
| 结果未知不自动重试 | `task-recovery.test.ts`、`model-calls.test.ts` | 保持interrupted，普通入队被拒 |
| 单活动主编租约 | `editor-takeover.test.ts` | 每书唯一活动租约 |
| 第3章前接管演练 | `release-journey.test.ts` | 第2章中断后、启动第3章前完成 |
| 完整接管包 | `editor-takeover.test.ts`、全链路 | 任务、章节、正史、待决、预算、调用齐全 |
| 旧epoch拒绝且无重复 | `release-journey.test.ts` | 旧指令拒绝；已完成两章不重生、不重复计费 |

## 6 记忆与正史

| 验收项 | 证据 | 结果 |
|---|---|---|
| 百万字硬锚100%、语义Recall@10≥95% | `memory-retrieval.test.ts` | 100% / 达标 |
| 每次模型调用有不可变上下文包 | 单章、讨论和全链路断言 | `context_pack_id` 无空值 |
| 硬来源不静默截断 | `context-pack.test.ts` | 超预算明确暂停，排除原因留痕 |
| 人物/时间/位置/道具/属性/技能/知情/伏笔 | Schema、事实门禁、结算投影测试 | 确定性结构与检查通过 |
| A/B/C/D门禁 | `fact-gates.test.ts` | 证据、复核、老板确认与版本门禁通过 |
| D级阻断依赖 | `fact-gates.test.ts`、全链路待决演练 | 未确认不结算；拒绝后解除 |
| 正史失效精确传播 | `context-pack.test.ts`、`artifacts-adaptation.test.ts` | 相关派生失效，无关记录不机械重做 |
| 人物、时间线、关系和叙事图谱重建 | `settlement-projections.test.ts`、`projections-research.test.ts` | 从正式事实/成果确定性重建 |

## 7 创作闭环

| 验收项 | 证据 | 结果 |
|---|---|---|
| 主测试书连续5章，每章2500—3500字 | `release-journey.test.ts`、`batch-resume.test.ts` | 5章全部结算且字数合规 |
| 八阶段章节流水线 | `single-chapter-pipeline.test.ts` | 预检、上下文、初稿、硬检、异模审校、重写、事实、结算齐全 |
| 第2章中断后续跑 | 全链路与批次测试 | 从第3章继续，前两章哈希不变 |
| 前章依赖、完成幂等、暂存隔离 | 批次、Worker与故障注入测试 | 后章不能越过；失败暂存不入正式正文 |
| 完整不可变版本 | 单章与提升恢复测试 | 修改生成父子相连的新完整版本 |
| 结构化审校 | 单章测试 | 位置、类型、严重度、依据、要求齐全 |
| 最多两次重写与上游建议 | 流水线门禁和质量指标 | 超限停止机械润色；重复major记录换笔建议 |

## 8 讨论与老板体验

| 验收项 | 证据 | 结果 |
|---|---|---|
| 自然语言建书、切书、生成、暂停、继续、接管、历史 | API建书、App UI、workspace API、分页和全链路测试 | 通过 |
| 自然语言讨论和选方案 | `discussion-runtime.test.ts` | Worker两岗位调用、主编汇总、完整ID确认 |
| 明确命令零Token，模糊意图不伪造 | `workspace-api.test.ts` | 写作控制/接管/确认零额外模型；开放消息明确能力边界 |
| 只激活相关岗位，未回复不伪造 | 讨论领域与运行测试 | 真实responded字段；缺回复仍可按规则收口 |
| 汇总推荐、理由、分歧和影响 | 讨论决定记录与主编消息 | 老板无需读取原始长输出 |
| 重大确认显示对象、版本、范围、后果、费用 | `workspace-ui.test.tsx` | 显示详情与明确接受/拒绝按钮 |
| 模糊回复不触发重大操作 | 正史、接管、永久删除测试 | 仅完整确认ID/严格确认词生效 |

## 9 版权与研究

| 验收项 | 证据 | 结果 |
|---|---|---|
| 原文/详细映射/拆书FTS不进主笔上下文 | `copyright-cleanroom.test.ts` | 禁止来源类型和长原文窗口拒绝 |
| 结构卡去专名、独特场景和原事件顺序 | 同上 | 专名、原句窗口、事件链相似度三重门禁 |
| 生成前后自动检查 | 同上及章节流水线 | 缺干净室包在调用前失败；生成后聚合检查 |
| 换名、近改、翻译、拼接、标志事件链阻断 | 版权测试 | 全部返回redesign/blocked |
| 只有适用授权或重新设计解除 | 版权授权测试 | 缺licenseId拒绝，普通继续无效 |
| 研究来源元数据、哈希、证据与候选边界 | `projections-research.test.ts`、`workspace-api.test.ts` | 来源可审计，接口不返缓存原文，候选不改正史 |

## 10 预算与稳定性

| 验收项 | 证据 | 结果 |
|---|---|---|
| 调用前冻结、结束结算 | 模型调用、讨论、单章测试 | Token/0现金/耗时进入账本 |
| 并发不超卖、100%停止 | `budget.test.ts` | 原子冻结，超额拒绝 |
| 70%重新预测 | 预算阈值事件断言 | 保存剩余量和缩减非必要岗位/检索建议 |
| 未知现金费用暂停 | `budget.test.ts` | 冻结前拒绝 |
| 重试与备用上限 | 结果未知恢复、流水线重写门禁 | 未启用无界自动重试；普通重试结果未知被拒 |
| 24小时确定性Worker稳定性 | `worker-logical-soak.test.ts` | 1440分钟调度周期、24个小时探针全成功、无暂存、堆增长<32MiB |
| 真实进程驻留 | `worker-process-liveness.test.ts` | 空闲6秒仍驻留，心跳持续前进 |

## 11 备份、恢复和删除

| 验收项 | 证据 | 结果 |
|---|---|---|
| 备份覆盖数据库、正文历史、正史、任务、预算、调用、墓碑和暂存 | `BackupService`清单及全链路 | 注册文件和数据库一致性快照齐全 |
| 清单与哈希 | 备份/全链路测试 | manifest、databaseHash、逐文件hash通过 |
| 干净隔离目录真实恢复 | `backup-restore.test.ts`、全链路 | integrity、foreign_key、正文/正史数量与哈希通过 |
| 滚动24小时内恢复演练 | 本次有数据变化的发布验收内创建并验证备份 | 通过 |
| 归档/导入/恢复隔离 | 生命周期、quarantine、operations API测试 | 不污染其他书 |
| 普通删除归档，永久删除严格确认和墓碑 | `book-lifecycle.test.ts`、operations API | `YES+名称+短ID`，模糊文本409，墓碑防复活 |
| 第二物理位置边界 | `USER_GUIDE.md`、`RELEASE.md` | 明确未配置，不声称防硬盘损坏 |

## 12 多端体验

| 验收项 | 证据 | 结果 |
|---|---|---|
| 桌面三栏/折叠/阅读模式，平板手机抽屉 | `workspace-ui.test.tsx`、响应式CSS | 通过 |
| 软键盘安全区、长文阅读 | CSS safe-area、三千字正文测试 | 通过 |
| PWA安装与离线 | `offline-pwa.test.ts` | manifest/图标/离线壳；API不缓存 |
| 草稿断线不丢、正史更新缓存失效 | IndexedDB测试 | 按书隔离、canon_revision失效 |
| 亮暗色、键盘、焦点、对比、减少动画 | axe-core及CSS媒体规则 | 自动规则零违规 |
| 长对话/长正文流畅 | `message-pagination.test.ts`、UI长对话、正文测试 | API 500窗口、DOM 200窗口、正文分段读取 |
| 状态刷新不闪跳 | 固定三栏骨架与局部5秒刷新 | 通过 |

## 13 最终交付

| 验收项 | 证据 | 结果 |
|---|---|---|
| main、账本、文档、Schema和release一致 | Git、`RELEASE_ID`、Schema 7、release ledger | 通过 |
| 每阶段验收包 | `stages/00`至`08` | 齐全 |
| 24条无跳过 | `docs/COVERAGE_MATRIX.md` | 齐全 |
| 老板无需技术命令 | 根目录启动/停止入口、`docs/USER_GUIDE.md` | 通过 |
| 项目经理签署 | 当前Codex基于本矩阵、代码复核、测试和实机证据签署 | 通过 |
