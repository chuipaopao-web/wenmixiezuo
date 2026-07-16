# 24条共识覆盖矩阵

本表用于防止讨论结果在开发中遗漏。完整原文见 `CONSENSUS_LEDGER.md`。

| 编号 | 共识主题 | 当前规格入口 | 主要开发阶段 | 关键验收 |
|---:|---|---|---:|---|
| 1 | 产品定位与独立边界 | `PROJECT_CHARTER.md`、`ARCHITECTURE.md` | 1 | 两产品独立运行与数据隔离 |
| 2 | UI风格与使用形态 | `PRODUCT.md` | 7 | 桌面/手机/PWA、无闪跳、真实状态 |
| 3 | 总体技术架构与部署方式 | `ARCHITECTURE.md`、`API.md` | 1—3 | 模块化单体、Worker、REST/SSE、恢复 |
| 4 | 真正Agent的能力模型 | `AGENT_SYSTEM.md` | 3 | 持久运行循环、能力验证、真实状态 |
| 5 | 岗位、Agent实例与模型配置 | `AGENT_SYSTEM.md`、`DECISIONS.md` | 3—4 | 9岗位原子创建、模型真实显示 |
| 6 | 主笔选择与专业分工 | `PRODUCT.md`、`AGENT_SYSTEM.md` | 6 | A/B盲测、异模型评审、换笔门禁 |
| 7 | 双主编权限与接管 | `AGENT_SYSTEM.md`、`DATA_MODEL.md` | 3 | 租约、epoch、接管与旧指令拒绝 |
| 8 | 多Agent讨论与老板决策流程 | `PRODUCT.md`、`API.md` | 4 | 有范围讨论、真实意见、老板确认 |
| 9 | 建书方式、分类与标签体系 | `PRODUCT.md`、`DATA_MODEL.md` | 4 | 定位卡、标签版本、新书原子性 |
| 10 | 题材自适应与质量标准 | `PRODUCT.md` | 4 | 适配快照、规则失效、题材质量标准 |
| 11 | 创作方案、故事圣经与大纲模板 | `PRODUCT.md`、`DATA_MODEL.md` | 4 | 六层规划成果、版本与历史 |
| 12 | 单章与连续多章创作流水线 | `PRODUCT.md`、`ARCHITECTURE.md` | 6 | 前章结算、串行、多章断点续跑 |
| 13 | 正文写作规范与去AI味 | `PRODUCT.md` | 6 | 结构化审校、定点重写、不可变版本 |
| 14 | 分层记忆与上下文组装 | `MEMORY.md` | 5 | 硬锚点100%、上下文包、注意力预算 |
| 15 | 知识库、正史与自动落库规则 | `MEMORY.md`、`DATA_MODEL.md` | 5 | A/B/C/D门禁、原子章节结算 |
| 16 | 跨书隔离与书籍生命周期 | `DATA_MODEL.md`、`PRODUCT.md` | 2 | 两书零串线、归档恢复和删除墓碑 |
| 17 | 一致性检查与动态人物档案 | `MEMORY.md` | 5—6 | 硬冲突、人物视图、版本失效 |
| 18 | 情绪、主线、支线与钩子图谱 | `PRODUCT.md`、`DATA_MODEL.md` | 7 | 可重建投影、计划轨与实际轨分离 |
| 19 | 拆书、结构重构与版权门禁 | `PRODUCT.md`、`DATA_MODEL.md` | 7 | 原文隔离、干净室、分维度阻断 |
| 20 | 联网研究与推荐系统 | `PRODUCT.md`、`API.md` | 7 | 来源证据、候选边界、离线诚实 |
| 21 | 成本、注意力与自动运行控制 | `PRODUCT.md`、`MEMORY.md` | 3—7 | 预算冻结、70/100%保护线、有限重试 |
| 22 | 数据安全、版本与恢复 | `ARCHITECTURE.md`、`DATA_MODEL.md` | 2、8 | 哈希、操作日志、备份与真实恢复 |
| 23 | 原始需求、讨论共识与项目文档 | `AGENTS.md`、`DECISIONS.md` | 1—8 | 来源、版本、发布和文档同步 |
| 24 | 连续开发范围与最终验收 | `DEVELOPMENT_ROADMAP.md`、`ACCEPTANCE.md` | 1—8 | 唯一release、阶段门禁、最终证据 |

## 后续决定覆盖

| 决定 | 覆盖内容 | 生效文件 |
|---|---|---|
| DEC-001 | 从5个固定岗位调整为5个核心加4个按需专家，共9个岗位 | `DECISIONS.md`、`PRODUCT.md`、`AGENT_SYSTEM.md`、`DATA_MODEL.md`、`ACCEPTANCE.md` |

