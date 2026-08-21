# 文秘写作

文秘写作是统一账号的长篇小说AI协作平台。作者通过开书、设定、卷、事件、章纲、正文和结算对象逐层创作，AI只在作者主动触发时介入。

## 当前工作流

```text
开书 → 非剧情设定 → 卷方向 → 事件链 → 事件大纲
→ 完整章链与近期章纲 → 正文 → 章节/事件/卷结算 → 下一卷
```

## 开发入口

- 当前状态：`HANDOFF.md`
- 开发规则：`AGENTS.md`
- 当前专项清单：`docs/PROJECT_SLIMMING_IMPLEMENTATION_AND_ACCEPTANCE.md`
- 产品：`docs/PRODUCT.md`
- 架构、数据与接口：`docs/ARCHITECTURE.md`、`docs/DATA_MODEL.md`、`docs/API.md`
- 安全与部署：`docs/SECURITY_AND_OPERATIONS.md`、`docs/DEPLOY.md`
- 验收：`docs/ACCEPTANCE.md`
- UI任务按需读取 `.agents/skills/wenmi-ui-ux/SKILL.md`
- 长篇质量任务按需读取 `.agents/skills/wenmi-longform-quality/SKILL.md`

历史决定、旧验收和废弃方案只从Git历史追溯，不保留重复合订版。

## 常用命令

```powershell
npm run dev
npm run verify
npm run verify:full
```

`verify` 是日常快速门禁；`verify:full` 只用于发布、迁移、权限、恢复和核心工作流大改。真实长篇验证只在明确指定时运行，不属于默认工程测试。
