# 文秘写作交接笔记（HANDOFF）

> 新对话第一句话："读 HANDOFF.md，我们继续"。本文件是当前开发状态的唯一速查入口，随每次改动更新。
> 详细规则仍在 AGENTS.md；本文档只放"快速回到状态"需要的东西。

## 项目现状（2026-08-18 凌晨）

- 项目是**初始版本**：工作流程和前端 UI 都将大改。工作方式 = 老板逐页走查截图 → 讨论 → 修改 → 部署。
- 原则：**改到哪一页，顺手删掉死代码、同步改文档；文档只描述当前生效的功能**。老板说改什么就改什么，不多做；有必要的附带改动先问。
- 已上线：`https://wenmixiezuo.com`（阿里云香港 47.243.152.159，服务 wenmi-api / wenmi-worker，目录 /opt/wenmi，用户 wenmi）。
- 分支 `codex/desktop-entry`，远程 GitHub `chuipaopao-web/wenmixiezuo`，每次提交后推送。
- Windows 部署打包必须 `git -c core.autocrlf=false -c core.eol=lf archive`：本机 `core.autocrlf=true` 会让 git archive 把全部文本转成 CRLF，迁移文件校验和与数据库记录不符导致生产启动崩溃（2026-08-19 已踩过；`.gitattributes` 已给 `*.sql` 加 `eol=lf` 兜底，但其他文件仍建议用该命令保持 LF）。
- 若服务反复启动失败被 systemd 节流（Start request repeated too quickly），先 `systemctl reset-failed wenmi-api wenmi-worker` 再 start。

## 最近完成的改动（最新在最上）

1. 预算上限提至2000万+融合/质检进度条+确认后自动收起（DEC-CURRENT-076）：老板实测设定融合全部失败+确认后页面没变化+融合无进度。① 根因=预算误卡：建书默认预算上限仍是早期 24 万 Token，老板的书已耗 21.7 万，融合预约 ~2.4 万即 BUDGET_EXHAUSTED；默认值改 2000 万（book-onboarding-service INSERT budgets），生产 5 本 active 预算已回填。② 进度条覆盖所有任务：主编融合（revisionRunning）与整份质检（auditWaiting）都改为醒目进度块+不定态进度条，融合期间收起方案区。③ 确认后自动收起：按 confirmedAt 判定轮次新旧——上一轮的方案/融合稿全部收起只留"已定稿+重新设计"入口，新一轮（createdAt>confirmedAt）照常显示；PlanningWorkspace 新增 confirmedAts 映射传入面板。④ 面板 20 秒自动续跑从方案任务扩到融合任务（failedAutoTaskId 统一取两类失败）。全量 729 绿、双端 typecheck 通过。
1. 讨论任务以目标为导向：缺席席位自动补发资料（DEC-CURRENT-075）：老板实测"主角处境"两人出方案、任务失败卡死。① 管线 collectGoalOriented——独立方案与交叉质疑都改"首轮并行+最多2轮自动补全（轮间15秒）"，每轮只召集缺席席位，成功席位检查点不陪跑；仍失败点名成员+原因，断点续跑同样只补缺席；补全轮 phase_key 带 :makeup-N 后缀绕开 model_calls 唯一约束。② 关键卡点修复——model-call-service begin 幂等去重原本把任何同输入重发都挡死（"拒绝重复调用"），补发根本发不出去；改为只认活着的调用（pending/working/awaiting_provider/succeeded），failed/interrupted 终结行放行，真正未知的 awaiting_provider 仍拦截不重复扣量。③ 前端兜底——提案任务失败 20 秒自动续跑一次+失败提示点名缺席成员。新增 discussion-makeup 集成测试（GLM 中断→自动补发→集齐三方案，其余两席零陪跑），全量 729 绿。
1. 输入法安全字数+开局结局300字+设定提示+设计进度条（DEC-CURRENT-074）：① 新建共享组件 features/shared/ImeSafeField.tsx（ImeInput/ImeTextarea，maxChars）——拼音 composition 期间不占字数不截断，落定才截，按码点计（emoji 不截半），弃用原生 maxLength；已替换全部作者向限长输入框（开书对话框、设定协作面板、设定清单自定义项、卷重点表达、作者原话、团队岗位要求、取名提示、整本导入）。② 开局/结局上限 100→300 字（前后端+测试同步）。③ 设定页提示"设定条目按需选择设计……只设计核心设定即可"，后按老板要求移到页面最上方成员栏下并改红字醒目样式。④ 团队设计进度条：单项改为醒目进度块"团队正在设计「条目名」"+不定态滑动条；队列条显示"已定稿 N/M 项"+确定性进度条。新增 ime-safe-field 测试 3 用例，全量 728 绿。
1. 提案席三编剧+模型换绑+任务红点+三席并行（DEC-CURRENT-073）：① 设定提案三席从文姬改为三名编剧（婉儿/红玉/幼薇），讨论管线席位指令补 third_screenwriter 分支，前端顶部常驻成员栏同步。② 模型按老板名单换绑：貂蝉→DeepSeek V4 Pro、西施→GLM 5.3、婉儿→DeepSeek V4 Pro、红玉→GLM 5.3、幼薇→Kimi K2.7、文姬→DeepSeek V4 Flash；注意 toCreativeProfiles 有两份副本（model-binding-service.ts 与 book-onboarding-service.ts），换绑必须同步改，否则建书校验"三编剧互异模型"失败。③ 任务红点修复（DEC-062 号称做过实际没生效）：根因是任务中心数据只在打开任务页才拉取；已改进入应用即拉+60秒轮询+事件流始终刷新，功能栏"任务"按钮加红点（在跑/卡住/有未看结果即亮），seen 工具上移到 shared/task-presentation.ts。④ 生成慢优化：讨论管线各席独立意见与交叉质疑从串行 await 改 Promise.all 并行（三席互不可见本就独立），耗时从"各席相加"降为"最慢一席"，失败席位重试可复用检查点。同步 10 处旧断言，全量 725 绿。

