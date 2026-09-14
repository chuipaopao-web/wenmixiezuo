# AUTH-TAKEOVER-01 返工2审查：部分通过，失败审计仍阻断交付

2026-09-14，提交c328dca3；未合入/部署。本轮不要求重做此前已修好的功能。

## 已验证和改进

- 独立运行identity-final-transaction、identity-cas、route-registration-matrix：3文件13项通过。
- 新登录/改密全部await结束后同步事务重读账号及会话，代码检查确认停用/凭据变化/会话撤销核查已进入最终写入边界；旧改密覆盖和last_login_at修复保留。有界域密码接口已用于已知账号。
- 回退脚本现在基于5edad171单独构建并补双格式/0125，不再只是打包新身份实现自身。GLM报告新→回退→新21项演练；本轮核查了脚本，但未独立重跑完整回退演练，不能把报告当独立通过证据。
- 旧codex-revision1-probe使用“第2次SELECT后排微任务”定位第二次await；重构后第2次SELECT已处于最终同步事务，微任务发生在提交之后，故其login_success不能继续当作漏洞证据。此次输出会话最终被撤销、已退出改密被拒；以新结构和新阶段测试判定，不要求迎合旧探针时序。

## R3-1 [P2] 已知账号错误密码的安全审计会被回滚删除

identity-service.ts login的!matches分支：recordAudit('login_failed')在BEGIN IMMEDIATE事务中，然后ROLLBACK；changePassword的!matches分支同样先写password_change_failed再ROLLBACK。结果登录/改密正确拒绝，但后台丢失这两类失败记录；原有业务的可追溯性退化。未知账号等事务外失败记录不受此问题影响。

独立内存合成探针codex-revision2-audit-probe.mjs得到：wrongLogin=INVALID_CREDENTIALS、persistedLoginFailures=0；wrongChange=INVALID_CREDENTIALS、persistedPasswordChangeFailures=0。源码与返工dist一致，未访问生产/模型。

修复要求：回滚成功状态变更之后，再可靠写失败审计，或以不含成功状态变更的独立事务提交失败结果；各请求恰好一条失败事件。凭据升级/会话签发/成功审计仍原子，不允许失败审计的修复意外提交密码或会话。不能吞审计写错误后伪装记录成功，不能记录明文密码、token、cookie。

## 其余交付限制

PG接管与生产迁移仍未验证，完整重构不得标完成；当前目标为SQLite权威上的新身份域和入口接管。已知基线测试债务、回退包平台路径/构建依赖和正式切换需在最终验收独立核查。本次不增加创作业务重写范围。

请执行inbox/task-auth-takeover-01-revision-3.md，保留已通过成果，只补失败审计及对应反例，更新结果后再验收。
