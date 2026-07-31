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
| 11 | 创作方案、故事圣经与大纲模板 | `PRODUCT.md`、`DATA_MODEL.md` | 4 | 本书资料、设定大纲、剧情总纲、章纲分层可见且保留版本；独立卷纲退役并只保留历史审计；新总纲由双编剧分别提交连续章节阶段规划，并含主线闭环、起承转合、结算、待回收项与后续方向；章节目录只在正文工作台显示 |
| 12 | 单章与连续多章创作流水线 | `PRODUCT.md`、`ARCHITECTURE.md` | 6 | 前章结算、串行、多章断点续跑 |
| 13 | 正文写作规范与AI腔风险 | `PRODUCT.md` | 6 | 三异模型结构化点评、可解释AI腔/段落占比、政治情色风险、定点重写、不可变版本 |
| 14 | 分层记忆与上下文组装 | `MEMORY.md` | 5 | 硬锚点100%、上下文包、注意力预算 |
| 15 | 知识库、正史与自动落库规则 | `MEMORY.md`、`DATA_MODEL.md` | 5 | A/B/C/D门禁、原子章节结算 |
| 16 | 跨书隔离与书籍生命周期 | `DATA_MODEL.md`、`PRODUCT.md` | 2 | 两书零串线、归档恢复和删除墓碑 |
| 17 | 一致性检查与动态人物档案 | `MEMORY.md` | 5—6 | 硬冲突、人物视图、版本失效 |
| 18 | 人物关系、情绪、钩子/伏笔与信息差图谱 | `PRODUCT.md`、`DATA_MODEL.md` | 7 | 作者界面四类可重建视图；主线归总纲阶段、支线归会话/章纲/开放线程 |
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
| DEC-021 | 下一release固定11人团队、双异模型编剧、主编/副编、主笔/副笔和三异模型点评；固定模型名单已由DEC-026修订 | `AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、`RUNTIME_WORKFLOWS.md`、`DATA_MODEL.md`、`API.md`、`ACCEPTANCE.md`、八阶段实施计划和团队审计 |
| DEC-022 | 前端显示一句话职责和可点击公开岗位合同；研究员作为零空转的按需现实事实专家保留，不参与固定三评 | `PRODUCT.md`、`AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、`DATA_MODEL.md`、`API.md`、`ACCEPTANCE.md`、Web实施计划和任务账本 |
| DEC-023 | 历史规划页结构化成果方案；其中设定框架命名和规划页章节列表已由DEC-041替代 | `PRODUCT.md`、`API.md`、`ACCEPTANCE.md`、最终实施计划和功能总表 |
| DEC-024 | 去AI味采用带证据检测与定点修订，不安装第三方黑盒运行时Skill或默认整章改写 | `PRODUCT.md`、`ROLE_PROMPTS.md`、`EVALUATION_PROTOCOL.md`、`ACCEPTANCE.md`和最终实施计划 |
| DEC-025 | 开书只收最小资料；进入书籍即自由聊天；移除1/3/5章批次选择；双编剧估算剧情跨度，正文仍逐章执行；情绪图谱是计划/实际分析投影 | `PRODUCT.md`、`DATA_MODEL.md`、`RUNTIME_WORKFLOWS.md`、`API.md`、`ACCEPTANCE.md`、功能总表、最终实施计划和专项审计 |
| DEC-026 | 默认DeepSeek＋GLM剧情席，Kimi可替换一席，豆包不讨论剧情；副笔为GLM；模型绑定可版本化配置；GLM写手时DeepSeek承担事实点评 | 项目长篇质量Skill、`AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、`DATA_MODEL.md`、`RUNTIME_WORKFLOWS.md`、`API.md`、`ACCEPTANCE.md`、最终实施计划和专项审计 |
| DEC-076 | 副编西施统一改用火山方舟Agent Plan GLM 5.2；现有书副编定向迁移，其他岗位配置和运行中快照保留；同源GLM不计额外独立意见 | `AGENT_SYSTEM.md`、`ROLE_PROMPTS.md`、`OWNER_GUIDE.md`、`ACCEPTANCE.md`、模型绑定服务、启动迁移、回归测试和专项审计 |
| DEC-027 | 小文秘书作为11人之外的本地工具角色；确定性→本地模型→创作岗位分层；点名直达、剧情会话、原话保留、四类记忆和可回滚工具经验 | 项目长篇质量Skill、`LOCAL_SECRETARY_ROUTING_AUDIT.md`、产品/架构/数据/Agent/提示/记忆/RAG/工作流/API/评测/验收、最终实施计划和任务账本 |
| DEC-040 | 以生产调用图和故障证据补齐任务/模型结果栅栏、正史事务/增量全书索引、岗位混合RAG、认识状态事实、阶段结算、三席并发与主编真实综合；保留11岗和epoch | `PRODUCTION_CHAIN_REMEDIATION_AUDIT.md`、架构/数据/Agent/记忆规格、Schema 0020—0022、来源清单/片段复用/向量缓存/旧水位栅栏、生产服务、故障/跨书/迁移/备份测试和release证据 |
| DEC-041 | 规划/正文和图谱/资料库去重；正文不可变修订、真实重写/定稿；六类叙事图谱、主角状态账本和受限属性公式 | `MANUSCRIPT_KNOWLEDGE_WORKSPACE_AUDIT.md`、产品/架构/数据/API/验收规格、Schema 0023、正文/主角/公式服务、Web工作台与release证据 |
| DEC-049 | 持续创作会话、首轮/重大改向双编剧、锁定后滚动规划、试写/正式分流、阶段结算最小上下文和最佳稿保护 | `DESIGN_GOVERNANCE_AUDIT.md`、产品/架构/数据/Agent/记忆/质量/API/连续性/验收规格、Schema 0026、会话/上下文/质量服务、Web工作区与release证据 |
| DEC-051 | 全书框架展示完整开书资料；基本设定采用可扩展目录、分类公式和设定成员候选拆解 | `2026-07-26-setting-workbench.md`、产品/数据/API规格、Schema 0027、公式服务、规划工作台、迁移/API/UI测试 |
| DEC-056 | 动态开书标签库：一个主分类、最多3个辅助分类，通用包与题材扩展包按需组合，完整库按分类切换与搜索 | `opening-tag-library.ts`、开书合同、Web开书表单、产品/API规格及分类/UI测试 |
| DEC-057 | 单一作品分类、多选题材、按分类与题材重排的分组完整标签库；旧辅助分类只读兼容 | `opening-blueprint.ts`、`opening-tag-library.ts`、Web开书表单、产品/API规格及分类/UI测试 |
| DEC-058 | 目标读者推荐标签；分类或题材变化时自动勾选8项可撤销标签，手动删除不自动补回 | Web开书表单、产品/API规格及UI回归测试 |
| DEC-059 | 题材目录纳入分类名、主类型词与辅助题材；当前分类优先、完整目录可展开 | 开书分类合同、产品规格与题材目录契约测试 |
| DEC-052 | 三入口统一资料摄入；通用设定骨架与题材扩展；文姬负责语义拆解且不新增岗位 | `2026-07-26-unified-setting-ingestion.md`、产品/Agent/验收规格、规划工作台与会话候选测试 |
| DEC-069 | 剧情总纲改为双编剧独立提交的连续章节阶段结构；两份均通过服务端门禁后交叉质疑并由主编综合，历史浅层结构只读兼容 | `MASTER_OUTLINE_STAGE_PLANNING_AUDIT.md`、产品/数据/Agent/API/连续性/质量/验收规格、讨论流水线、规划成果服务、图谱投影、Web阶段卡片与专项测试 |
| DEC-070 | 退役独立卷纲规划层；总纲阶段直接连接未来1—3章滚动章纲，物理分卷只保留目录职责 | `VOLUME_OUTLINE_RETIREMENT_AUDIT.md`、产品/数据/API/质量/验收规格、Schema 0033、规划/讨论/写作/图谱/Web实现和release证据 |
| DEC-074 | 章纲升级为分层 `chapter_outline_v2`；服务端绑定总纲阶段，主笔使用4200字符自然中文最小资料包，作者前端隐藏内部字段 | `CHAPTER_OUTLINE_V2_AUDIT.md`、产品/数据/记忆/API/验收规格、章纲解析/编译/讨论/持久化/前端实现与回归证据 |
| DEC-071 | 作者资料库取消独立原始证据页；证据在对应资料卡内简洁呈现，后台证据闭环保持不变 | 产品/路线/验收/用户指南、Web资料库视图、工作区UI回归测试和release证据 |
| DEC-072 | 恢复按资料对象去重的作者可读证据中心；叙事图谱移除主线/支线作者入口但保留后台投影 | 产品/路线/验收/用户指南、Web资料库与图谱视图、工作区UI回归测试和release证据 |
| DEC-073 | 任务中心移至书架首页，按书聚合任务、预算和确认；书内导航移除任务 | 产品/API/验收/用户指南、轻量任务聚合接口、Web首页任务中心与多书路由测试 |

## 当前发布执行证据

- 开工基线与阶段1已覆盖共识1、3、23、24的工程底座部分，证据见 `docs/releases/wm-v1-20260716-220959-d5dd704d/stages/00-baseline.md` 与 `01-foundation.md`。
- 阶段2已覆盖共识16与22的数据安全主体，并为共识12、14、15、17建立不可变正文和恢复前置门禁，证据见 `02-data-safety.md`。
- 阶段3已覆盖共识3至5、7与21的运行底座，包括持久任务、真实调用状态、预算冻结、9岗位、SSE和双主编接管，证据见 `03-runtime.md`。
- 阶段4已覆盖共识8至11，包括来源可见的定位卡、确认后原子建书、题材适配失效、六层规划Schema与有限讨论收口，证据见 `04-domain.md`。
- 阶段5已覆盖共识14、15和17的主体，包括八层记忆、硬来源上下文包、A/B/C/D门禁、原子正史结算、FTS隔离重建和人物/时间线/关系投影，证据见 `05-memory-canon.md`。
- 阶段6已覆盖共识6、12、13和21的创作主体，包括匿名样章选择、单章全流水线、异模型结构化审校、完整版本重写、5章串行续跑和逐调用预算/上下文审计，证据见 `06-creation.md`。
- 阶段7已覆盖共识2、18、19和20，包括五类双轨投影、版权原文隔离/干净室、研究候选边界、桌面/移动/PWA、IndexedDB与真实Worker状态，证据见 `07-experience.md`。
- 阶段8已对全部1至24条执行交叉回归：两书五章、中断接管、真实讨论、工具取消、预算预测、版权绕过、长对话、备份恢复、逻辑24小时Worker和桌面实机入口均通过，证据见 `08-release.md` 和 `ACCEPTANCE_MATRIX.md`。
- 本首版24条共识没有未说明跳过项。真实外部模型和第二物理数据备份仍按实际状态报告；远程Git后来已配置私有仓库，但只备代码/文档，不冒充小说数据备份。DEC-011至027的长篇终局能力当前仍以E0为主，只有新release取得的E1—E4证据才可升级结论。
- DEC-040增量把已有检索、连续性和审校基础设施接入正式生产调用路径，并消除按修订全书重切/重嵌入及旧投影倒灌；确定性、故障注入、跨书、迁移、恢复、500万字符规模回放和本地向量运行证据达到E2。真实模型纵向创作与创造性非劣效仍等待E3/E4，不由工程绿测外推。
- DEC-041增量把章节唯一目录移到正文页，并为作者修改、重写、定稿、六类叙事图谱、主角当前状态/历史和安全公式建立生产入口；工程验证最高为E2，真实模型的自动状态抽取和长篇数值连续性仍等待E3/E4。
- DEC-049增量把聊天、剧情探索、定案、滚动规划、试写和正式生产拆成持久状态，并为4200字符主笔包、阶段结算选择和最佳稿回退建立工程门禁；确定性证据最多升级到E2，真实长篇创造性和文学质量仍等待E3/E4。
- DEC-051增量将开书资料重新投影到全书框架，并为游戏/领主/经营题材提供软分类目录、公式用途分类和设定原文交给真实设定成员的入口；候选仍需作者确认。工程验证为E2，不外推真实模型拆解质量。