1. 开书标签软参考+本卷重点表达（DEC-CURRENT-072）：开书标签文案改为"参考方向、只影响基础设计、不限制死"；卷阶段不加二次选择——VolumePlanContent 新增 focusExpression（本卷重点表达一句短语，null=沿用全书调子），主编在卷方案中自动提炼、作者顺带确认（卷编辑器新增输入框，40字可留空）；composeStyleToneText 注入"软参考、不推翻全书基调、不当硬指标"说明，正文管线与妙玉找茬管线同步。测试 +2 用例，全量 725 绿。
1. 中断调用预算自动兜底（DEC-CURRENT-071）：复查发现兜底缺口——远程中断无结果的调用永久冻结预算，生产两本书 18 条预留 43.2 万 Token 卡死、33 个讨论任务失败。已加 sweepStaleInterruptedCalls：中断超 10 分钟无结果自动释放预留+标记 failed+记调和 discarded，无主预留一并释放；API 启动即巡检+每 5 分钟周期巡检；宽限期内保持冻结等人工调和，迟到结果仍优先按真实用量结算。部署门禁已写进 AGENTS.md。测试 +3 用例，全量 723 绿。
1. 管理后台三板块+用户侧不显示大模型（DEC-CURRENT-070）：后台（AdminWorkspace）新增算力消耗（GET /admin/usage：总量/按用户/按模型/30天趋势柱）与模型管理（GET/POST /admin/model-scheme：14 成员下拉选火山方舟模型，保存过白名单+四席互异校验后全量书收敛 reviseFuture，历史快照/在途任务不动；新迁移 0056 platform_model_scheme 单行表，新书写入与启动收敛统一读库存方案）。用户侧彻底裁剪：设置弹窗删"成员模型/书籍级模型绑定"两板块（只留主题/字体/运维）、团队页删"模型来源"、App.tsx 移除 capabilities/modelBindings；接口层 capabilities 对非管理员 profiles 置空、model-bindings 四路由与书籍 usage 加管理员门禁、任务详情对非管理员 provider/model 显示"创作服务"且 error_detail 过 sanitizeModelLeak（保留限流等可读原因，管理员看原始证据）。新增 admin-platform 集成测试 4 用例，迁移清单 3 处+SQL 边界白名单同步，全量 720 绿。
1. 标签库扩充为全网级（DEC-CURRENT-069）：16 分组三泳道从约 500 词扩到 1114 词（主 227/辅助 609/特质 278），起点/番茄/晋江/七猫高频标签全收录；同泳道零重复、跨泳道一词一家、不撞 subjects 题材词（校验脚本 scripts/ops/tag-library-check.mts 留档可复跑）；既有标签全保留、结构不变，taxonomy 升 2026-08-19-v11。同日补前端：标签库面板此前只渲染主标签+特质两泳道（辅助 609 词没进 UI，老板实测看不到新词），已改三泳道全量展示+搜索全覆盖；推荐升级智能搭配（已选标签同组搭配优先，上限 16）；两处测试版本串改常量、新增向导覆盖测试。全量 716 绿。
1. 清空全部老书（DEC-CURRENT-068）：老板拍板清理生产所有用户老书，按新流程重新建书。44 本（43 active+1 archived，约 40 个 owner）经正式 BookLifecycleService 先归档再永久删除；60 个用户账号全保留。执行前停服备份（整库 769MB+books/indexes 包，在生产 /opt/wenmi/data/backups/pre-purge-20260819/，可整体回滚）；LanceDB 孤儿投影与 imports 旧导入包一并清理。脚本留档 scripts/ops/purge-all-books.mjs。验证：books/agents/manuscripts 均 0、双服务 active、首页 200。
1. 首页空状态文案：改为"专业网文剧本设计平台：AI 团队帮您设计骨架、大纲、剧情，书写正文，订制化设计原创作品"（会员提示保留），已上线。
1. 审校改革（DEC-CURRENT-067）：老板拍板①异模型硬规矩放宽为四席互异（写手+事实/文学/体验三审，四个不同模型来源即可，不再六席互异）；②每章固定审校 4 席→3 席省 token（班昭/妲己/昭君，妙玉退出固定席改待命，约省 25% 审校 token）。妲己（文学审校）从 Coding Plan doubao-seed-code 改回 Agent Plan DeepSeek V4 Flash（066 第 2 款被取代；literaryReviewerCodingProfile 与 Seed Code 白名单全删，运行时不再有 Coding Plan 调用）；停用 MiniMax（066 其余部分）继续生效。妙玉按需找茬新功能：迁移 0055 chapter_challenger_reviews + 仓库/服务/管线/POST·GET 路由（任务类型 chapter_challenger_review），正文页"请挑剔读者找茬"按钮，结果只供参考不卡定稿、可重复发起、无正文 409；前端找茬卡片 3 秒轮询。三审报告仍是定稿硬门禁。应用层 SQL 全部下沉仓库层（过数据库边界契约）。测试同步 12 处+新增 2 用例，全量 715 绿。
1. 停用 MiniMax M3（DEC-CURRENT-066）：老板拍板停用（定性：不是完全能力不行，是它失控的思考习惯在关键时刻必掉链子=不可靠）。三席换绑——文姬（设定）→Kimi K2.7 Code、西施（副编）→GLM 5.3、妲己（文学审校）→**Coding Plan 的 doubao-seed-code**（Agent Plan 停用 MiniMax 后只剩 5 个模型，凑不齐主笔/副笔+事实/文学/体验/挑剔六席互异硬校验；doubao-seed-code 已实测接受 thinking 预算且直出文字，非换名伪装，可用 WENMI_ARK_CODING_PLAN_DOUBAO_CODE_MODEL 覆盖）。运行时 reviewer 槽改 Kimi；三处 toCreativeProfiles 同步（副编取 style_editor 槽 GLM）。存量书：启动迁移"订阅策略激活"判定扩展为双套餐（Agent+Coding），绑定不一致的 V2 书自动 reviseFuture 收敛，历史快照/在途任务冻结不受影响。适配器层保留 minimax 兼容（在途冻结快照仍可能调它）；ModelAdapterFactory 白名单放行 Coding Plan 文学模型。测试 7 处断言同步，全量 713 绿。
1. 热修·设定队列卡死根因（DEC-CURRENT-065）：老板实测设计到三四项必卡。生产证据全是 minimax-m3（副编西施）——thinking 块写 4.6-5.7 万字符、24000 输出 Token 全烧光、零可见文字，重试确定性复现。根因：DEC-053 统一六模型启用带预算思考时踩掉了 requiresVisibleOutput 里"MiniMax 任何用途关闭思考"的保护，且 16000 预算对 MiniMax 不生效。修复：thinkingField 对 minimax- 前缀恢复 disabled，thinkingTokenAllowance 对 minimax 归零（max_tokens 与预算冻结口径一致）；测试断言同步改为 disabled。已卡任务在任务中心点"继续重试"即可。全量测试 713 项全绿。
1. 标签选择加回开书信息（DEC-CURRENT-064）：开书向导第 2 步新增"本书标签"区块——已选 chips 可删、按分类+融合题材自动推荐 8-10 个（点标签加入、点 × 不再推荐且不回加）、"从标签库添加"面板（16 分组浏览+搜索），可留空不卡创建、最多 12 个，修改开书资料弹窗同组件老书可补选。推荐纯规则计算（分类 recommendedMainTags+题材包命中分组的主标签/特质泳道），不经 AI；标签只进资料包定调，不激活推荐设定包（DEC-063 不变）。设定资料包"主要标签/作品特点：未填写"残留改为有才渲染。新增向导回归测试（推荐加入/删除/不再推荐/搜索添加/提交链路）。全量测试 713 项全绿。
1. 设定页走修·五点（DEC-CURRENT-063）：① 悬疑调查乱推荐修复——根因是 blueprintSignals 把主标签/故事特质/自定义标签也计入题材包匹配，作者风格主标签选了"悬疑、推理"就激活悬疑包；已改为题材包只由分类（主要题材）和副题材决定。② 勾选持久化——设计勾选从页面内存改为按书存浏览器本地（wenmi-setting-checked-v1-{bookId}），刷新不丢（老板实测勾十几项变回 6 项的 bug）。③ 设计清单可查可删——队列条新增"设计清单"展开列表，核心项标"必谈"不可移出，其他项可单独移出并取消勾选。④ 按钮统一绿色——重新设计两处与清空全部设定改为与"确认整份设定"一致的绿色主按钮，删橙红警示色覆盖。⑤ 九条改造逐项复查确认全部落地。全量测试 712 项全绿。
1. 设定页大改造（DEC-CURRENT-062，九条+质检补充全落地）：① 建书不再自动召集 AI，只做清单初始化，作者自己点"开始设计"。② 已确认设定可重新设计——迁移 0053 加待定候选四列，新方案先挂待定不动正稿，确认才转正、旧稿进历史，卡片显示"新方案待确认"，面板入口为醒目"重新设计"大按钮。③ 清空全部设定——页底入口+YES 确认，有正文的书红色警告"新旧设定可能和已有正文前后矛盾"。④ 主编质检+定稿门禁——迁移 0054 质检报告表，定稿必须有覆盖当前内容的质检报告（sha256 指纹，改动即作废），硬伤须逐条勾"我已知晓，仍要保留"；质检由主编貂蝉承担不加人，正文不动，作者强留须放行；前端遇门禁自动发起质检+轮询+报告面板。⑤ 任务中心大白话标题（"设计故事内核"等）+红点（卡住常亮/状态变化亮）+重启/停止按钮。⑥ 设定页顶部常驻四席成员栏（貂蝉/婉儿/红玉/文姬仿真头像，工作中/待命）。⑦ 推荐设定按主题材优先排序。⑧ 设定页减负——删页头教学文案，核心默认展开、推荐折叠勾选、资料库勾选加入，"开始设计（共 N 项）"队列自动逐项召集、候选项停下等确认、可停下队列。⑨ 作者意见占比政策按 03:07 决定落进提案指令（设定层最多五成、卷/事件七成、必须遵守全执行）。全量测试 712 项全绿（含 7 处连带修复：迁移清单断言×3、服务层 SQL 挪仓库层、续写测试补质检报告、协作面板文案条件、卡片标题层级 h5→h4）。
1. 设定页四件套（DEC-CURRENT-061）：① 重新设计入口——`POST .../collaboration/restart` + `restart()` 命令，进行中拒绝、完成后全新一轮三席提案、同键去重；提案区与融合稿区各加入口按钮。② 提案指令加"在开书信息、作者原话和已确认前置设定之上推演，不另起炉灶"（依赖注入机制本就有，确认并补强）。③ 条目减负——删除与核心六问重复的旧条目 11 个（作品策划组 5、约束组 3、protagonist/motivation、era），前后端目录同步；selectRelevantConfirmedContext/CORE_PREFILL_SOURCES 保留旧键兼容老书；旧书已填内容的下架条目在页底"早期条目"折叠区只读展示。④ 已确认核心卡收起为一行摘要，点"查看 / 修改"看全文。⑤ 连带修复 DEC-059 误删的旧书 storyDirection 只读回退（信息页回退全书简介，编辑弹窗仍回显原值）。全量测试 707 项全绿。
1. 设定提案不越界（DEC-CURRENT-060）：老板发现"故事内核"讨论里三席滑向规则/节奏设计。提案指令新增边界——只回答本项当前问题，规则细则归"规矩与代价"、对手归"对立面"、剧情节奏归后续大纲，成员侧重只是角度不是搬别项内容；碎片也要求每条直接回答本项当前问题。
1. 开局/结局示范文案升级：开局示范演示处境+冲突+危机三要素，结局示范演示收场+成就+身份地位（标签说明同步改）。
1. 开书向导与设定页五项 BUG 修复（DEC-CURRENT-059）：① 开局/结局串字段——根因在 `book-profile-view-service.ts` 视图层把 storyDirection 拼接"开局：x。结局：y。补充"覆盖返回，修改弹窗回显污染存储，已改原样返回（生产存量只有一本测试书历史版本被污染，当前版本干净，无需修数据）。② 书名 IME 计数——拼音组合期间只更新不截断，落字后才限字数（composition 事件守卫）。③ 字数收紧——开局/结局各 100 字、自定义补充 300 字（向导三处、草稿层、合同三处同步），示范文案略加长。④ 信息页新增开局/结局/自定义补充条件展示区块，三字段空值防御。⑤ 设定协作面板已有设定原文/补充想法/修改意见三处统一限 800 字。测试 5 文件 40 项全绿，双端 typecheck 通过。
1. 作者想法分层比例政策（DEC-CURRENT-058）：老板定调——必须遵守=100%；设定层参考融合最多五成（已定）；卷纲/事件大纲最多七成；章纲/正文按指令直接执行。新增唯一政策来源 `apps/api/src/domain/author-idea-policy.ts`（PLANNING/EXECUTION 两条政策句）；卷纲管线、事件管线（独立+融合两路）、章纲管线（章序列骨架/细节/单章细化三处）均已注入；规划层附"参考想法基本没被采纳时要向作者交代一句"。正文不单独注入（经章纲合同与重写指令接收，本身是指令性质）。
1. 设定讨论三件套 + 生产实测修复（DEC-CURRENT-057）：① 作者想法强度落地——`author_planning_inputs.intent_strength` 此前在设定链路存而不用，现提案/融合资料包按强度渲染（必须遵守=不得冲突；仅供参考=成员以专业判断为主导，方案中符合作者想法的观点保持两到五成、最多一半）；前端"已有设定原文/补充想法"加"仅供参考/必须遵守"单选（默认参考），"让主编按意见修改"一律按必须遵守提交；`SettingCollaborationRepository.authorInputText` 改返 `{text, intent}`。② 碎片 3—6 条放宽为 4—8 条，要求独立成立、互不重复、合起来覆盖完整方案。③ 融合定稿精炼——落库 content 只写结论，核心项通常 80—150 字、最多 300 字，论证/举例/备选不进落库（留在面向作者说明），因为已确认设定会作为硬来源打进后续资料包（DEC-051④）。另确认：设定项可全部点"团队设计"，每项各自排队、同书同时只跑一个任务（task-service 按书互斥），不冲突。
1. 开书→设定提示词专业化（DEC-CURRENT-056）：① 设定提案深度解锁——单项候选从"80至220字"放宽为"200至400字、具体到能直接落地"，方案必须说清核心主张、靠什么让读者一直追下去（爽感/悬念/情感/成长及持续兑现）、和同类书的差异点，结尾一句话告诉作者这项设定以后写故事要抓住什么。② 开书首个三席任务文案修正——频道枚举渲染中文（男频/女频）、快照补回开局/结局两行、旧的"为什么值得写/探讨什么/独特体验"策划理念遗留三问替换为当前设定项实际问题＋追读与差异化要求（`buildKickoffInstruction` 新增 `firstSettingPrompt` 参数，调用处传 `settingGuidance?.prompt`）。③ 设定资料包摘要补开局/结局两行，故事方向为空渲染"未填写"（`setting-guidance-service.ts` 非续写分支；完整开书 JSON 注入不动）。④ 主编设定融合的面向作者说明要求大白话说清"好看在哪、写作时抓住什么"。
1. 质量文档体系清淤 + 提示词私货清理（DEC-CURRENT-055）：① 事实审查通用规则清除测试书私货——"H车道"条款与"版本更新次数≠录像场数"书内例子全部通用化；规则折旧机制写入治理规范第9节（事故补丁须写明来源、保持通用措辞）。② DESIGN_GOVERNANCE_AUDIT.md 从 569 行瘦到约 60 行，历史 DR 记录全部移出（Git 追溯），消除"11名成员"等过期事实污染。③ ROLE_PROMPTS.md 第4节输出上限列删除、唯一取值表指向 AGENT_SYSTEM.md 第8节；红玉/班昭更正为 GLM 5.3。④ DECISIONS.md 开始标注取代关系（039 预算口径已被 052/053 取代）。⑤ 上下文矩阵单一来源 LONGFORM_QUALITY.md §8.3，ROLE_PROMPTS §8.1 与 Skill 参考文件改指针。⑥ 删除白名单外残留文档 4 份（两份 REVIEW_REPORT、UI_WORKFLOW_REDESIGN_DISCUSSION、reference-deepseek-ui-proposal，零引用检查后删除）。
1. 开书向导加回开局/结局/自定义补充（DEC-CURRENT-054）：老板反馈删掉"故事怎么讲"后 AI 讨论设定缺方向。合同字段与资料包注入管线一直完好，只缺采集入口；现向导第 3 步新增"故事方向"可选区（开局一句话≤200字、结局一句话≤200字、自定义补充≤800字，全部可留空不卡创建；开局和结局要么一起填要么都留空，提交前前端成对提示）。修改开书资料弹窗是同一组件，旧书可补填；草稿格式向前兼容。信息页展示口径不变，标签库不回向导。新增回归测试（采集+成对校验+提交）。
1. 思考与输出预算从宽评估（DEC-CURRENT-053，完整取值表在 AGENT_SYSTEM.md 第 8 节）：思考预算 4,000→16,000 统一（当晚老板复核翻倍）；可见输出地板全部抬到 6,000（阶段抽卡/交叉质疑/普通成员/章审查主编汇总/章纲挑战/结算摘要）；资料包输入预算不动（注意力保护在输入侧）；不变量=max_tokens＝可见上限＋思考预算、八处冻结同步追加。

