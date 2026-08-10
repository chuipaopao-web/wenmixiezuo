# 当前功能覆盖矩阵

| 能力 | 权威规格 | 主要实现 | 主要测试 |
|---|---|---|---|
| 开书与定位 | PRODUCT、WORKFLOW V2 | books/onboarding/positioning | positioning-onboarding、api-flow |
| 设定对象协作 | WORKFLOW V2、AGENT SYSTEM | setting workspace/collaboration commands | setting-collaboration、setting panel |
| 作者想法与附件 | PRODUCT、DATA MODEL | author planning inputs/attachments | author-collaboration、author-attachments |
| 分卷 | WORKFLOW V2 | volume plan services/pipelines | volume planning/generation tests |
| 事件链与事件大纲 | WORKFLOW V2 | story event services/pipelines | story event planning/generation tests |
| 当前事件章纲 | WORKFLOW V2 | event chapter outline services | event chapter outline/generation tests |
| 单章正文与审查 | PRODUCT、RUNTIME | chapter production/review services | chapter creation/review/approval tests |
| 章节/事件/卷结算 | LONGFORM QUALITY | settlement/continuity/projection | settlement projections/planning settlement tests |
| 上下文与混合RAG | MEMORY、HYBRID RAG | context packs/retrieval orchestration | retrieval、context、isolation tests |
| 续写与反向拆解 | PRODUCT、WORKFLOW V2 | continuation services | existing-manuscript-continuation |
| 图谱/资料库/取名 | PRODUCT | projections/knowledge/naming | projection、knowledge、naming tests |
| 任务、预算和恢复 | ARCHITECTURE、RUNTIME | task/model/budget services | fault/runtime/recovery tests |
| 备份与删除 | SECURITY | backup/portability/lifecycle | backup/purge/recovery tests |
| UI与无障碍 | PRODUCT、USER GUIDE | React creation desk | workspace and feature component tests |

## 当前验证

- 运行时可达性：Contracts/API/Worker/Web均为0个孤儿源码。
- 类型检查：通过。
- 全量测试：143个文件、534项通过。
- 生产构建：Contracts、API、Worker、Web通过。
- 真实模型长篇文学质量：仍按E3/E4持续积累，不由工程覆盖矩阵代替。