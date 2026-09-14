# AUTH-TAKEOVER-01 返工3验收记录

日期2026-09-14；GLM提交557574db，分支codex/auth-takeover-01。结论：前三轮提出的已复现缺陷本轮关闭，相关本地返工验收通过；不是整站重构/PG迁移/生产发布验收。未合入、未推送、未部署。

## Codex独立证据

1. codex-revision2-audit-probe.mjs：错误登录拒绝、login_failed=1；错误改密拒绝、password_change_failed=1。两类失败记录不再被业务回滚删除。
2. worktree内运行node node_modules/vitest/vitest.mjs run tests/integration/security/identity-cas.test.ts tests/integration/security/identity-final-transaction.test.ts tests/integration/security/identity-audit-persistence.test.ts tests/integration/security/route-registration-matrix.test.ts，exit0，4文件18项通过。输出的r3 audit fail为测试主动注入的审计故障，不是未处理的验收失败。
3. 实际打包dist的三阶段演练：codex-drill-rollback.mjs在GLM工作树执行，exit0、21项通过。新包注册/登录/改密；兼容旧基准包真实main/迁移启动、v1/v2登录、既有会话、账号/owner/会员数保持；再切新包登录、升级、改密恢复。仅本地端口43120与合成临时库，无生产或模型调用。
4. 演练副本与GLM脚本的业务检查一致；唯一退出调整为process.exitCode，确保finally执行关闭子进程和清理本次临时库。GLM原脚本process.exit会跳过finally，不能作为正式运维脚本直接复用。独立副本保存在同证据目录codex-drill-rollback.mjs。

## 范围与剩余事项

本地成果为现有SQLite权威上新IdentityService/入口、密码格式兼容、会话与改密安全、相关旧装配退出；未发生PG身份接管，不将vendored域实现称为整个rebuild运行栈迁移。GLM此前基线全量失败及作者端类型债务不在这18项里被证明消除，记录仍有效。

进入合入/发布准备前须审查完整分支差异与主线后续变动，保留C6运行层成果，明确0125唯一迁移及回滚资源；规范构建脚本路径/重入与临时工作树清理、把上述演练退出修正纳入正式脚本，不执行无归属检查的递归删除；执行生产发布门禁与合并后的相称回归。Windows本地包演练不等于Linux生产产物验证，不删除作者数据或在途任务。

本报告关闭具体返工问题，不承诺零BUG，不批准直接绕过生产门禁上线。后续不再让GLM重复修复前三轮已通过问题。