1. 回到火山方舟双套餐 + GLM 5.3 思考余量 + 讨论遗孤自愈：① opencodego 下线，`.env.production` 注释全部 WENMI_OPENCODEGO_*，改用 WENMI_ARK_AGENT_PLAN_API_KEY / WENMI_ARK_CODING_PLAN_API_KEY（Key 只在服务器环境变量，绝不进 Git/文档）；14 岗位 ×41 书全部迁回 volcengine-ark-agent-plan，红玉/班昭=glm-5.3（经 WENMI_ARK_AGENT_PLAN_GLM_MODEL 指定）。② 统一带预算思考——实测六个在役模型都接受 thinking={enabled,budget_tokens:4000} 且预算生效；disabled 反被 glm-5.3/kimi-k2.7-code 拒绝（400），不设预算时 minimax 会把 8000 输出 Token 全烧进思考块。适配器统一发送启用思考+4000 预算，max_tokens=可见输出限额+4000，八处预算冻结经 thinkingTokenAllowance 同步追加（否则结算端"实际用量超过冻结上限"拒绝）。③ 讨论遗孤自愈——崩溃窗口留下"讨论已 awaiting_boss、任务仍 working/queued"的遗孤，认领时反复抛"讨论任务状态与讨论阶段不一致"刷屏；executeClaimed 现在发现决定已存在时幂等补齐设定候选（upsert）并按既有决定收尾任务，不再重复模型调用。④ 在途任务冻结 opencodego 快照的 102 席已解冻（COALESCE 回退当前绑定）。⑤ 老板明确成员必须保留思考能力，预算制取代"glm 不加余量/minimax 关思考"的临时方案。⑥ 坏融合稿毒化重试修复——kimi 偶发 JSON 笔误（属性名少前引号）导致融合段校验失败，且旧代码会在重试时复用同一份坏输出死循环；现在新鲜输出走纠错重试、已存坏意见与同哈希历史调用都判无效强制重新生成。回归测试在 setting-collaboration.test.ts（遗留坏意见不得复用）。回归测试：glm-5.3 max_tokens 追加余量、minimax 全用途关闭思考（ark-plan-model.test.ts）、遗孤任务幂等收尾（discussion.test.ts）。决定见 DEC-CURRENT-052。
2. 设定页走修·三席撞模型修复 + 去机制文案：① 根因——`book-onboarding-service` 与 `legacy-book-upgrade-service` 的 `toCreativeProfiles` 都把 setting（文姬）映射到 style_editor（GLM 5.2），与编剧B红玉撞车，提案三席校验拦截导致设定页无法召集；已改为 reviewer（MiniMax M3），与 14 人合同一致。② 存量修复——`TeamTemplateService.repairSettingSeatModel` + 启动升级逐书检测：设定与编剧B同模型的书自动把设定岗位未来绑定改为独立模型（不影响运行中任务的冻结快照），幂等，确定性测试运行时跳过。③ 文案去机制化——删掉"编剧A（强冲突）编剧B（重因果）设定（规则严谨）…各自独立给出方案互相看不到"说明段（改显示"婉儿、红玉、文姬待命"），删除成员方案卡的立场标签，"请团队出主意"改"团队设计"，"异模型多席点评"改"团队分头点评"，团队页岗位职责与成员详情的"异模型/同一来源"说明、设置弹窗的"剧情席/冻结模型/零现金回退"措辞全部改大白话；后端 409 报错改为"团队正在休整，暂时没法开始设计，请稍后再试。"。新增回归测试（存量撞模型书启动自动修复+幂等）。
2. 前端 429 优化：`performRequest` 遇 429 自动延迟重试（2s/5s/10s，共 4 次尝试，尊重 AbortSignal 中止；429 的请求在限流闸门口就被拒、业务未执行，重试安全），仍失败才把"请求太频繁，请稍后再试"抛给页面；SSE 事件流被限流时重连间隔从 1 秒降到 15 秒（每秒重连会把自己持续锁在限流桶外），恢复后回到 1 秒。新增 `tests/foundation/api-client-rate-limit.test.ts` 3 项（自动重试恢复、节奏拉长后抛错、中止立即 AbortError）。
2. 热修·公网限流双 BUG：① Fastify 未开 `trustProxy`，Caddy 反代后所有访客在限流里都是 127.0.0.1，全网共享 100 次/分钟一个桶，正常翻页（设定页批量加载）就集体 RATE_LIMITED——已开启 `trustProxy`（服务只监听 127.0.0.1，唯一能到达的是本机 Caddy，安全）。② `@fastify/rate-limit` 会原样 throw `errorResponseBuilder` 的返回值，原实现返回普通对象无 statusCode，被全局错误处理兜底成 500 INTERNAL_ERROR（前端因此显示"请重新打开这本书"而不是"请求太频繁"）——已改为返回 `DomainError('RATE_LIMITED', …, retryable: true, 429)`。新增回归测试「公网限流按代理转发来的真实访客IP分桶，互不牵连」。安全测试 5 文件 18 项全绿。
2. 紧急热修·生产 API 启动崩溃：`TeamTemplateService.addMissingMembers` 的异模型校验原来要求补齐成员与**所有**现有成员模型不重复，而 14 人设计本身就允许跨岗位共享模型（主编貂蝉与编剧C幼薇同为 K2.7、编剧B红玉与事实审查班昭同为 GLM 5.2），导致 11 人旧书升级时抛"幼薇与现有成员模型重复"、wenmi-api/wenmi-worker 启动即崩（前端静态页 200 但登录接口空响应报 Unexpected end of JSON input）。已改为只校验编剧三角（lead/second/third screenwriter 两两异模型+禁豆包），新增生产场景回归测试（跨岗共享放行、编剧撞车仍拒绝）。测试 689 项全绿。
2. 批6·设定页新前端（手机端优先）+ 上下文编译：① 设定主页三层——核心设定卡组（必要徽章+状态胶囊+动作按钮）、题材包卡组（点条目直接进该项工作台）、全部类目（资料库搜索+加入本书+本书自定义），页头显示必要项进度。② 任意类目可直接讨论：`SettingGuidanceService.snapshotFor` 放开"只能是当前引导项"限制，点任意项即激活为讨论中并给三席提案。③ 讨论工作台按 mockups/setting-discussion.html 重做：三席方案卡带立场标签与可勾选碎片 checkbox，"按我的勾选融合"→主编融合稿段级展示（stitch 衔接段标绿），操作=确认这份/我再改改/退回重融/自己写一份/先留白；旧无碎片提案自动回退整份选用。④ 已确认设定项硬来源注入章管线写手资料包与审校冻结资料（`setting_confirmed_items`，仅已确认有内容项，逐条截断600字）。⑤ 手机端顶部功能栏两排六列（图标上文字下），书籍开关悬浮左侧；核心卡桌面3列/手机1列，方案卡桌面3列/手机堆叠。决定见 DEC-CURRENT-051。测试 164 文件 688 项全绿。
2. 批5·设定类目讨论管线 + 结构化输出：① 提案三席改为编剧A婉儿（爽点强冲突）、编剧B红玉（因果闭环）、设定文姬（规则严谨），三席两两异模型；主编不提案只融合，提案讨论由编剧A主持创建（任务仍挂主编租约）。② 提案合同结构化：answer+benefits+costs+fragments（3-6条可勾选碎片），解析失败以整份方案作单条 implicit 碎片兜底（`parseSettingProposalStructure`）。③ 新迁移 `0052_setting_discussion_fragments.sql`：`setting_proposal_fragments`（按提案落碎片）+ `setting_fusion_drafts`（融合稿含所选碎片与 fusionSegments 段级标记，fragment=勾选碎片/stitch=主编衔接，缺失校验失败）。④ 协作读模型 inspect 返回每份提案的 fragments 与最新 fusionDraft；synthesize 路由/客户端支持 fragmentIds 并校验归属当前讨论与设定项。⑤ 文姬默认模型 GLM 5.2 → MiniMax M3（避免与红玉在提案席撞模型）。决定见 DEC-CURRENT-050。测试 164 文件 687 项全绿。
2. 批4·设定页重构数据层（核心六问+版本链+旧数据预填）：① 核心六问成为任何题材的唯一必备项——故事内核 story-kernel、世界舞台 world-stage、主角处境 protagonist-situation、对立面 opposition、规矩与代价 rules-costs、边界与留白 boundaries-blanks（`setting-outline-profile.ts` CORE_SETTING_KEYS，`setting-outline-catalog.ts` 新增六条目）；题材包项全部转为建议，设定基线门槛只看核心六问。② 设定项版本链：迁移 `0051_setting_item_versions.sql`，每次确认（manual/guidance/discussion 三条路径）追加不可变版本，新增 `GET .../setting-outline-workspace/:itemKey/versions` 查询接口与前端 `fetchSettingOutlineVersions`。③ 旧数据预填：初始化核心项时按 `CORE_PREFILL_SOURCES` 固定映射把旧设定内容汇成「预填稿」写入空内容核心项，状态保持待讨论，绝不覆盖作者已有内容。④ 建书首个三席提案任务不再硬编码策划理念，自动绑定当前第一个核心项。⑤ 前端 `PlanningWorkspace.tsx` 加入核心六卡组做最小兼容（新版设定主页/讨论页在批6重做）。决定见 DEC-CURRENT-049。测试 164 文件 686 项全绿。
2. 批3·三合一融合合同 + 结算后续 + 题材简报层：① 主编融合卷纲/事件必须带 fusionNotes 三块（爽点怎么兑现/逻辑链怎么闭环/新鲜感来自哪里），缺块校验失败重试；卷纲与事件方案卡醒目展示。② 事件/卷结算完成自动发起 `settlement_follow_up` 任务（迁移 `0050_settlement_follow_ups.sql`）：主编貂蝉出节奏体检报告（总评/爽点与付费点/高潮间隔/压抑时长/恢复节拍/风险/建议），副编西施写大白话摘要；分步入库、可重试；结算本身仍是确定性聚合不依赖它。前端已完成事件（只读历史）与已完成卷页面展示「节奏体检与大白话摘要」卡，缺失可手动补做。③ 题材简报层：岗位不换身份，卷纲/事件/章纲(章链/细化/挑战)/正文/结算后续的提示词硬来源自动注入 `planning:genre_brief`（频道/分类/融合题材/标签/基调/节奏策略/目标读者，只取自已确认开书信息，解析失败省略）。决定见 DEC-CURRENT-048。
2. 批2·审查第四席 + 章纲挑战开放：妙玉作为正文审查固定第四席（challenger），与事实/文学/体验并行、互不读取、与写手异模型；面板席数泛化（14人新书=4席，11人旧书面板保持3席），迁移 `0049_review_challenger_seat.sql` 重建 review_reports 放宽角色枚举、review_panels 加可空挑剔读者冻结列；merge/完成/质量快照/重试门禁全部按面板实际席数校验。章纲挑战开放给作者指定红玉或幼薇（`challengerRoleKey`，默认红玉），禁止主方案编剧挑战自己；前端章链/单章各给两个「请红玉/幼薇看看」按钮并显示挑战者署名。团队页14人自动渲染，头像/简介补齐新岗位。
2. 批1·创作团队扩编 11→14：新增编剧C幼薇（脑洞/反套路，kimi-k2.7-code）、事实审查班昭（glm-5.2，固定承担正文审查事实席，不再由设定动态顶替）、体验·挑剔读者妙玉（deepseek-v4-flash）；昭君改为目标读者定位。编剧三角=婉儿爽点/红玉因果/幼薇脑洞，三席两两异模型且豆包禁入剧情席；写手+审查席合计五个不同模型来源。主编加节奏体检职责，副编西施=资料员+摘要员+主编备份。旧书升级：零未终态任务的11人旧书自动补齐3名新成员（`TeamTemplateService.addMissingMembers`），有未终态任务仍延后，超编仍报错；团队列表 ORDER BY 按14人契约序。后续批3-6 见 `docs/DECISIONS.md` DEC-CURRENT-046。
2. 批1连带修复两个上一批遗留BUG（测试全红兜底发现）：① 三步向导创建新书必败——向导不再采集故事方向，但 `positioning-service.createDraft` 在 openingBlueprint 存在时只认 storyDirection 当定位描述，空串直接 400；现改为 storyDirection 为空时回退 text，完整开书允许两者皆空。② 向导草稿在第3步保存后恢复被旧映射改回第2步——草稿 schemaVersion 升到 4，v4 步骤原样恢复，v3（四步时代）保持旧映射。另顺手补齐历史遗留断言：迁移列表加 0048、文档中心卡片数 36→37。
2. 信息页三处小改：「主编设计」按钮改为醒目彩色胶囊按钮（`branding-design-button`）；删掉进度横幅里「确认设定与分卷后，团队会开始规划事件。」提示；修复「修改开书资料」弹窗无法滑动——根因是 `.unified-desk .creation-desk` 的 `backdrop-filter` 把 fixed 弹窗裁剪在容器内，改用 `createPortal` 挂到 body（主编设计弹窗同样处理）。
2. 开书信息页收口 + 主编设计：信息页删掉故事方向、主要/自定义标签和作者意见入口；新增书籍简介展示；书名和简介旁加「主编设计」——第一卷方案确认后由主编（貂蝉）依据第一卷故事+设定基线+开书信息一次出 5 套候选，作者点「用这个」直接写回开书资料新版本；第一卷未确认时提示先设计第一卷。新任务类型 `book_branding_design`（迁移 0048，主编单席一次调用）。
2. 开书不带任何标签：删了后台标签自动推荐；后端放开"主要标签至少2个"和"故事方向至少20字"限制。标签库后续移到卷设计（每卷选每卷的），**未做**。
3. 开书向导 4 步 → 3 步：创作方式 → 写什么题材 → 边界与角色。"故事怎么讲"整页删除（开局/结局/故事方向/完整标签库都没了）。初始角色限 2 名，身份只剩 男主/女主/共同主角/群像主角/非人主角。
4. 基调在卷设计：每卷选主基调 1 个 + 副基调可选 1 个（词表：爽、乐、癫、暖、甜、虐、烧脑、诡异、厚重、黑），后一卷默认沿用上卷。10 段基调写作说明只注入 AI 上下文（软指引），作者不可见。旧书的 stylePrimary/styleSecondary 字段保留兼容。
5. 开书合同字段 openingStart/storyEnding/stylePrimary/styleSecondary/storyDirection 全部变为可选（旧书兼容），向导不再采集。

