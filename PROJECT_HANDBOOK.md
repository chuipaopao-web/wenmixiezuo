# 文秘写作项目入口

## 当前状态

文秘写作是统一账号的长篇小说AI协作平台。产品仍在快速完善，功能、页面结构和视觉都允许继续调整；作者确认内容、正文版本和账号/书籍隔离是稳定底线。

当前主流程：

```text
开书 → 非剧情设定 → 卷方向 → 事件链 → 事件大纲
→ 完整章链与近期详细章纲 → 正文 → 章节/事件/卷结算 → 下一卷
```

## 每次开发怎么读

- 当前状态：`HANDOFF.md`
- 开发规则：`AGENTS.md`
- 当前决定：`docs/DECISIONS.md`
- 产品章程：`docs/PROJECT_CHARTER.md`
- UI/UX重设计：`docs/UI_UX_REDESIGN_DIRECTION.md`
- 风险分级验收：`docs/ACCEPTANCE.md`
- UI任务：`.agents/skills/wenmi-ui-ux/SKILL.md`
- 长篇工作流/质量任务：`.agents/skills/wenmi-longform-quality/SKILL.md`

只读当前任务需要的入口，不通读完整合订版。需要具体字段时再查对应规格：

- 产品与工作流：`docs/PRODUCT.md`、`docs/CREATION_WORKFLOW_V2_DESIGN.md`
- 架构/数据/API：`docs/ARCHITECTURE.md`、`docs/DATA_MODEL.md`、`docs/API.md`
- Agent/上下文/检索：`docs/AGENT_SYSTEM.md`、`docs/MEMORY.md`、`docs/HYBRID_RAG_DESIGN.md`
- 部署：`docs/DEPLOY.md`

## 界面方向

现有书籍区、功能区和中心工作区是当前实现，不是固定章程。重设计优先解决当前书/对象、任务状态、唯一主操作和恢复动作；手机不照搬桌面多栏。普通作者只看业务语言，不看内部模型、任务、方法、路径或协议。

## 数据与创作底线

- SQLite正式对象、作者原文和不可变正文是权威源；摘要、向量、图谱和Wiki可重建。
- 所有业务对象和任务按 `owner_id`、`book_id` 隔离。
- 规划描述未来，结算只记录正文实际；上游版本变化让下游候选失效或重新确认。
- 作者原话绑定具体对象；软参考可不用，开放区保留AI创造性。
- Key只来自环境变量；永久删除作者数据需影响预览和双重确认。

## 文档中心

- `docs/PROJECT_DOCUMENT_CENTER.html`：可搜索当前文档和两个项目Skill。
- `docs/PROJECT_DOCUMENT_INDEX.md`：当前文件、摘要和指纹。
- `docs/PROJECT_REFERENCE_BUNDLE.md`：完整合订版，只供专项查阅或外部评审，不是默认上下文。
- Git历史：旧决定、旧验收、事故和发布记录只在需要追溯时查看，不进入默认上下文或产品检索。

当前规格或Skill变化后运行 `node scripts/sync-project-docs.mjs` 与 `--check`。