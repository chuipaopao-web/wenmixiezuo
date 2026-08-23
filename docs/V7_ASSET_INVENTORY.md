# 文秘写作 V7 功能资产清单

> 状态：讨论阶段的初步只读审计，不是代码迁移、重构或删除授权。
> 用途：讨论 V7 可能复用什么、适配什么、重做什么、何时删除什么。它不是旧功能继续存在的理由。
> 状态含义：`直接保留`、`适配复用`、`重新开发`、`切换后删除`、`禁止删除`、`待实证`。

## 1. 总体原则

- 不把旧项目复制到新目录后再删原项目。
- 稳定底层优先原位复用；旧流程耦合严重的能力通过 V7 适配器访问。
- 只有独立、稳定且语义符合 V7 的代码才提取为共享模块。
- 旧 UI 和旧工作流在 V7 验收前保留为回滚路径；切换后证明零有效引用再删除。
- 已合并迁移、作者正式数据、正文版本、结算和审计记录永远不能按“旧代码”删除。

## 2. 直接保留

| 资产 | 主要证据 | V7 用法 | 验证要求 |
| --- | --- | --- | --- |
| 登录、会话、身份与成员资格 | `apps/api/src/infrastructure/security/` | 所有 V7 请求继续从已验证会话取得身份 | 账号与越权测试 |
| `owner_id + book_id` 书籍隔离 | 现有 repositories、routes 与隔离测试 | 所有 V7 核心读写继续携带书籍作用域 | 两用户两书交叉访问 |
| 数据库迁移框架与历史迁移 | `apps/api/src/infrastructure/db/migrations/` | 只追加迁移，不改写已合并迁移 | 空库、旧库、重复执行 |
| 正文不可变完整版本 | manuscript 与 chapter approval 服务 | V7 正文修改继续产生新版本 | 旧版本与当前版本可读 |
| 任务、预算与模型调用账本 | `TaskService`、`BudgetService`、`ModelCallService` | V7 AI 节点继续复用运行时和成本记录 | 幂等、失败、重试、零重复扣费 |
| ContextPack 持久化、来源和哈希 | `ContextPackService` | V7 通过资料包网关调用 | 同书正确、跨书为零、同批同哈希 |
| 章节/事件/卷结算能力 | settlement services/repositories | 正文实际写回正式状态 | 计划与事实分离、幂等 |
| 使用量、后台问题和审计账本 | admin console、usage ledger、issue records | V7 失败和调用继续进入后台 | 不泄密、可追溯 |
| 发布、健康检查与回滚底座 | `docs/DEPLOY.md` 与现有服务 | V7 沿用单一生产部署 | 发布前后冒烟与回滚 |

## 3. AI 资源管理：保留并优化

### 3.1 已有可靠能力

- 7 类岗位和初始 25 名成员；后台可增加成员。
- 成员启停、头像、供应公司、消耗等级和模型快照。
- 后台改绑只影响未来任务，历史调用保留快照。
- 自动选择考虑负载、消耗和近期失败。
- 同批成员冻结相同 ContextPack 和任务输入。
- 相同模型签名不能伪装成独立成员。
- 单成员重试、替换和保留其他成功结果。
- Skill、节点协议和创作模板版本化。

主要证据：

- `apps/api/src/application/agents/agent-team-service.ts`
- `apps/api/src/application/agents/model-binding-service.ts`
- `apps/api/src/application/agents/ai-node-batch-service.ts`
- `apps/api/src/application/agents/ai-node-pipeline-service.ts`
- `apps/api/src/application/calls/model-call-service.ts`
- `tests/integration/domain/ai-node-batch-v6.test.ts`
- `tests/integration/agents/model-binding-governance.test.ts`
- `tests/integration/runtime/agent-team.test.ts`

### 3.2 V7 前需要的边界优化

`ai-node-batch-service.ts` 目前同时承担成员池、作者输入、成本、资料包、Skill、模板、批次、重试、替换和结果保存，V7 不继续向该服务堆职责。

目标边界：

```text
EditorialResourceGateway  成员目录、可用性、后台模型绑定
AiBatchGateway            批次、席位、重试、替换、候选
ContextGateway            当前任务资料包
CreativePolicyGateway     Skill、节点规则和模板快照
CostPolicy                消耗估算与高消耗确认
```

第一阶段允许这些网关调用现有服务；只有出现真实阻断时才拆内部代码。

### 3.3 暂不阻断 V7 的优化项

