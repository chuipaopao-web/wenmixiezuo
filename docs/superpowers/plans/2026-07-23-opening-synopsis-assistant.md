# 剧情梗概智能识别与开书布局优化实施计划

> 本计划由当前Codex在同一任务内串行执行。项目规则禁止调用其他开发Agent。

**目标：** 在完整开书弹窗左侧空白区增加最多5000字的剧情梗概输入，由小文秘书本地扫描并把有依据的分类、标签和基础资料作为可修改建议填入现有表单，同时消除双列布局的大块空白。

**架构：** 新增无状态的 `OpeningSynopsisAnalysisService`，只读取固定版本的开书分类目录并返回候选，不保存梗概、不调用云端模型、不写正史。Web通过独立REST接口请求候选，采用“只填空项、标签有界合并、已有内容优先”的回填策略。现有完整开书校验、草稿确认事务和正史边界保持不变。

**技术栈：** TypeScript、Fastify、React、Vitest、Testing Library、现有原生CSS。

---

## 任务1：冻结候选识别合同

**文件**

- 新增：`apps/api/src/contracts/opening-synopsis-analysis.ts`
- 新增：`apps/api/src/application/books/opening-synopsis-analysis-service.ts`
- 新增：`tests/foundation/opening-synopsis-analysis.test.ts`

**步骤**

1. 先写失败测试，覆盖空输入、超过5000字、结构化梗概、自由文本、分类/标签匹配、未知字段不臆造和确定性重复结果。
2. 定义输入上限、候选Schema、识别来源和未识别字段。
3. 实现标题/频道/主角/背景/阶段剧情/全书简介/初始地图的显式线索提取。
4. 实现分类、主要标签、辅助题材、全书特点、性格和必须遵守的目录内匹配。
5. 运行目标测试：`npm test -- tests/foundation/opening-synopsis-analysis.test.ts`。

## 任务2：接入只读分析API

**文件**

- 修改：`apps/api/src/http/domain-routes.ts`
- 修改：`apps/web/src/lib/api/client.ts`
- 修改：`tests/integration/domain/api-flow.test.ts`

**步骤**

1. 先写API失败测试，覆盖成功、空输入和5001字拒绝。
2. 新增 `POST /api/v1/opening-synopsis/analyze`，只返回候选，不持久化原文。
3. 客户端增加严格类型和请求函数。
4. 运行目标测试：`npm test -- tests/integration/domain/api-flow.test.ts`。

## 任务3：重排完整开书弹窗

**文件**

- 修改：`apps/web/src/app/App.tsx`
- 修改：`apps/web/src/app/app.css`
- 修改：`tests/integration/experience/workspace-ui.test.tsx`

**步骤**

1. 先写UI失败测试，覆盖5000字上限、字符计数、识别请求、空项回填、已有输入不覆盖、加载/错误状态和无障碍。
2. 将第一列改为纵向栈，把书籍分类和剧情梗概识别卡放在同一列。
3. 增加梗概文本框、字符计数、识别按钮和简洁结果摘要。
4. 回填只作用于空字段；标签按现有上限合并；用户已有频道、分类、文本和硬边界优先。
5. 在窄屏恢复单列，保证按钮、状态和文本区不溢出。
6. 运行目标测试：`npm test -- tests/integration/experience/workspace-ui.test.tsx`。

## 任务4：同步决定、规格和审计

**文件**

- 修改：`docs/DECISIONS.md`
- 修改：`docs/PRODUCT.md`
- 修改：`docs/API.md`
- 修改：`docs/ACCEPTANCE.md`
- 修改：`TASKS.md`
- 新增：`docs/OPENING_SYNOPSIS_ASSISTANT_AUDIT.md`

**步骤**

1. 记录DEC-048及 `design_review_id=DR-20260723-02`。
2. 记录“候选而非确认、无原文持久化、无云端Token、失败不阻断手工开书、不得覆盖用户输入”。
3. 完成长篇质量Skill要求的两轮审查、反例、证据等级和停止条件。
4. 运行审计验证器。

## 任务5：全量验证与交付

**步骤**

1. 运行目标测试。
2. 运行 `npm run typecheck`、`npm test`、`npm run build`。
3. 运行 `npm run migrate` 两次，确认Schema 25无新增迁移且幂等。
4. 运行隔离开书端到端、备份恢复和 `npm run acceptance`。
5. 用最新构建验证Web、API和Worker运行状态；不得停止或重启 `D:\AI智囊团`。
6. 保存release证据，执行 `git diff --check`，提交Git。

## 停止和回滚

- 停止条件：需要实际付费、新密钥、生产数据恢复、永久删除、跨书泄漏、正史污染或必须触碰 `D:\AI智囊团`。
- 回滚：非破坏性revert新增服务、API和UI；不删除任何书籍、草稿、正史或正文；本任务不新增迁移。
