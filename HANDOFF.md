# 文秘写作交接笔记（HANDOFF）

> 新对话第一句话："读 HANDOFF.md，我们继续"。本文件是当前开发状态的唯一速查入口，随每次改动更新。
> 详细规则仍在 AGENTS.md；本文档只放"快速回到状态"需要的东西。

## 项目现状（2026-08-18 凌晨）

- 项目是**初始版本**：工作流程和前端 UI 都将大改。工作方式 = 老板逐页走查截图 → 讨论 → 修改 → 部署。
- 原则：**改到哪一页，顺手删掉死代码、同步改文档；文档只描述当前生效的功能**。老板说改什么就改什么，不多做；有必要的附带改动先问。
- 已上线：`https://wenmixiezuo.com`（阿里云香港 47.243.152.159，服务 wenmi-api / wenmi-worker，目录 /opt/wenmi，用户 wenmi）。
- 分支 `codex/desktop-entry`，远程 GitHub `chuipaopao-web/wenmixiezuo`，每次提交后推送。

## 最近完成的改动（最新在最上）

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