## 关键文件地图

- 开书向导：`apps/web/src/features/onboarding/CompleteCreateBookDialog.tsx`（+ `opening-draft-store.ts` 草稿、`opening-options.ts` 频道/角色身份）
- 信息页（开书资料）：`apps/web/src/features/planning/PlanningWorkspace.tsx` 的 `BookProfilePanel`
- 主编设计（书名/简介）：`apps/api/src/application/books/book-branding-design-service.ts` + `book-branding-pipeline-service.ts` + `infrastructure/db/repositories/book-branding-design-repository.ts` + 迁移 `0048_book_branding_designs.sql`；前端 `apps/web/src/features/planning/BrandingDesignDialog.tsx`；测试 `tests/integration/domain/book-branding-design.test.ts`
- 卷设计：`apps/web/src/features/planning/VolumePlanningPanel.tsx`（含本卷基调选择）
- 开书合同校验：`apps/api/src/contracts/opening-blueprint.ts`（**CRLF/LF 混合文件**，Edit 工具常失败，用 node 脚本按字节 replace）
- 卷合同：`apps/contracts/src/workflow.ts`（改完必须 `npm.cmd run build -w @wenmi/contracts`）
- 结算后续（节奏体检+摘要）：`apps/api/src/application/planning/settlement-follow-up-service.ts` + `settlement-follow-up-pipeline-service.ts` + `infrastructure/db/repositories/settlement-follow-up-repository.ts` + 迁移 `0050_settlement_follow_ups.sql`；前端 `apps/web/src/features/planning/SettlementFollowUpCard.tsx`；测试 `tests/integration/domain/settlement-follow-up.test.ts`
- 题材简报：`apps/api/src/domain/genre-brief.ts`（`buildGenreBrief`，各管线硬来源注入）
- 章管线上下文注入：`apps/api/src/application/creation/chapter-pipeline-service.ts`（混合换行，同上用脚本）
- 文档同步白名单：`scripts/sync-project-docs.mjs`（增删文档要同步改 currentPaths 和 bundleGroups 两处）
- 开书相关测试：`tests/integration/experience/opening-wizard.test.tsx`、`workspace-ui.test.tsx`、`tests/foundation/opening-taxonomy.test.ts`

