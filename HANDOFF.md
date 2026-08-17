# 文秘写作交接笔记（HANDOFF）

> 新对话第一句话："读 HANDOFF.md，我们继续"。本文件是当前开发状态的唯一速查入口，随每次改动更新。
> 详细规则仍在 AGENTS.md；本文档只放"快速回到状态"需要的东西。

## 项目现状（2026-08-18 凌晨）

- 项目是**初始版本**：工作流程和前端 UI 都将大改。工作方式 = 老板逐页走查截图 → 讨论 → 修改 → 部署。
- 原则：**改到哪一页，顺手删掉死代码、同步改文档；文档只描述当前生效的功能**。老板说改什么就改什么，不多做；有必要的附带改动先问。
- 已上线：`https://wenmixiezuo.com`（阿里云香港 47.243.152.159，服务 wenmi-api / wenmi-worker，目录 /opt/wenmi，用户 wenmi）。
- 分支 `codex/desktop-entry`，远程 GitHub `chuipaopao-web/wenmixiezuo`，每次提交后推送。

## 最近完成的改动（最新在最上）

1. 信息页三处小改：「主编设计」按钮改为醒目彩色胶囊按钮（`branding-design-button`）；删掉进度横幅里「确认设定与分卷后，团队会开始规划事件。」提示；修复「修改开书资料」弹窗无法滑动——根因是 `.unified-desk .creation-desk` 的 `backdrop-filter` 把 fixed 弹窗裁剪在容器内，改用 `createPortal` 挂到 body（主编设计弹窗同样处理）。
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

- 已完成：内测说明页（版本A）、书籍列表页、青黛新中式全局风格、开书向导（当前 3 步）、开书信息页（收口 + 主编设计）。
- 进行中/下一步：老板继续逐页走查（设定、卷设计、章纲、正文写作等页面），随走随改。
- 待做（已讨论未定稿）：标签库进卷设计；开局/结局进设定阶段由 AI 参与讨论推荐。
