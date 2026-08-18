# 文秘写作交接笔记（HANDOFF）

> 新对话第一句话："读 HANDOFF.md，我们继续"。本文件是当前开发状态的唯一速查入口，随每次改动更新。
> 详细规则仍在 AGENTS.md；本文档只放"快速回到状态"需要的东西。

## 项目现状（2026-08-18 凌晨）

- 项目是**初始版本**：工作流程和前端 UI 都将大改。工作方式 = 老板逐页走查截图 → 讨论 → 修改 → 部署。
- 原则：**改到哪一页，顺手删掉死代码、同步改文档；文档只描述当前生效的功能**。老板说改什么就改什么，不多做；有必要的附带改动先问。
- 已上线：`https://wenmixiezuo.com`（阿里云香港 47.243.152.159，服务 wenmi-api / wenmi-worker，目录 /opt/wenmi，用户 wenmi）。
- 分支 `codex/desktop-entry`，远程 GitHub `chuipaopao-web/wenmixiezuo`，每次提交后推送。

## 最近完成的改动（最新在最上）

1. 批4·设定页重构数据层（核心六问+版本链+旧数据预填）：① 核心六问成为任何题材的唯一必备项——故事内核 story-kernel、世界舞台 world-stage、主角处境 protagonist-situation、对立面 opposition、规矩与代价 rules-costs、边界与留白 boundaries-blanks（`setting-outline-profile.ts` CORE_SETTING_KEYS，`setting-outline-catalog.ts` 新增六条目）；题材包项全部转为建议，设定基线门槛只看核心六问。② 设定项版本链：迁移 `0051_setting_item_versions.sql`，每次确认（manual/guidance/discussion 三条路径）追加不可变版本，新增 `GET .../setting-outline-workspace/:itemKey/versions` 查询接口与前端 `fetchSettingOutlineVersions`。③ 旧数据预填：初始化核心项时按 `CORE_PREFILL_SOURCES` 固定映射把旧设定内容汇成「预填稿」写入空内容核心项，状态保持待讨论，绝不覆盖作者已有内容。④ 建书首个三席提案任务不再硬编码策划理念，自动绑定当前第一个核心项。⑤ 前端 `PlanningWorkspace.tsx` 加入核心六卡组做最小兼容（新版设定主页/讨论页在批6重做）。决定见 DEC-CURRENT-049。测试 164 文件 686 项全绿。
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
- 待做（已讨论未定稿）：标签库进卷设计；开局/结局进设定阶段由 AI 参与讨论推荐；设定页效果图在 `mockups/`（setting-main.png / setting-discussion.png，老板已认可方向）。
