# 下一批全平台功能模块与视觉升级验收证据

> 批次日期：2026-08-23
> 基线提交：`61cb87b227c7c164c8f6edbffe7ba86b071d724d`
> 前置设计审查：`next-platform-rolling-storyline-pre-20260823`
> 后置设计审查：`next-platform-rolling-storyline-post-20260823`
> UI 边界：冻结原页面功能板块、位置、顺序和交互骨架；仅删除页面流程栏，新能力原位嵌入，手机两排导航保留。

## 逐编号追踪

| 清单编号 | 要求摘要 | 证据位置 |
| --- | --- | --- |
| 0.1.1 | 冻结本文件为本批次唯一执行清单，旧清单退出当前规格，不并行维护第二份清单。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.1.2 | 建立“需求—代码—接口—数据—测试—设计图—部署证据”追踪表，每一条需求都有唯一编号和证据位置。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.1.3 | 记录本批次全量验证触发条件：核心创作流程改变、数据库语义改变、ContextCompiler 和模型调用链改变，因此最终必须运行 `npm run verify:full`。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.1.4 | 记录高风险设计审查范围：账号/书籍隔离、作者正文不可变、故事线数据语义、ContextCompiler 权威来源、模型调用计费和生产迁移。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.1.5 | 在数据库和 ContextCompiler 方案实施前创建前置 `design_review_id`，完成后用真实迁移、隔离和调用证据做后置审查。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.1.6 | 明确本批次不删除作者正文、结算、已确认设定、历史故事线或历史模型调用审计；旧数据只能兼容读取、迁移映射或归档。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.1.7 | 冻结原页面功能板块、位置关系、内容顺序和操作骨架；除删除页面级流程栏外，不移动、合并、拆散或删除原板块，新功能只在原位嵌入。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.2.1 | 核对当前生产版本、Web/API/Worker 版本、数据库迁移号、静态资源入口和可回滚版本。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.2.2 | 核对设定、故事线、分卷、事件、章节、团队、资料库、任务和后台的真实页面、路由、接口、状态与空白态。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.2.3 | 核对现有 7 类岗位池、成员表、批次表、模型路由、Skill/模板版本、ContextPack 和调用日志，优先复用已经正确的结构。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.2.4 | 核对固定全书故事线、固定四阶段故事线板、拓扑选择器、前置故事线门槛和所有依赖它们的入口、测试与文档。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.2.5 | 核对全站流程栏实现与引用：`.v6-phase-line`、`StageTrack`、`V6_STAGES`、`.v6-stage-track`、对应 JSX/CSS/测试和删除后可能残留的空白占位。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.2.6 | 核对手机顶部两排导航的组件、断点、滚动和选中态；把它登记为必须保留的导航，不得误当流程栏删除。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.2.7 | 核对后台已有会员交易、用户、书籍、任务、错误日志和调用数据，分清可直接统计、需要补字段和目前根本不存在的数据。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.3.1 | 从候选提交构建只读对照站，确认它确实是老板认可的“原来视觉效果和排版”。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.3.2 | 为书架、登录/开书、设定、故事线、分卷、事件、章节/正文、团队、资料库、任务和后台关键页建立旧版截图档案。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.3.3 | 桌面固定采样 `1366×768`、`1440×900`、`1536×864`、`1672×940`、`1920×1080`。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.3.4 | 手机固定采样 `360×800`、`390×844`、`430×932`，同时记录顶部两排导航的真实高度、换行和可点击区域。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.3.5 | 对适用页面分别登记初始、工作中、等待 AI、失败、可恢复、完成、有内容和空白状态。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.3.6 | 导出旧版关键计算样式：字体栈、字号、字重、行高、字间距、内容宽度、栅格、间距、圆角、边框、阴影、颜色和按钮高度。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 0.3.7 | 记录旧版每页首屏有效信息量、唯一主操作、内容密度和留白比例，避免新版以“大空白+小字+卡片墙”造成退步。 | `HANDOFF.md`; `shots/baseline-61cb87b/`; `docs/design/next-platform/README.md`; production read-only inventory in this document |
| 1.1.1 | 每个阶段结束更新清单，不批量补勾、不凭口头判断勾选。 | this evidence matrix; `docs/NEXT_PLATFORM_MODULE_AND_VISUAL_DEVELOPMENT_CHECKLIST.md` |
| 1.1.2 | 任一失败项恢复为未完成，并记录失败原因、影响范围、修复提交和复测结果。 | this evidence matrix; `docs/NEXT_PLATFORM_MODULE_AND_VISUAL_DEVELOPMENT_CHECKLIST.md` |
| 1.1.3 | 功能完成但视觉退步、旧入口仍可达、旧代码仍有有效引用或证据不完整，一律不得勾选。 | this evidence matrix; `docs/NEXT_PLATFORM_MODULE_AND_VISUAL_DEVELOPMENT_CHECKLIST.md` |
| 1.1.4 | 所有 UI 页面在实现前登记设计图，在实现后登记同视口截图、差异图和人工评审结论。 | this evidence matrix; `docs/NEXT_PLATFORM_MODULE_AND_VISUAL_DEVELOPMENT_CHECKLIST.md` |
| 1.2.1 | 为上述页面登记旧版桌面/手机布局基线，并补充不改变板块位置的桌面/手机内容状态参考图。 | this evidence matrix; `docs/NEXT_PLATFORM_MODULE_AND_VISUAL_DEVELOPMENT_CHECKLIST.md` |
| 1.2.2 | 每张设计图标注内容来源、状态变化、空白态、错误态、主要操作、次要操作和不可显示字段。 | this evidence matrix; `docs/NEXT_PLATFORM_MODULE_AND_VISUAL_DEVELOPMENT_CHECKLIST.md` |
| 1.2.3 | 内容参考图若改变原功能板块、位置或风格则作废；实现以旧版布局为基准，不允许边编码边用临时样式凑合。 | this evidence matrix; `docs/NEXT_PLATFORM_MODULE_AND_VISUAL_DEVELOPMENT_CHECKLIST.md` |
| 2.1.1 | 未改造的稳定区域与旧版基线进行像素比对，稳定区域相似度达到 `95%`。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.1.2 | 已改造区域的外部几何、板块位置和内容顺序相对旧版达到 `95%`；新增内容只在原板块内部比对状态参考，有意差异单独遮罩并写明原因。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.1.3 | 每页同时出旧版、内容参考图、新版三联图；几何以旧版为准，新增状态以参考图为准，不用单张新版截图自证美观。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.1.4 | 功能自动化全部通过但视觉合同不通过时，本页仍判定失败。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.1.5 | 老板反馈“比原来难看、空、挤、薄或廉价”时，直接回到设计/样式修正，不用功能完成度抵扣。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.2.1 | 恢复并统一旧版正文、控件、导航的无衬线中文字体栈；品牌字和少量大标题才允许使用衬线字体。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.2.2 | 桌面正文和主要控件为 `14–16px`，辅助文字不得小于 `12px`，禁止 `8–11px` 承载功能信息。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.2.3 | 手机输入框、选择器和可编辑区域字号不得低于 `16px`，避免系统自动缩放。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.2.4 | 中文正文行高控制在 `1.65–1.8`，字间距控制在 `0–0.02em`；不用英文大间距制造“高级感”。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.2.5 | Windows、macOS、iOS、Android 字体回退均有截图验证，不因缺少某字体导致突然变粗、变窄或错行。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.2.6 | 标题、正文、辅助、禁用、错误、链接和数据数字形成清晰但不过度的层级。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.3.1 | 原版内容区宽度、左右呼吸感、对齐线和段落节奏作为最低基准；新版只为真实功能需要调整。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.3.2 | “更饱满”定义为信息更有用、上下文更完整、状态更周到，不是增加无意义卡片、边框、图标或装饰文案。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.3.3 | “更高级”定义为层级明确、比例成熟、对齐精确、颜色克制和交互稳定，不是堆渐变、重阴影和大圆角。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.3.4 | 同一屏最多一个视觉主操作；次要操作降级但仍可发现，危险操作有明确语义和保护。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.3.5 | 卡片只用于真实分组；连续阅读内容优先使用自然段、分隔线和留白，避免全站卡片墙。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.3.6 | 空白态提供下一步，加载态保留布局骨架，失败态显示可执行恢复动作，完成态不制造多余庆祝遮挡。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.3.7 | 按钮、输入框、抽屉、对话框、标签、表格和任务状态统一 token，不允许页面私自发明一套视觉。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.4.1 | 任一维度不得低于旧版对应维度。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.4.2 | 总分不得低于旧版；宣称“升级”的页面总分必须高于旧版。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.4.3 | 设计评审记录评分人、截图、差异、修正和复核日期。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 2.4.4 | 视觉验收不过，不得进入生产部署项。 | `shots/baseline-61cb87b/`; `docs/design/next-platform/*.png`; browser/visual records below |
| 3.1.1 | 作者端设定、故事线、分卷、事件、章节全部删除“开书资料 → 设定库 → 逐项设计 → 主编审查 → 完成”一类圆点连线流程栏。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.1.2 | 资料库、取名、团队、任务、灵感、设置和独立后台同样不得出现阶段柱、横向步骤线或页内伪导航。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.1.3 | 删除 `.v6-phase-line`、未使用的 `StageTrack`/`V6_STAGES`、`.v6-stage-track` 及对应样式、测试和导出。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.1.4 | 不用面包屑、顶部进度卡、第三排导航或另一套步骤条替换被删除流程栏。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.1.5 | 删除后回收首屏高度，页面标题、当前内容和主操作自然上移，不留下空容器或异常留白。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.1.6 | 任务卡内部反映真实模型执行的局部进度可以保留，但必须与页面级流程导航在结构和视觉上明确区分。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.2.1 | 桌面导航延续旧版成熟的字体、间距、选中态和视觉重量，不为新模块整体降级。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.2.2 | 手机严格保留现有顶部两排导航，不增加第三排，不把关键功能藏进只能猜到的手势。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.2.3 | 两排导航在 `360/390/430px` 下无截断、重叠、意外换行和小于 `44×44px` 的核心点击区域。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.2.4 | 页面标题、书籍上下文、保存/任务状态就近显示，不再依靠流程栏传递当前位置。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 3.2.5 | 键盘导航、焦点环、Esc 关闭、抽屉焦点锁定和屏幕阅读标签完整。 | `CoreWorkflowWorkspace.tsx`; `V6Shared.tsx`; `app.css`; `core-workflow-v6.css`; workspace UI tests; zero-reference log |
| 4.1.1 | 顶部不显示任何流程栏，保留简洁书籍上下文、页面标题和真实保存/任务状态。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.1.2 | 主内容区突出当前设定任务：问题、为什么现在需要、已有事实、可编辑答案、AI 建议和确认状态。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.1.3 | 主操作按真实状态变化为“开始设计当前设定”“确认当前设定”或“请主编审查”，不能同时争抢。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.1.4 | 已完成设定、待补设定和建议设定用清晰轻量列表组织，不堆成等权卡片墙。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.2.1 | 在设定页设置轻量“主角基础”区域，显示姓名/身份、核心目标、当前处境和主角性格。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.2.2 | 主角性格必须清晰可见、可进入编辑，不得藏进宏观世界设定或从作者端消失。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.2.3 | 开书时的主角信息是初始来源；进入正式创作后，版本化 `CharacterCard` 是当前权威。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.2.4 | 对开书蓝图与当前人物卡差异提供来源说明和安全更新，不静默覆盖作者确认内容。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.2.5 | 主角摘要只提供必要上下文，不挤占当前设定任务主位；完整人物资料进入资料库查看。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.3.1 | AI 只针对当前设定任务提出候选，明确标为建议；作者未确认前不得写入硬事实。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.3.2 | 作者可编辑、拒绝、重试、换成员或追加同岗位成员独立出方案。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.3.3 | 候选显示证据来源、成员身份、生成时间和适用范围，不显示底层模型名。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.3.4 | 上游已确认版本变化时，依赖旧版本的候选明确失效并可重新编译，不能继续混用。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.3.5 | 设定确认写入版本化权威对象，并为后续分卷、事件、章节和 ContextPack 提供稳定引用。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.4.1 | 桌面首屏相较旧版不降低字体、密度、质感和有效信息量，改造稳定区域/设计图相似度达到 `95%`。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.4.2 | `360/390/430px` 下保留两排导航，主角基础、当前任务和主操作顺序正确，无横向滚动。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.4.3 | 初始、生成中、候选、失败、换人、确认、全完成状态均完成浏览器验证。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 4.4.4 | 主角性格在旧书、新书和历史数据迁移书籍中均可见且来源正确。 | `CoreWorkflowWorkspace.tsx`; `core-workflow-v6-service.ts`; character-card contract/routes; opening and workspace UI tests |
| 5.1.1 | 全书故事线和全书结局永远不是开书前置必填项，作者可以零故事线直接设计第一卷。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.1.2 | 作者可以只确认目前想到的阶段，例如“第十卷完成宗门复仇”，而全书结局和其他故事线继续留空。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.1.3 | 系统允许第一卷、第二卷甚至更久只有半条故事线；“不知道”是合法状态，不显示为缺陷或待办警告。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.1.4 | 故事线随正文和卷结算增长，正文事实优先；规划描述未来，结算只记录实际发生，两者永远分开。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.1.5 | 主编只推荐下一段看得见的范围，默认下一卷至未来两卷；证据不足时允许建议“继续观察”。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.1.6 | 已经有完整想法的作者可以直接录入一条或多条全书故事线，由 AI 补全表达和检查衔接，但仍由作者逐项确认。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.1.7 | 只有开局灵感的作者可以跳过故事线；系统不得在第一卷或第二卷结束时设置“必须形成全书故事线”的硬触发点。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.1.8 | 作者可在任意事件或卷后主动提炼、延长或新建故事线；系统提醒只作为非阻塞建议，作者可以延后处理并继续写作。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.2.1 | “已经发生”只读展示正文和结算确认事实，可追溯到卷/事件/章节证据。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.2.2 | “正在推进”展示活跃故事线的真实现状、最近推进、当前压力和最后证据。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.2.3 | “我目前想到这里”只保存作者明确确认的最远节点，不要求结局。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.2.4 | “主编推荐下一段”展示 2–3 个真正不同的候选方向或“继续观察”，不自动生效。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.2.5 | “还没决定”保存开放问题、未知结局和待观察矛盾，不被系统擅自补齐。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.2.6 | 五区使用不同来源标签和视觉层级，作者确认、正文事实与 AI 猜测不得混淆。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.3.1 | 卷结算确定性更新与事件/章节显式关联的现有故事线实际进度。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.3.2 | 系统从正文发现跨事件持续推进的矛盾、关系或目标时，只生成“潜在线路候选”。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.3.3 | 候选必须列出正文证据、连续性理由、可能类型、未知点和误判风险。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.3.4 | 作者确认后才创建正式故事线；拒绝只记录决策，不污染事实库。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.3.5 | 重试保持幂等，同一卷同一证据不重复推进、不重复建线、不重复扣费。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.3.6 | 卷结算变化时，受影响候选失效并按新结算重编译；已确认事实通过新版本修订，不原地篡改。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.4.1 | 每个推荐说明从哪些正文事实自然延伸、主角为什么继续卷入、下一段核心问题和可能推动的已有线。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.4.2 | 明确哪些是推断、哪些尚未发生、是否可能长出新故事线。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.4.3 | 方向之间在目标、冲突或代价上真正不同，不做同义改写假装多方案。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.4.4 | 作者可以选一个、编辑后确认、全部拒绝或选择“继续边写边看”。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.4.5 | 选择推荐只形成作者规划版本，不冒充正文已经发生，也不自动锁死更远卷。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.5.1 | 零故事线、单条半线、多条活跃线、有阶段终点无全书结局、完全规划型作者五类场景均可继续创作。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.5.2 | 桌面五区不做五张等权大卡，采用阅读优先的主次布局；相似度和视觉评分通过。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.5.3 | 手机按当前决策顺序纵向组织，顶部仍只有两排导航，候选证据可展开但不淹没主操作。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 5.5.4 | 页面没有固定拓扑选择器、固定四阶段故事线板、全书完整度进度条或强迫补结局的文案。 | `0068_rolling_storyline_growth.sql`; `core-workflow-v6-service.ts`; `settlement-follow-up-pipeline-service.ts`; storyline API/UI/domain tests |
| 6.1.1 | 每次创建下一卷都明确展示“上卷实际结果 → 新状态 → 未解决压力 → 主角选择 → 本卷目标 → 受影响故事线”。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.1.2 | 因果桥只读取已确认结算和作者确认规划，不把 AI 候选当作事实。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.1.3 | 作者可以修改本卷方向而不需要先补全全书路线；修改形成新版本并让依赖候选失效。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.1.4 | 第一卷没有上卷结算时使用开书蓝图、主角当前处境和已确认设定作为起点。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.2.1 | 事件明确服务本卷目标、角色选择和一个或多个故事线，但允许存在只承担节奏/关系功能的事件。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.2.2 | 当前事件显示前置状态、冲突、人物动机、预期变化和不可越过的已确认事实。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.2.3 | 事件完成只结算实际写出的结果；未写出的计划自动保留为未发生或失效，不混入事实。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.2.4 | 事件修改、删除、归档和重新排序不破坏已定稿正文的历史引用。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.3.1 | 章节页同时维持完整章链、近期详细章纲、当前正文、事实/文学/体验三席审查和章节结算的清晰主次。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.3.2 | 每章只向当前任务提供最小充分 ContextPack，不把全书资料无差别塞入上下文。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.3.3 | 正文采用不可变完整版本；修改产生新版本，审查和结算固定引用具体版本。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.3.4 | 单席失败可单独重试或换人，其他成功结果保留；融合时来源可追溯。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 6.3.5 | 章节、事件和卷结算依次汇总真实发生，并为滚动故事线提炼提供结构化证据。 | `VolumeLineOrchestration.tsx`; volume/event/chapter pipeline services; volume/event/chapter tests |
| 7.1.1 | 产品、数据库种子、后台、作者端、测试和文档全部统一为“7 类岗位、初始 25 名成员”，不得写成 25 种岗位。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.1.2 | 25 只是初始后台配置，不写死上限；验证管理员能增加第 26 名及更多成员。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.1.3 | 每名成员独立绑定供应商和模型，任务开始时冻结成员、供应商、模型、Skill、模板和 ContextPack 快照。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.1.4 | 后台改绑只影响新任务；运行中任务和历史记录继续使用冻结快照。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.2.1 | 作者只选择 AI 成员，不直接选择供应商或模型。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.2.2 | 作者端只显示头像、姓名、岗位、供应公司、消耗等级和工作状态。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.2.3 | 作者端不得显示模型名、“擅长领域”、速度、成功率、内部 ID 或路由细节。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.2.4 | 每个 AI 节点默认自动分配一名符合岗位要求的成员；作者可更换或追加同岗位成员独立出方案。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.2.5 | 同岗位同批次成员收到完全相同的作者输入、ContextPack ID/哈希、节点 Skill 和模板版本，保证公平比较。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.2.6 | 多成员输出相互隔离，在作者选择或副编融合前不得互相看到。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.2.7 | 闲置、未选、被替换和未开始的成员不调用模型、不产生模型消耗。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.3.1 | 副编是作者可见成员，负责局部整理、融合和执行性检查，可被选择、替换和追加。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.3.2 | `ContextCompiler` 是不可见系统服务，只负责编译权威资料包，不显示头像、状态、发言或成员 Skill。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.3.3 | 小文秘书只承担确定性工具、导航和故障回执，不伪装为创作成员。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.3.4 | 同一模型不得伪装成多个独立模型完成需要异模型独立复核的任务。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.4.1 | 团队页先显示 7 类岗位和在岗概况，再按需展开真实成员，不把 25 人同时铺成拥挤头像墙。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.4.2 | 成员卡密度、头像比例、状态、供应公司和消耗等级均符合旧版视觉下限。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.4.3 | 手机成员选择使用清晰抽屉/列表，保留顶部两排导航，不出现横向小卡难点选。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 7.4.4 | 空闲、工作中、等待、失败、停用和不可选状态均有明确视觉与无障碍文本。 | `agent-team-v2.ts`; `team-template-service.ts`; `EditorialTeamWorkspace.tsx`; `twenty-five-member-team.test.ts` |
| 8.1.1 | 建立“核心创作 Skill + 7 类岗位 Skill + 节点 Skill”结构，不为 25 名成员复制 25 套岗位 Skill。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.1.2 | 更新主编 Skill：判断证据、推荐下一至两卷、允许继续观察、不得擅自补全全书结局。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.1.3 | 更新副编 Skill：整理局部资料、对齐不同方案、保留分歧与来源，不代替 ContextCompiler。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.1.4 | 更新编剧 Skill：从当前已知边界设计卷/事件/章链，保持因果但不锁死远期。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.1.5 | 更新主笔 Skill：严格区分计划与事实，按当前章最小充分资料写作。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.1.6 | 更新事实、文学、体验审查席 Skill，分别约束连续性、文学完成度和读者体验，避免职责同质化。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.1.7 | 增加故事线提炼、潜在线路识别、阶段终点、下一段推荐、因果桥和结算投影等节点 Skill。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.2.1 | 修改开书模板：故事线/结局可空，只有开局灵感也能完成。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.2.2 | 修改设定模板：主角性格回到可见主角基础，设定候选不得自动写入硬事实。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.2.3 | 修改分卷、事件、章纲、正文、三席审查、章节/事件/卷结算模板，使规划与实际字段分离。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.2.4 | 修改故事线模板：支持零线、半线、阶段结局、多线未知和继续观察。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.2.5 | 提示词只要求模型输出当前节点需要的信息，禁止用“完整全书”“最终大结局”作为默认必答项。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.2.6 | 所有结构化输出有 schema 校验、白话错误提示和安全降级，不把解析失败内容直接入库。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.3.1 | `ContextCompiler` 继续作为唯一资料包编译权威，明确每个节点允许读取的对象、版本、字段和排序。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.3.2 | 已确认正文事实、结算、作者规划、开放问题和 AI 候选分区编译，候选永远不能进入硬事实区。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.3.3 | 同批公平比较固定相同 ContextPack ID/哈希、作者输入、Skill 和模板版本。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.3.4 | 记录资料来源和截断策略，敏感信息、API Key、模型思维链不得进入 ContextPack 或日志。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.3.5 | 上游权威版本变化时确定性失效下游候选；重试和恢复使用明确版本，不静默拼接旧包。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.4.1 | 后台展示 Skill 名称、版本、哈希、适用岗位/节点、状态和安全可读内容。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.4.2 | 后台能从任务追溯到成员快照、Skill、模板、ContextPack、供应商/模型内部路由和调用结果。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.4.3 | 作者端只显示成员和必要来源，不暴露内部提示词、模型名、密钥、思维链或完整资料包。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 8.4.4 | Skill/模板/提示词发布有版本、灰度、回滚和新旧任务边界。 | `agent-skills-v6.ts`; `creative-templates-v6.ts`; `context-pack-service.ts`; role/context/batch tests; admin governance UI |
| 9.1.1 | 设计版本化故事线、实际推进记录、作者最远节点、开放问题、AI 候选、作者决策和证据引用。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.1.2 | 评估是否新增增长轮次/候选/决策表；能复用现有权威对象时不重复造表。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.1.3 | 历史固定故事线映射为可读版本，原始数据保留；不得为迁移方便删除作者内容。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.1.4 | 对卷结算投影、候选创建和作者确认建立幂等键、唯一约束和并发保护。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.1.5 | 规划、事实、候选和失效原因均能追溯到 owner/book/object/version。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.2.1 | 所有核心查询和写入携带已验证会话的 `owner_id`、`book_id`，客户端传入身份不能成为权威。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.2.2 | 增加或调整故事线五区、卷结算提炼、主编推荐、成员选择、后台指标和故障定位 API。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.2.3 | API 明确区分事实、作者确认和候选状态；越权、版本冲突、候选失效和重复提交有稳定错误码。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.2.4 | 日志和错误响应不泄露 API Key、完整提示词、模型思维链、跨书内容或敏感个人信息。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.2.5 | 新旧 Web/API/Worker 在滚动发布期间保持向后兼容。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.3.1 | 迁移前做数据量、空值、重复、外键、历史版本和回滚可行性预检。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.3.2 | 迁移具备可审计的前滚和回滚方案，先在生产副本或等价数据量环境验证。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.3.3 | 新书、历史完整故事线书、只有阶段终点的书和零故事线书迁移后均可继续创作。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.3.4 | 构造两个用户、两本书交叉访问测试，核心对象、候选、资料包、任务和后台授权跨书污染为零。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 9.3.5 | 正文不可变版本、已确认结算和成员调用审计在迁移前后哈希一致。 | `0068_rolling_storyline_growth.sql`; core routes/contracts; migration/security/portability tests |
| 10.1.1 | 显示累计注册普通用户、累计付费普通用户、累计付费率和近 30 天首付费率。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.1.2 | 累计付费率定义为“累计产生过有效会员交易的去重普通用户 ÷ 累计注册非管理员用户”。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.1.3 | 近 30 天首付费率定义为“近 30 天新注册且在窗口内首次产生有效会员交易的普通用户 ÷ 近 30 天新注册普通用户”。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.1.4 | 免费、铜牌赠送/测试账号和管理员按已确认业务规则排除；分母为零显示 `—`，不显示误导性 `0%`。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.1.5 | 收入指标命名为“已记录会员收入”，汇总不可变会员交易金额；不得冒充“支付平台实收”。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.1.6 | 后台明确注释：当前未接支付平台回调，真实实收、退款和渠道对账属于未来独立付费接入项目。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.2.1 | 用户列表显示会员、注册/最后活动、书籍数、今日任务、今日失败和安全的经营摘要。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.2.2 | 用户详情显示已创建书籍总数、活跃/归档数量和书籍列表。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.2.3 | 每本书显示状态、当前创作阶段、当前卷/事件/章节、最新正文/结算活动和最近任务。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.2.4 | 管理员可以从用户进入书籍、从书籍进入任务、从任务定位失败节点，但不得绕开后台权限审计。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.2.5 | 永久删除作者数据仍需影响预览、输入 `YES` 和二次确认；普通管理优先归档。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.3.1 | 用户详情明确回答“今天有没有任务失败、失败在哪里、是否恢复”。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.3.2 | 失败位置至少包含用户、书籍、任务、工作流节点、AI 成员、前端页面、发生时间、安全错误摘要和恢复键。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.3.3 | 多成员任务区分哪一席失败、哪些结果已经成功保留，支持只重试失败席。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.3.4 | 错误摘要隐藏密钥、完整提示词、原始模型思维链和其他用户内容。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.3.5 | 今日范围按后台统一时区计算，并可切换日期审计，避免零点重复/漏计。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.4.1 | 展示 7 类岗位、初始 25 名和后续新增成员的启停、供应商/模型内部绑定、消耗等级与任务状态。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.4.2 | 展示 Skill、模板、提示词、ContextPack、批次公平性、调用和恢复链路。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.4.3 | 能验证闲置成员零调用、同批同包、任务快照冻结和后台改绑只影响新任务。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 10.4.4 | 后台 UI 同样遵守无页面流程栏、字体和旧版视觉质量下限，不因为数据多而退化为拥挤表格。 | `admin-console-routes.ts`; `AdminPages.tsx`; admin API/CSS; independent-admin tests |
| 11.1 | 每个 AI 节点具备待开始、排队、运行、部分成功、失败、可重试、已恢复和完成状态机。 | `ai-node-batch-service.ts`; `ai-node-pipeline-service.ts`; settlement pipeline; batch/recovery/admin tests |
| 11.2 | 任务创建、模型调用、结果落库、作者确认和结算投影使用幂等键，重试不重复扣费或重复写事实。 | `ai-node-batch-service.ts`; `ai-node-pipeline-service.ts`; settlement pipeline; batch/recovery/admin tests |
| 11.3 | 同批多人独立方案只对实际启动的成员计费；替换前未启动成员保持零调用。 | `ai-node-batch-service.ts`; `ai-node-pipeline-service.ts`; settlement pipeline; batch/recovery/admin tests |
| 11.4 | 失败时保存安全诊断、冻结快照和恢复键，不把部分输出误当完成结果。 | `ai-node-batch-service.ts`; `ai-node-pipeline-service.ts`; settlement pipeline; batch/recovery/admin tests |
| 11.5 | Worker 重启、超时、供应商错误、schema 解析失败、成员停用和上游版本变化均有恢复测试。 | `ai-node-batch-service.ts`; `ai-node-pipeline-service.ts`; settlement pipeline; batch/recovery/admin tests |
| 11.6 | 建立滚动故事线质量观测：候选采纳率、重复候选率、无证据候选率、错误事实混入率和作者“继续观察”选择率。 | `ai-node-batch-service.ts`; `ai-node-pipeline-service.ts`; settlement pipeline; batch/recovery/admin tests |
| 11.7 | 建立视觉运行观测：布局溢出、字体加载失败、前端错误、核心操作失败和移动端导航异常。 | `ai-node-batch-service.ts`; `ai-node-pipeline-service.ts`; settlement pipeline; batch/recovery/admin tests |
| 12.1 | 删除开书前强制故事线/结局的校验、引导、生成任务和不可跳过门槛。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 12.2 | 删除固定全书拓扑选择器、固定四阶段故事线板和默认生成完整全书骨架的活跃路径。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 12.3 | 删除全站流程栏、圆点连线、阶段柱、相关共享组件、样式、测试和空白占位。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 12.4 | 删除把 15 人或其他旧人数写死的成员列表、路由、文案、种子和测试；保留可扩展的 7 类/初始 25 人结构。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 12.5 | 删除作者端模型选择、模型名、“擅长领域”、速度和成功率等被新规则禁止的展示或接口字段。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 12.6 | 删除副编与 ContextCompiler 混用、系统编译器冒充成员或成员 Skill 的旧路径。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 12.7 | 删除绕过 ContextCompiler 的通用提示词拼接和把 AI 候选写入硬事实的旧路径。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 12.8 | 删除与当前规则冲突的旧测试、旧样式、旧文案和旧现行规格；历史迁移、只读解析器、审计快照按兼容需要保留。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 12.9 | 运行零有效引用扫描，证明旧组件、路由、变量、文案和 CSS 选择器不再被生产代码引用。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 12.10 | 对删除清单逐项记录替代实现、为何安全、数据是否保留和 Git 追溯提交。 | `artifacts/next-platform-20260823/zero-active-reference-scan.log`; Git diff; migration-only compatibility declaration below |
| 13.1.1 | 故事线零/半/阶段终点/多线/完整规划五类单元和集成测试通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.1.2 | 卷结算投影、候选证据、确认/拒绝/继续观察、失效、并发和幂等重试通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.1.3 | 下一卷因果桥、事件结算、章节结算和故事线推进端到端通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.1.4 | 7 类/25 人种子、第 26 人新增、成员更换/追加、同包公平、输出隔离、闲置零调用通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.1.5 | 副编可见、ContextCompiler 不可见、任务快照冻结和历史调用回放通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.1.6 | 后台付费率公式、30 天窗口、已记录会员收入、用户书籍数和今日失败定位通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.1.7 | 两用户两书隔离、越权、不可变正文、迁移前后哈希和日志脱敏通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.2.1 | 设定、故事线、分卷、事件、章节、团队和后台关键用户旅程通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.2.2 | 全站无页面级流程栏，手机两排导航保留；桌面/手机无空白占位和错误跳转。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.2.3 | 键盘、触控、焦点、屏幕阅读、缩放至 `200%` 和减少动画偏好通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.2.4 | 加载、空白、等待 AI、部分成功、失败、恢复、完成和历史数据状态通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.2.5 | Web 类型检查、相关组件测试和生产构建通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.3.1 | 对第 0 项全部桌面与手机视口生成旧版/设计图/新版三联图和差异图。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.3.2 | 未改稳定区相对旧版达到 `95%`，新功能稳定区相对登记设计图达到 `95%`。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.3.3 | 七项人工视觉评分无一项低于旧版，总分符合升级要求。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.3.4 | 字体、密度、留白、按钮质感、颜色、长文本、滚动、弹层和失败态人工检查通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.3.5 | 桌面稳定区域视觉未达标或手机顶部两排导航被破坏时，整批不得通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.4.1 | 用真实模型验证零故事线开书、卷末提炼、阶段终点和继续观察，不只验证字段存在。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.4.2 | 对同岗位多人公平输入校验 ContextPack/Skill/模板哈希一致，检查输出确实独立。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.4.3 | 检查主编推荐有正文证据、因果链和真实差异，不强行编造全书结局。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.4.4 | 检查设定、卷、事件、章纲、正文、审查和结算的事实连续性与文学可用性。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.4.5 | 本批次默认不强加 20/200 章超长验收；若真实探针暴露长期问题，再按证据扩展。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.5.1 | 所有受影响包的定向测试、类型检查、构建、迁移和浏览器验证先通过。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.5.2 | 运行 `npm run verify:full`，完整保存命令、提交、时间、环境、退出码和日志摘要。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.5.3 | 全量失败逐项修复并重新运行；不得用“与本次无关”跳过未知失败，除非有可复查隔离证据和老板明确接受。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 13.5.4 | 清理旧代码后再次运行零引用扫描、相关测试和 `verify:full`，证明删除没有破坏新闭环。 | `artifacts/next-platform-20260823/verify-full-*.log`; targeted tests; real model and visual records below |
| 14.1.1 | 每阶段登记产物版本、迁移号、Git 提交、回滚版本、健康检查和负责人。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.1.2 | 数据库备份、迁移预检和回滚演练通过后才能发布迁移。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.1.3 | API/Worker 发布前在途任务连续 30 秒为零并立即复核；不取消、暂停或改写作者任务制造窗口。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.1.4 | 服务逐个切换并检查健康、队列、错误率、模型调用、幂等和日志脱敏。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.1.5 | Web 在暂存目录构建，保留旧哈希资源，原子切换入口，不为静态发布重启 API/Worker。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.2.1 | 验证首页、登录、书架、历史书、新书和核心创作页面可达。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.2.2 | 验证零故事线第一卷、卷结算提炼、主编推荐、作者确认和下一卷因果桥。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.2.3 | 验证成员选择/追加/替换、失败席重试、闲置零调用和后台调用追溯。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.2.4 | 验证付费率、已记录会员收入、用户书籍和今日失败位置。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.2.5 | 在生产域名重做 `360/390/430px` 和全部桌面稳定视口截图，与设计/基线再次比对。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 14.2.6 | 观察生产日志、队列、前端异常和数据库指标；异常优先回滚，不在生产边猜边改数据。 | production deployment record below; `docs/DEPLOY.md`; release archive and server health evidence |
| 15.1 | 第 0–14 项全部逐项实现、核查、测试并有证据地勾选，没有遗漏或模糊的“基本完成”。 | final checklist counts, final verify log, production smoke and release record below |
| 15.2 | 滚动故事线、设定页、分卷—事件—章节—结算、7 类/25 人团队、Skill/模板/提示词/ContextPack 和独立后台形成真实闭环。 | final checklist counts, final verify log, production smoke and release record below |
| 15.3 | 新 UI 的功能模块完成，旧版字体、排版、密度和质感没有退步；双基准相似度和人工视觉评审通过。 | final checklist counts, final verify log, production smoke and release record below |
| 15.4 | 全站页面级流程栏全部消失，手机现有顶部两排导航保持稳定。 | final checklist counts, final verify log, production smoke and release record below |
| 15.5 | 所有被替代的旧代码、旧入口、旧样式、旧测试和冲突现行文档删除，零有效引用扫描通过。 | final checklist counts, final verify log, production smoke and release record below |
| 15.6 | 作者正文、确认结算、历史数据、账号隔离、密钥和调用审计安全门禁全部通过。 | final checklist counts, final verify log, production smoke and release record below |
| 15.7 | `npm run verify:full` 在最终清理后的提交上通过。 | final checklist counts, final verify log, production smoke and release record below |
| 15.8 | 生产部署、核心冒烟、视觉复核和监控观察通过，回滚版本可用。 | final checklist counts, final verify log, production smoke and release record below |
| 15.9 | 最终报备逐项回答：功能是否全部完成、无用代码是否删除、前端 UI 是否更新、全部测试是否通过、是否部署上线，并附版本、提交、迁移、验证与截图证据。 | final checklist counts, final verify log, production smoke and release record below |

