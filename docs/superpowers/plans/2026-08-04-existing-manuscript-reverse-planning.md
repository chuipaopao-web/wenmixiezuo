# Existing Manuscript Reverse Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让作者在开书时明确选择续写，直接导入已有正文，逐章形成可追溯逆向章纲，并以三席独立建议、主编编号综合、作者编号融合和最终确认完成设定整理。

**Architecture:** 在现有模块化单体上增加开书模式分流，复用不可变正文导入、逐章分析任务、设定讨论任务和SQLite结构化JSON。原文是权威，逆向章纲和设定均为派生候选；Web只消费作者可读视图。

**Tech Stack:** React、TypeScript、Vite、Fastify、SQLite、Node.js Worker、Vitest。

## Global Constraints

- 只修改 `D:\wenmixiezuo`，不访问或影响AI智囊团。
- 不修改已合并迁移；若结构化JSON可承载则不新增迁移。
- 不把整本正文注入单次模型；不把逆向章纲自动写入正史。
- 所有新路由幂等、可恢复、可追溯；API Key仅从环境变量读取。
- 每项先写失败测试，再最小实现，再运行针对性验证。

---

## Task 1：开书模式与续写直达

- [ ] 在 `apps/api/src/contracts/opening-blueprint.ts` 和 `apps/web/src/lib/api/client.ts` 增加 `creationMode: new | continuation`，旧数据缺省为`new`。
- [ ] 在 `apps/web/src/app/App.tsx` 的开书表单增加明确单选，续写创建成功后进入正文工作台并展开导入区。
- [ ] 在 `apps/api/src/application/books/book-onboarding-service.ts` 分流：续写书不初始化空白设定启动任务。
- [ ] 在 `tests/integration/books/positioning-onboarding.test.ts` 增加失败测试：续写书`kickoffTaskId`为空且没有`setting_proposal_panel`任务。
- [ ] 运行：`npm test -- tests/integration/books/positioning-onboarding.test.ts`。
- [ ] 回滚：删除模式UI与分流，保留数据库中已经保存的开书JSON。

## Task 2：逐章分析与逆向章纲

- [ ] 扩充 `apps/api/src/application/continuation/continuation-analysis-pipeline-service.ts` 的结构化契约，保存目标、起止状态、人物作用、剧情节拍、冲突、情绪、信息揭示、伏笔回收、章末接口、设定候选和未知项。
- [ ] 修复该服务现存中文乱码，保证作者可见摘要不泄漏JSON键或内部错误。
- [ ] 在 `tests/integration/continuation/existing-manuscript-continuation.test.ts` 增加失败测试，验证每章逆向章纲、来源版本和恢复幂等。
- [ ] 运行：`npm test -- tests/integration/continuation/existing-manuscript-continuation.test.ts`。
- [ ] 回滚：停止消费`reverseOutline`字段，保留历史结构化分析JSON。

## Task 3：从开书资料和逆向章纲整理设定候选

- [ ] 在续写分析完成事件中创建一次幂等设定整理任务，只传开书定位、章节逆向章纲摘要和直接证据。
- [ ] 在对话接待中优先展示“原文分析/设定整理”状态，不再要求先完成空白设定目录。
- [ ] 增加集成测试：分析完成后存在带来源的设定候选，未确认前不进入正式设定。
- [ ] 运行续写与会话针对性测试。
- [ ] 回滚：停用自动整理任务，保留逐章分析和手动跳转讨论。

## Task 4：三席建议、主编编号综合和作者编号融合

- [ ] 调整 `apps/api/src/application/discussions/discussion-pipeline-service.ts`：三席各输出建议、理由、代价；第四次主编调用生成最多四项稳定编号及提案映射。
- [ ] 调整 `apps/api/src/application/chat/conversation-service.ts`：解析`123`、`1+2+3`、`1、2、3`，只在当前设定综合状态生效；其他数字仍按普通原话处理。
- [ ] 主编融合后形成单一候选，作者确认才保存并推进；重复进入不得重复启动三席。
- [ ] 在讨论运行测试中覆盖单选、多选、自由补充、拒绝、重试和编号越界。
- [ ] 运行：`npm test -- tests/integration/discussions tests/integration/chat`。
- [ ] 回滚：恢复三份提案直接展示，保留历史编号映射和作者选择。

## Task 5：确认内容完整显示与全链路验证

- [ ] 调整 `apps/web/src/app/App.tsx` 和样式：确认设定单列、自适应高度、保留换行，不固定卡片高度或内部滚动。
- [ ] 增加UI测试：长内容完整渲染，续写入口创建后落在正文页。
- [ ] 运行类型检查、全量测试、构建、迁移空库/升级、运行与恢复验证。
- [ ] 在 `TASKS.md`、`KNOWLEDGE.md` 和覆盖矩阵记录真实证据等级与残余限制。
- [ ] 回滚：恢复旧布局CSS，不修改任何业务数据。
