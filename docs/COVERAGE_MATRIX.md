# 24条共识覆盖矩阵

本表用于防止讨论结果在开发中遗漏。完整原文见 `CONSENSUS_LEDGER.md`。

| 编号 | 共识主题 | 当前规格入口 | 主要开发阶段 | 关键验收 |
|---:|---|---|---:|---|
| 1 | 产品定位与独立边界 | `PROJECT_CHARTER.md`、`ARCHITECTURE.md` | 1 | 两产品独立运行与数据隔离 |
| 2 | UI风格与使用形态 | `PRODUCT.md` | 7 | 桌面/手机/PWA、无闪跳、真实状态 |
| 3 | 总体技术架构与部署方式 | `ARCHITECTURE.md`、`API.md` | 1—3 | 模块化单体、Worker、REST/SSE、恢复 |
| 4 | 真正Agent的能力模型 | `AGENT_SYSTEM.md` | 3 | 持久运行循环、能力验证、真实状态 |
| 5 | 岗位、Agent实例与模型配置 | `AGENT_SYSTEM.md`、`DECISIONS.md` | 3—4 | 历史9岗位兼容；下一release 11人原子创建、模型真实显示 |
| 6 | 主笔选择与专业分工 | `PRODUCT.md`、`AGENT_SYSTEM.md` | 6 | A/B盲测、异模型评审、换笔门禁 |
| 7 | 双主编权限与接管 | `AGENT_SYSTEM.md`、`DATA_MODEL.md` | 3 | 租约、epoch、接管与旧指令拒绝 |
| 8 | 多Agent讨论与老板决策流程 | `PRODUCT.md`、`API.md` | 4 | 有范围讨论、真实意见、老板确认 |
| 9 | 建书方式、分类与标签体系 | `PRODUCT.md`、`DATA_MODEL.md` | 4 | 定位卡、标签版本、新书原子性 |
| 10 | 题材自适应与质量标准 | `PRODUCT.md` | 4 | 适配快照、规则失效、题材质量标准 |
| 11 | 创作方案、故事圣经与大纲模板 | `PRODUCT.md`、`DATA_MODEL.md` | 4 | 六层规划成果、版本与历史 |
| 12 | 单章与连续多章创作流水线 | `PRODUCT.md`、`ARCHITECTURE.md` | 6 | 前章结算、串行、多章断点续跑 |
| 13 | 正文写作规范与AI腔风险 | `PRODUCT.md` | 6 | 三异模型结构化点评、可解释AI腔/段落占比、政治情色风险、定点重写、不可变版本 |
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
| DEC-001 | 历史首版从5个固定岗位调整为5个核心加4个按需专家，共9个岗位；下一release由DEC-021取代 | `DECISIONS.md`与历史release证据 |
| DEC-002 | 正式授权八阶段开发并锁定名称、端口、数据、零现金、Git与备份边界 | `DECISIONS.md`、`KNOWLEDGE.md`、`TASKS.md`、`README.md`、发布验收包 |
| DEC-003 | 产品名称、技术标识、桌面入口和数据库统一为“文秘写作” | 当前代码、入口、数据迁移、使用说明和验收 |
| DEC-004 | 工作台采用内容优先、浅绿可调、窄侧栏和原型头像 | `PRODUCT.md`、Web工作台、UI测试和使用说明 |
| DEC-005 | 历史九岗位使用女性成员身份和短岗位名；下一release仍保留女性化短身份并扩为11人 | `AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、Agent领域、迁移和界面 |
| DEC-006 | 预算与待确认移入任务中心，右栏只显示成员 | `PRODUCT.md`、Web任务中心、工作区API和体验测试 |
| DEC-007 | 历史九岗位使用Codex登录态与火山方舟套餐模型；下一release具体分工由DEC-021补充 | `AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、模型适配器、任务流水线和模型测试 |
| DEC-008 | 开放对话与写作准备门禁先于主笔生成 | `PRODUCT.md`、`API.md`、聊天/讨论/规划/章节服务和增量验收 |
| DEC-009 | 长篇创作失败、反迎合、混合RAG目标和E0—E4独立证据门禁 | `LONGFORM_QUALITY.md`、`LONGFORM_QUALITY_GAP.md`、`MEMORY.md`、`ACCEPTANCE.md`、项目级Skill和评测夹具 |
| DEC-010 | 长篇治理不得削弱创造性和输出质量；四种模式、创作自由区、差异化团队、延后软审校、经验防固化与非劣效评测 | 项目级Skill、`LONGFORM_QUALITY.md`、`PRODUCT.md`、`AGENT_SYSTEM.md`、`MEMORY.md`、`ACCEPTANCE.md`和创造性对抗夹具 |
| DEC-011 | 全书表达基线保持稳定，具体写作技法按场景叙事目标动态选择；内部技法库是软工具箱而非固定模板 | `PRODUCT.md`、`DATA_MODEL.md`、`AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、`MEMORY.md`、`LONGFORM_QUALITY.md`与`ACCEPTANCE.md` |
| DEC-012 | SQLite与不可变文件保持唯一权威，LanceDB作为本地嵌入式可重建向量投影；FTS5、时间关系、Wiki、融合重排和原文回查构成混合RAG | `HYBRID_RAG_DESIGN.md`、`ARCHITECTURE.md`、`DATA_MODEL.md`、`MEMORY.md`、`LONGFORM_QUALITY.md`、`ACCEPTANCE.md`与后续运行时证据 |
| DEC-013 | 建立作者可见的实体/图谱/标签资料库，并允许活动主编按老板自然语言可逆治理标签 | `PRODUCT.md`、`DATA_MODEL.md`、`AGENT_SYSTEM.md`、`MEMORY.md`、`API.md`、`ACCEPTANCE.md`与后续运行时证据 |
| DEC-014 | 最终容量按500万字符、1500章设计，稳定成员在全书生命周期内通过岗位连续性长期陪伴；人数由DEC-021更新为11 | `ULTRA_LONGFORM_CONTINUITY.md`、`PROJECT_CHARTER.md`、产品/架构/数据/Agent/记忆/质量/API/路线图/验收与后续运行时证据 |
| DEC-015 | 旧阶段摘要优先；实体、开放线程、规则、因果、冲突等关键触发按卷→故事弧→章节/场景→正史原文有界下钻 | `ULTRA_LONGFORM_CONTINUITY.md`、`HYBRID_RAG_DESIGN.md`、记忆/数据/Agent/产品/API/质量/实施/验收、项目级Skill与后续运行时证据 |
| DEC-016 | 单一权威库采用临时、候选、正史、派生四层；原始资产归档优先，只有可重建投影自动清理 | `HYBRID_RAG_DESIGN.md`、数据/记忆/产品/API/实施/验收、任务账本与后续迁移/恢复证据 |
| DEC-017 | 资料切片采用不可变原文、结构节点、父子检索块、原子事实、零盲目重叠和版本化原子快照 | `CHUNKING_DESIGN.md`、`HYBRID_RAG_DESIGN.md`、架构/数据/记忆/产品/API/质量/实施/验收、任务账本与后续E1—E4证据 |
| DEC-018 | 重要方案在推荐形成前执行并留痕适用Skill；修正偏好硬化、自动事实权威、三轴时间、候选老化、压缩、下钻、Token预算和同名消歧缺口 | `DESIGN_GOVERNANCE_AUDIT.md`、项目规则、决定/记忆/数据/RAG/超长篇/实施/验收/知识/任务文档与后续E1—E4证据 |
| DEC-019 | 四路检索先做硬门禁和意图路由，按H硬约束/E证据/I灵感三车道融合，同源聚类、冲突保留、有界关系和正式来源闭环 | `HYBRID_RETRIEVAL_ORCHESTRATION.md`、RAG/架构/数据/记忆/Agent/超长篇/API/实施/验收与后续E1—E4证据 |
| DEC-020 | 冻结长篇终局设计，以新release、Schema 10—16、真实状态机、本机安全、可移植、逐书影子切换和E0—E4分层验收开发 | `PRE_DEVELOPMENT_DESIGN_FREEZE.md`、`RUNTIME_WORKFLOWS.md`、`SECURITY_AND_OPERATIONS.md`、`EVALUATION_PROTOCOL.md`、最终八阶段实施计划及所有当前规格 |
| DEC-021 | 下一release固定11人团队；双异模型编剧、主编/副编、主笔/副笔；每个完整稿由GLM、Kimi、豆包三异模型全文点评，并包含可解释AI腔、政治与情色风险 | `AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、`RUNTIME_WORKFLOWS.md`、`DATA_MODEL.md`、`API.md`、`ACCEPTANCE.md`、八阶段实施计划和 `AGENT_TEAM_REVIEW_AUDIT.md` |
| DEC-022 | 前端显示一句话职责和可点击公开岗位合同；研究员作为零空转的按需现实事实专家保留，不参与固定三评 | `PRODUCT.md`、`AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、`DATA_MODEL.md`、`API.md`、`ACCEPTANCE.md`、Web实施计划和任务账本 |

## 当前发布执行证据

- 开工基线与阶段1已覆盖共识1、3、23、24的工程底座部分，证据见 `docs/releases/wm-v1-20260716-220959-d5dd704d/stages/00-baseline.md` 与 `01-foundation.md`。
- 阶段2已覆盖共识16与22的数据安全主体，并为共识12、14、15、17建立不可变正文和恢复前置门禁，证据见 `02-data-safety.md`。
- 阶段3已覆盖共识3至5、7与21的运行底座，包括持久任务、真实调用状态、预算冻结、9岗位、SSE和双主编接管，证据见 `03-runtime.md`。
- 阶段4已覆盖共识8至11，包括来源可见的定位卡、确认后原子建书、题材适配失效、六层规划Schema与有限讨论收口，证据见 `04-domain.md`。
- 阶段5已覆盖共识14、15和17的主体，包括八层记忆、硬来源上下文包、A/B/C/D门禁、原子正史结算、FTS隔离重建和人物/时间线/关系投影，证据见 `05-memory-canon.md`。
- 阶段6已覆盖共识6、12、13和21的创作主体，包括匿名样章选择、单章全流水线、异模型结构化审校、完整版本重写、5章串行续跑和逐调用预算/上下文审计，证据见 `06-creation.md`。
- 阶段7已覆盖共识2、18、19和20，包括五类双轨投影、版权原文隔离/干净室、研究候选边界、桌面/移动/PWA、IndexedDB与真实Worker状态，证据见 `07-experience.md`。
- 阶段8已对全部1至24条执行交叉回归：两书五章、中断接管、真实讨论、工具取消、预算预测、版权绕过、长对话、备份恢复、逻辑24小时Worker和桌面实机入口均通过，证据见 `08-release.md` 和 `ACCEPTANCE_MATRIX.md`。
- 本首版24条共识没有未说明跳过项。真实外部模型和第二物理数据备份仍按实际状态报告；远程Git后来已配置私有仓库，但只备代码/文档，不冒充小说数据备份。DEC-011至021的长篇终局能力当前仍以E0为主，只有新release取得的E1—E4证据才可升级结论。