## 当前清单状态

- 已完成并有证据勾选：204/260；待官方浏览器视觉、生产真实模型与部署验收：56/260。

## 实现与清理证据

- 滚动故事线：0068 新增结算投影回执、作者边界、开放问题、增长轮次/候选/决策和创作模板版本；事实、作者规划、候选分区，候选采纳/编辑采纳/拒绝/继续观察均有幂等边界。
- 设定：保留原“开书资料—完整设定库”板块与顺序，在原开书资料内部补回主角性格、目标、处境和版本化 CharacterCard 编辑入口。
- 25 名成员：7 类岗位初始 3/3/5/5/3/3/3，可新增第 26 名；作者端只显示成员公共字段，同批资料包/Skill/模板哈希一致，未启动成员零调用。
- 后台：新增累计/30 天付费率、已记录会员收入、用户书籍、按日期任务失败定位、Skill/模板/ContextPack/调用治理和故事线质量指标。
- 旧代码：页面流程栏、固定拓扑前端/API/契约/活跃查询、旧人数测试与作者端禁显字段均为 0 个生产引用。历史 `book_storyline_topology_versions` 表只保留在 0065 迁移中，不删除作者历史数据。

## 测试记录

- 清理前 `verify:full`：`VERIFY_EXIT=0`；189/189 测试文件、814/814 用例通过；Contracts/API/Worker/Web 类型检查与生产构建通过。日志：`artifacts/next-platform-20260823/verify-full-pre-cleanup-pass.stdout.log`。
- 旧拓扑活跃读取清理后：contracts 构建、测试类型检查、5 个受影响测试文件、31 个用例通过。
- 最终清理后 `verify:full`：`VERIFY_EXIT=0`；189/189 测试文件、814/814 用例通过；Contracts/API/Worker/Web 类型检查与生产构建通过。日志：`artifacts/next-platform-20260823/verify-full-final.stdout.log`。

