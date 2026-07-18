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
| DEC-002 | 正式授权八阶段开发并锁定名称、端口、数据、零现金、Git与备份边界 | `DECISIONS.md`、`KNOWLEDGE.md`、`TASKS.md`、`README.md`、发布验收包 |
| DEC-003 | 产品名称、技术标识、桌面入口和数据库统一为“文秘写作” | 当前代码、入口、数据迁移、使用说明和验收 |
| DEC-004 | 工作台采用内容优先、浅绿可调、窄侧栏和原型头像 | `PRODUCT.md`、Web工作台、UI测试和使用说明 |
| DEC-005 | 九岗位使用女性成员身份和短岗位名 | `AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、Agent领域、迁移和界面 |
| DEC-006 | 预算与待确认移入任务中心，右栏只显示成员 | `PRODUCT.md`、Web任务中心、工作区API和体验测试 |
| DEC-007 | 九岗位使用Codex登录态与火山方舟套餐模型 | `AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、模型适配器、任务流水线和模型测试 |
| DEC-008 | 开放对话与写作准备门禁先于主笔生成 | `PRODUCT.md`、`API.md`、聊天/讨论/规划/章节服务和增量验收 |
| DEC-009 | 长篇创作失败、反迎合、混合RAG目标和E0—E4独立证据门禁 | `LONGFORM_QUALITY.md`、`LONGFORM_QUALITY_GAP.md`、`MEMORY.md`、`ACCEPTANCE.md`、项目级Skill和评测夹具 |

## 当前发布执行证据

- 开工基线与阶段1已覆盖共识1、3、23、24的工程底座部分，证据见 `docs/releases/wm-v1-20260716-220959-d5dd704d/stages/00-baseline.md` 与 `01-foundation.md`。
- 阶段2已覆盖共识16与22的数据安全主体，并为共识12、14、15、17建立不可变正文和恢复前置门禁，证据见 `02-data-safety.md`。
- 阶段3已覆盖共识3至5、7与21的运行底座，包括持久任务、真实调用状态、预算冻结、9岗位、SSE和双主编接管，证据见 `03-runtime.md`。
- 阶段4已覆盖共识8至11，包括来源可见的定位卡、确认后原子建书、题材适配失效、六层规划Schema与有限讨论收口，证据见 `04-domain.md`。
- 阶段5已覆盖共识14、15和17的主体，包括八层记忆、硬来源上下文包、A/B/C/D门禁、原子正史结算、FTS隔离重建和人物/时间线/关系投影，证据见 `05-memory-canon.md`。
- 阶段6已覆盖共识6、12、13和21的创作主体，包括匿名样章选择、单章全流水线、异模型结构化审校、完整版本重写、5章串行续跑和逐调用预算/上下文审计，证据见 `06-creation.md`。
- 阶段7已覆盖共识2、18、19和20，包括五类双轨投影、版权原文隔离/干净室、研究候选边界、桌面/移动/PWA、IndexedDB与真实Worker状态，证据见 `07-experience.md`。
- 阶段8已对全部1至24条执行交叉回归：两书五章、中断接管、真实讨论、工具取消、预算预测、版权绕过、长对话、备份恢复、逻辑24小时Worker和桌面实机入口均通过，证据见 `08-release.md` 和 `ACCEPTANCE_MATRIX.md`。
- 本首版24条共识没有未说明跳过项。真实外部模型、第二物理备份和远程Git属于已明确记录的部署边界，不被伪装为已配置能力。
