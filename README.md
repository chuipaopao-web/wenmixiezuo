# 文秘写作 V7

文秘写作是面向长篇网文创作的 AI 协作平台。V7 是当前唯一产品版本，提供作者创作台、独立管理后台、分层规划、Agent任务、正文生成、审查、结算、会员和用量管理。

## 当前入口

- 生产作者端：`https://wenmixiezuo.com/`
- 生产独立后台：`https://admin.wenmixiezuo.com/`
- 本地作者端：`http://127.0.0.1:43110/`
- 本地独立后台：`http://127.0.0.1:43110/v7/`

## 开发入口

- 当前状态与最小阅读：`HANDOFF.md`
- 开发规则：`AGENTS.md`
- V7 工作区：`coauthoring-v7/`
- 架构、数据与接口：`docs/ARCHITECTURE.md`、`docs/DATA_MODEL.md`、`docs/API.md`
- 安全与部署：`docs/SECURITY_AND_OPERATIONS.md`、`docs/DEPLOY.md`

旧版产品页面、工作流和作者数据不属于当前产品。历史迁移、表名和 Git 提交只用于数据库兼容、审计和恢复，不能作为恢复旧功能的依据。

## 常用命令

```powershell
npm run dev
npm run verify
npm run verify:full
```

`verify` 用于日常定向门禁；核心工作流、权限、数据删除、迁移和发布变更使用 `verify:full`。