## 部署流程（Git Bash）

```bash
npm.cmd run verify          # 大改才全量跑；小改只跑相关测试 + 前后端 tsc
node scripts/sync-project-docs.mjs --check
git -c core.autocrlf=false add -A && git -c core.autocrlf=false commit -m "..."
git push origin codex/desktop-entry
git -c core.autocrlf=false archive --format=tar -o /tmp/wenmi-update.tar HEAD apps
scp -i ~/.ssh/wenmi-hk-server /tmp/wenmi-update.tar root@47.243.152.159:/tmp/wenmi-update.tar
ssh -i ~/.ssh/wenmi-hk-server root@47.243.152.159 "cd /opt/wenmi && tar -xf /tmp/wenmi-update.tar -C /opt/wenmi && rm /tmp/wenmi-update.tar && chown -R wenmi:wenmi /opt/wenmi/apps && sudo -u wenmi npm run build && systemctl restart wenmi-api wenmi-worker && systemctl is-active wenmi-api wenmi-worker"
curl -s -o /dev/null -w '%{http_code}' https://wenmixiezuo.com/   # 要 200
```

## 协作规矩（老板定的）

- 逐页走查：老板截图指出问题 → 确认方案 → 改 → 部署 → 老板强刷（Ctrl+Shift+R）验证。
- 没说的不要改；不确定先问。
- 省 Token：攒批改、截图截局部、对话做一批事就换新对话。
- 全量 `npm run verify` 只在大改后跑；小改跑相关测试即可。

## 走查进度

- 已完成：内测说明页（版本A）、书籍列表页、青黛新中式全局风格、开书向导（当前 3 步）、开书信息页（收口 + 主编设计）、创作团队扩编 14 人（批1）、审查第四席+章纲挑战开放（批2）、三合一融合合同+结算后续+题材简报层（批3）、设定页核心六问+版本链+旧数据预填（批4）。
- 进行中/下一步：批4-6（设定页重构：核心六项＋题材包＋自由补充 → 类目级讨论管线＋结构化输出 → 设定页新前端手机端优先）；老板继续逐页走查，随走随改。
- 待做（已讨论未定稿）：标签库进卷设计；设定页效果图在 `mockups/`（setting-main.png / setting-discussion.png，老板已认可方向）。
