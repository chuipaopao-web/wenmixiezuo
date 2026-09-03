# 第86批86a部署热修：清空脚本进入运行闭包门禁

任务编号：V7-DEPLOY-GATE-WIPE-SCRIPT-20260903-86A-HOTFIX  
本次唯一清单：`coauthoring-v7/docs/worklists/V7-DEPLOY-GATE-WIPE-SCRIPT-20260903-86A-HOTFIX.md`

## 变更合同

- 任务类型：部署阻断热修。
- 当前问题：第86批 stage 阶段 `npm run verify:full` 失败，运行闭包门禁报告 `scripts/ops/wipe-production-books.ts` 没有显式调用或部署入口。
- 复现步骤：在生产暂存目录运行第86批部署脚本 `DEPLOY_MODE=stage_backup`。
- 期望结果：清空脚本作为第86批生产部署前置运维入口被闭包门禁识别；stage 可继续进入备份。
- 允许修改：运行闭包门禁入口登记、发布号、部署证据回写。
- 明确不改：清空脚本删除范围、BookPurgeRepository、业务流程、灰度开关、数据库迁移、作者数据。
- 必须保留：第86批清空前必须先备份并拉本机；`WENMI_V7_ASSET_MENU` 默认关闭；账号和会员数据不清空。
- 新功能验收：`scripts/ops/wipe-production-books.ts` 不再被门禁列为孤儿运维文件。
- 原功能回归：运行闭包仍拒绝未登记运维文件；生产上线流程继续 stage→backup→wipe→preflight→cutover→postdeploy。
- 测试范围：`npm run verify:runtime-closure`，生产 stage+backup，清空 dry-run/execute 验证，部署后 health/postdeploy。
- 部署要求：随第86批86a一起重新打包部署。

## 复用审计

- 当前实现：运行闭包门禁已有 `OPERATIONAL_ENTRY_DEFINITIONS` 专门登记运维入口。
- 复用决定：最小修改该入口清单，沿用既有 trace/import/孤儿检查逻辑，不新增脚本绕过。

## 进度

- REQ-1：解除第86批清空脚本孤儿门禁。状态：进行中。
- IMP-1：把 `scripts/ops/wipe-production-books.ts` 登记为第86批生产清空前置入口。状态：进行中。
- ACC-1：运行闭包检查通过。状态：待处理。
- EVD-1：本地/生产 stage 日志。状态：待处理。