当前岗位池和成员设置较多按书籍初始化。长期可评估改成“平台成员目录 + 任务执行快照 + 可选书籍分配”，减少每本书复制成员配置。该项涉及数据库语义，不得在没有设计审查和迁移验收时顺手实施，也不阻断第一条 V7 纵向闭环。

## 4. 适配复用

| 资产 | 当前问题 | V7 处理 |
| --- | --- | --- |
| `ContextPackService` | 仍包含 V6 对象和来源选择 | 保留编译、预算、来源、哈希；新增 V7 节点策略适配器 |
| AI 节点批次 | 服务职责过多，节点语义偏 V6 | 新 V7 网关调用，不复制服务 |
| 故事线/关系/伏笔总账 | 当前页面把它们暴露得较重 | 后台继续使用，前端改为故事雷达投影 |
| 卷、事件、章链对象 | 当前依赖旧五页流程 | 保留数据职责，改成轻量作者视图 |
| 三席审查 | 当前工作流展示较重 | 保留独立报告和模型隔离，前端默认一次审查、按需再查 |
| 作者 API 投影 | 已能隐藏模型和内部字段 | 增加 V7 视图合同，继续执行脱敏 |
| 管理后台资源治理 | 已有成员、模板、调用和失败信息 | 保留；按 V7 节点增加筛选和追溯，不重做后台壳 |
| 桌面/手机应用壳 | 左书架、顶部导航、手机双排习惯符合老板决定 | 只复用外壳行为，内部页面重新设计 |

## 5. 重新开发

| 模块 | 原因 | 新位置建议 |
| --- | --- | --- |
| V7 工作流状态机 | V6 以五页和大量前置步骤组织，不能继续扩展 | `apps/api/src/application/coauthoring-v7/` |
| V7 API/Contracts | 需要以“当前任务/下一步动作”为中心 | `apps/contracts/src/coauthoring-v7.ts` |
| V7 作者工作区 | 旧页面组件过大且绑定旧流程 | `apps/web/src/features/coauthoring-v7/` |
| 开书轻量入口 | 只选题材也能开始 | V7 opening 模块 |
| 卷方向选择 | 少量白话方案和作者输入 | V7 volume 模块 |
| 当前事件视图 | 未来骨架收起，只处理当前事件 | V7 current-event 模块 |
| 章纲—正文—审查—结算循环 | 当前任务单焦点 | V7 chapter 模块 |
| 故事雷达 | 正文结算驱动、非前置门槛 | V7 story-radar 模块 |
| V7 视觉系统与页面状态组件 | 旧卡片和旧设计图不再适用 | V7 shared；只在确认后升级全局 token |

## 6. 不得整体迁移或复制

- `CoreWorkflowV6Service`：只作为旧数据和实现证据，不复制到 V7。
- `VolumePlanningPanel.tsx`、`EventPlanningPanel.tsx`、`ManuscriptWorkspace.tsx`：只提取有证据的低层原语，不复制页面主体。
- V6 页面专用状态、流程栏、前置门槛、长说明和旧卡片 CSS。
- V6 设计图及其“95%相似”要求。
- 为废弃 UI 保留的兼容分支和只验证旧交互的测试。

## 7. 禁止删除

- 已合并的数据库迁移文件和迁移记录。
- 作者开书、设定、确认规划、正文和结算数据。
- 正文历史版本、来源引用、模型调用与审计记录。
- 账号、书籍、会员、使用量和安全相关表与服务。
- 当前生产回滚版本和部署所需资产。
- 新流程尚未覆盖的唯一能力。

## 8. 切换后删除候选

以下项目只有在 V7 对应闭环通过、旧数据可读且零有效引用后才能删除：

- 旧 V6 页面主体组件；
- 旧工作流路由和前端状态分支；
- 仅为旧页面服务的 API 聚合和服务方法；
- 旧页面专用 CSS、文案和测试；
- 当前文档中与 V7 冲突的现行规格；
- 旧深链接的 UI 入口。必要的数据读取重定向可以保留，并记录退出条件。

删除前必须扫描：静态 import、动态注册、路由、任务类型、Worker 分发、API、测试、恢复逻辑、部署脚本和文档引用。

## 9. 待实证事项

新任务不得凭本清单直接判定以下内容可删：

- 旧故事线、卷、事件、章链表中哪些字段仍被结算或恢复使用；
- V6 聚合服务中哪些方法是唯一历史数据读取入口；
- 旧页面 CSS 是否被其他页面共享；
- 旧任务类型是否仍有在途或可恢复任务；
- 成员按书初始化能否无迁移切换为平台目录。

这些事项必须以代码引用、数据库查询、运行记录和测试为证据。