## 视觉与浏览器记录

- 旧版基线：`shots/baseline-61cb87b/`，共 91 张截图，覆盖 1366/1440/1536/1672/1920 桌面与 360/390/430 手机视口；计算样式见 `computed-styles-1440.json`。
- 内容状态参考：`docs/design/next-platform/*.png` 与 `README.md`；参考图只约束新增语义，不改变旧布局。
- 新版同视口截图、95% 差异与人工评分：待官方浏览器通道恢复并实际完成后填写，未完成前相关清单不得勾选。

## 真实模型记录

- 既有七岗位订阅探针成功记录：`docs/NEXT_CORE_WORKFLOW_DEVELOPMENT_CHECKLIST.md`（7/7、`cashCostCny=0`、无回答正文落盘）。
- 本批次重跑：严格订阅、现金回退关闭；当前 Windows 沙箱拒绝访问 Microsoft Store Codex CLI，首席调用在生成前中断，日志 `artifacts/next-platform-20260823/real-model-connectivity.log`。未恢复前 13.4 不勾选。

## 生产发布记录

- 发布前只读盘点：`47.243.152.159`；API/Worker/Caddy 均 active；线上 release `wm-v6-core-r1-20260823-035846-d98dc814`；数据库最新迁移 0067；无 working/queued/pending/waiting_confirmation 活动任务。
- 新发布、备份、迁移、原子切换、生产冒烟、回滚版本：待最终部署后填写。
