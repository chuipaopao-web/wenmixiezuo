# AUTH-TAKEOVER-01 返工1验收：仍不通过

2026-09-14；提交c7f2fdd3。未合入、未部署、不修改GLM产品代码。

## 已确认进展

独立内存探针确认：并发凭据版本/散列改变后，旧密码登录被拒，新密码保持有效；last_login_at已落库。新IdentityService实际承担请求身份和新增改密/撤销端点；与首轮不同，不继续把这次所有工作概括为入口改名。

独立重跑GLM的identity-cas与route-registration-matrix共7项通过。auth-rollback-compat最初在沙箱子进程环境失败（stdout空导致JSON解析错误），允许本地测试子进程后单独重跑1项通过；不把此环境错误当产品BUG。但测试通过的含义仅为下述同版本重启验证。

## 阻断问题

### R2-1 [P1] 第二次异步哈希之后未重验账号状态

identity-service.ts login在第一次derive之后检查active，但历史密码升级又await hashVerifiedPassword；最终UPDATE只检查credential_version，之后issueSession不再检查状态。setUserStatus不会增加credential_version。

在第二次哈希期间停用账号、撤销会话，登录仍返回成功并新建未撤销会话。停用期间authenticate会拒绝，但重新启用后这张本不该产生的会话能恢复有效，破坏“停用撤销会话，恢复后需重新登录”的约定。改密也有第二次await之后未重验状态的问题。

### R2-2 [P1] 已退出/撤销/过期的发起会话仍能完成改密

changePassword只接收入口时的AuthContext，异步验证和新哈希之后不重查该session是否仍存在、有效、归属相同账号。独立复现：使用真实签发会话启动改密，等待期间logout，然后改密仍返回成功，新密码可登录。需要在最终写入事务内核查发起会话及当前账号/凭据状态；不能仅依赖请求最初的鉴权。

### R2-3 [P1] “回滚包”仍是本次待发布版本自身

prepare-rollback-compat.mjs直接复制当前apps/api/dist；auth-rollback-compat测试子进程rollback-worker.mts又导入当前apps/api/src/identity/identity-service.ts，没有启动打出的包、没有运行真实main/迁移器或验证退回另一稳定实现。它证明新实现重启后读混合凭据，不能证明本次身份实现出问题时有可用回退版本。必须准备已知基准加最小格式/迁移兼容的独立目标，或真正可逆的切换实现，并用实际包演练。

### R2-4 [P2] 已知账号密码校验绕过有界哈希队列

identity-service.ts底部deriveWithRecord直接调用scrypt；domain/passwords.ts中MAX_ACTIVE_HASHES/等待队列没有包住实际已知账号登录与当前密码校验。首轮有的资源保护在返工拆分后失效。应共用有界域校验接口，而非复制另一条不受限派生路径；用并发请求/调用测试验证忙时拒绝或有界排队。

## 独立复现

脚本：.local/dispatch/outbox/task-auth-takeover-01/codex-revision1-probe.mjs；内存合成数据库，读取返工dist，源码已核对。通过包装只读SELECT，在第二次await窗口安排停用，未改产品文件。

输出：suspendDuringUpgrade=login_success；suspendedNewSessions=1；sessionsAfterReactivation=1；revokedSessionChangePassword=succeeded；newPasswordFromRevokedSession=accepted；concurrentChange=INVALID_CREDENTIALS；concurrentNewPassword=preserved；lastLoginWritten=true。

前五项证实缺陷，后三项证实上轮部分问题已修好。GLM整体验证仍有PG/迁移未验证、全量基线失败，不能把基线失败伪称新增回归，也不能因此宣告完整验收通过。

下一步按inbox/task-auth-takeover-01-revision-2.md返工；尚未达到合入与上线条件。保留已通过成果，不要求重做全部项目。
